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
    ?.split(/(?<=[.!?;])\s+|(?<=[。！？；])\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^(?:do not\b|不要)/i.test(part)) ?? [];
}

function explicitOrder(event: NextActionInputEvent): DerivedNextAction | undefined {
  for (const clause of clauses(event)) {
    const text = clause.replace(/[.!?。！？]+$/, "");
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

    const before = text.match(/^(.+?)\s+before\s+(.+?)$/i);
    if (before !== null) {
      return result(
        fact(before[1]!, event),
        [],
        [fact(imperative(before[2]!).replace(/[.]$/, ""), event)]
      );
    }
  }
  return undefined;
}

function explicitNext(event: NextActionInputEvent): DerivedNextAction | undefined {
  const next = clauses(event).find((part) => /\snext(?:[.!?]?$|\s+and\s+)/i.test(part));
  if (next === undefined) {
    return undefined;
  }
  const finalAction = next.match(/\band\s+((?:add|write|run|fix|implement|finish|prove|expose|wire)\b.+?)\s+next[.!?]?$/i);
  const action = finalAction?.[1]
    ?? next.replace(/\s+next(?=[.!?]?$|\s+and\s+)/i, "");
  return result(fact(action, event));
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

  return events[latestStateIndex];
}

const failedResultPattern = /\b(?:fail(?:ed|s)?|rejected|reverted|does not|did not|still|hangs?|error|not implemented)\b|失败|未通过|无效|排除|放弃|回滚|仍然|报错|错误/i;
const successfulResultPattern = /\b(?:all .+ pass(?:ed)?|pass(?:ed|es)|success|exit code 0)\b|通过|成功/i;

function resultOutcome(text: string): "failed" | "successful" | "unknown" {
  if (/\b[1-9]\d* failed\b/i.test(text)) {
    return "failed";
  }
  if (/\b0 failed\b/i.test(text) && successfulResultPattern.test(text)) {
    return "successful";
  }
  if (failedResultPattern.test(text)) {
    return "failed";
  }
  return successfulResultPattern.test(text) ? "successful" : "unknown";
}

function actionFromToolResult(event: NextActionInputEvent): DerivedNextAction {
  const outcome = resultOutcome(event.text!);
  if (outcome === "failed") {
    return result(fact(`Investigate and resolve the latest source result: ${event.text!}`, event));
  }
  if (outcome === "successful") {
    return result(fact("No unresolved action is evidenced; wait for the next user instruction", event));
  }
  return result(fact(`Review the latest source result before continuing: ${event.text!}`, event));
}

export function deriveNextAction(events: readonly NextActionInputEvent[]): DerivedNextAction {
  const selected = latestEffectiveEvent(events);
  if (selected?.text === undefined) {
    throw new Error("a Work Capsule needs evidence for the next action");
  }
  if (selected.kind === "tool-result") {
    return actionFromToolResult(selected);
  }

  const ordered = explicitOrder(selected);
  if (ordered !== undefined) {
    return ordered;
  }
  const next = explicitNext(selected);
  if (next !== undefined) {
    return next;
  }
  if (selected.kind === "assistant-message") {
    const outcome = resultOutcome(selected.text);
    if (outcome === "failed") {
      return result(fact(`Investigate and resolve the latest agent state: ${selected.text}`, selected));
    }
    const completed = outcome === "successful"
      || /\bcomplete(?:d)?\b|已完成|完成了/.test(selected.text);
    return completed
      ? result(fact("No unresolved action is evidenced; wait for the next user instruction", selected))
      : result(fact(`Review the latest agent state before continuing: ${selected.text}`, selected));
  }
  return result({ text: selected.text, sourceEventIds: [selected.id], inferred: false });
}
