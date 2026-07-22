export type NextActionEventKind =
  | "user-message"
  | "assistant-message"
  | "agent-checkpoint"
  | "tool-call"
  | "tool-result"
  | "attachment"
  | "context"
  | "task-started"
  | "task-completed";

export interface NextActionInputEvent {
  readonly id: string;
  readonly kind: NextActionEventKind;
  readonly text?: string;
}

export interface DerivedActionFact {
  readonly text: string;
  readonly sourceEventIds: readonly string[];
  readonly inferred: boolean;
}

export interface DerivedNextAction {
  readonly first: DerivedActionFact;
  readonly then: readonly DerivedActionFact[];
  readonly forbiddenBefore: readonly DerivedActionFact[];
}

function sentence(value: string): string {
  const trimmed = value.trim().replace(/[.!?。！？]+$/, "");
  const start = /^[a-z]/.test(trimmed) ? trimmed.charAt(0).toUpperCase() : trimmed.charAt(0);
  const punctuation = /[\u3400-\u9fff]/.test(trimmed) ? "。" : ".";
  return `${start}${trimmed.slice(1)}${punctuation}`;
}

function imperative(value: string): string {
  return sentence(value.trim()
    .replace(/^touching\b/i, "Touch")
    .replace(/^implementing\b/i, "Implement")
    .replace(/^running\b/i, "Run")
    .replace(/^writing\b/i, "Write")
    .replace(/^adding\b/i, "Add"));
}

function fact(text: string, event: NextActionInputEvent): DerivedActionFact {
  return { text: sentence(text), sourceEventIds: [event.id], inferred: true };
}

function result(
  first: DerivedActionFact,
  then: readonly DerivedActionFact[] = [],
  forbiddenBefore: readonly DerivedActionFact[] = []
): DerivedNextAction {
  return { first, then, forbiddenBefore };
}

function clauses(event: NextActionInputEvent): string[] {
  return event.text
    ?.split(/(?<=[.!?;。！？；])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^(?:do not\b|不要)/i.test(part)) ?? [];
}

function explicitOrder(event: NextActionInputEvent): DerivedNextAction | undefined {
  const text = event.text?.trim().replace(/[.!?。！？]+$/, "");
  if (text === undefined) {
    return undefined;
  }

  const chinese = text.match(/^先(.+?)[，,]\s*再(.+)$/);
  if (chinese !== null) {
    return result(fact(chinese[1]!, event), [fact(chinese[2]!, event)]);
  }

  const firstThen = text.match(/^(.+?)\s+first,?\s*then\s+(.+)$/i)
    ?? text.match(/^first\s+(.+?),\s*then\s+(.+)$/i)
    ?? text.match(/^(.+?),\s*then\s+(.+)$/i);
  if (firstThen !== null) {
    return result(
      fact(imperative(firstThen[1]!).replace(/[.]$/, ""), event),
      [fact(imperative(firstThen[2]!).replace(/[.]$/, ""), event)]
    );
  }

  const after = text.match(/^(.+?)\s+after\s+(.+)$/i);
  if (after !== null) {
    return result(
      fact(imperative(after[2]!).replace(/[.]$/, ""), event),
      [fact(imperative(after[1]!).replace(/[.]$/, ""), event)]
    );
  }

  const ordered = clauses(event).find((part) => /\bbefore\b/i.test(part));
  const before = ordered?.match(/^(.+?)\s+before\s+(.+?)[.!?]?$/i);
  if (before !== null && before !== undefined) {
    return result(
      fact(before[1]!, event),
      [],
      [fact(imperative(before[2]!).replace(/[.]$/, ""), event)]
    );
  }
  return undefined;
}

function explicitNext(event: NextActionInputEvent): DerivedNextAction | undefined {
  const next = clauses(event).find((part) => /\bnext\b/i.test(part));
  if (next === undefined) {
    return undefined;
  }
  return result(fact(next.replace(/\s+next\b/i, ""), event));
}

function latestEffectiveEvent(events: readonly NextActionInputEvent[]): NextActionInputEvent | undefined {
  let latestUserIndex = -1;
  let latestStateIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.kind === "user-message") {
      latestUserIndex = index;
    }
    if (event.kind === "assistant-message" || event.kind === "agent-checkpoint") {
      latestStateIndex = index;
    }
  }
  if (latestStateIndex <= latestUserIndex) {
    return events[latestUserIndex];
  }

  for (let index = events.length - 1; index > latestStateIndex; index -= 1) {
    const event = events[index]!;
    if (event.kind === "tool-result" && event.text !== undefined) {
      return event;
    }
  }

  const state = events[latestStateIndex];
  return state?.kind === "agent-checkpoint" ? state : events[latestUserIndex];
}

function unresolvedAction(event: NextActionInputEvent): DerivedNextAction {
  return result(fact(`Investigate and resolve the latest source result: ${event.text!}`, event));
}

export function deriveNextAction(events: readonly NextActionInputEvent[]): DerivedNextAction {
  const selected = latestEffectiveEvent(events);
  if (selected?.text === undefined) {
    throw new Error("a Work Capsule needs evidence for the next action");
  }
  if (selected.kind === "tool-result") {
    return unresolvedAction(selected);
  }

  const ordered = explicitOrder(selected);
  if (ordered !== undefined) {
    return ordered;
  }
  const next = explicitNext(selected);
  if (next !== undefined) {
    return next;
  }
  return result({ text: selected.text, sourceEventIds: [selected.id], inferred: false });
}
