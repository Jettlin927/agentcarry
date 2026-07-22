export interface NextActionInputEvent {
  readonly id: string;
  readonly kind: string;
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
  const trimmed = value.trim().replace(/[.!?]+$/, "");
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

function imperative(value: string): string {
  return sentence(value.trim().replace(/^touching\b/i, "Touch").replace(/^implementing\b/i, "Implement"));
}

function orderedDirective(event: NextActionInputEvent): DerivedNextAction | undefined {
  const clauses = event.text?.split(/(?<=[.!?;])\s+/).filter((part) => !/^do not\b/i.test(part.trim()));
  const ordered = clauses?.find((part) => /\bbefore\b/i.test(part));
  const match = ordered?.match(/^(.+?)\s+before\s+(.+?)[.!?]?$/i);
  if (match === null || match === undefined) {
    return undefined;
  }
  const sourceEventIds = [event.id];
  return {
    first: { text: sentence(match[1]!), sourceEventIds, inferred: true },
    then: [],
    forbiddenBefore: [{ text: imperative(match[2]!), sourceEventIds, inferred: true }]
  };
}

function explicitNextDirective(event: NextActionInputEvent): DerivedNextAction | undefined {
  const clauses = event.text?.split(/(?<=[.!?;])\s+/).filter((part) => !/^do not\b/i.test(part.trim()));
  const next = clauses?.find((part) => /\bnext(?:[.!?]|$|\s+and\s+)/i.test(part.trim()));
  if (next === undefined) {
    return undefined;
  }
  const sourceEventIds = [event.id];
  const testFirst = next.match(/^(.+?)\s+next\s+and\s+assert\s+(.+?)[.!?]?$/i);
  if (testFirst !== null) {
    return {
      first: { text: sentence(`Assert ${testFirst[2]!}`), sourceEventIds, inferred: true },
      then: [{ text: sentence(testFirst[1]!), sourceEventIds, inferred: true }],
      forbiddenBefore: []
    };
  }
  const finalAction = next.match(/\band\s+((?:add|write|run|fix|implement|finish|prove|expose|wire)\b.+?)\s+next[.!?]?$/i);
  const text = finalAction?.[1] ?? next.replace(/\s+next(?=[.!?]|$)/i, "");
  return {
    first: { text: sentence(text), sourceEventIds, inferred: true },
    then: [],
    forbiddenBefore: []
  };
}

export function deriveNextAction(events: readonly NextActionInputEvent[]): DerivedNextAction {
  let latestUserIndex = -1;
  let latestAssistantIndex = -1;
  let latestAssistantEvent: NextActionInputEvent | undefined;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.kind === "user-message") {
      latestUserIndex = index;
    }
    if (event.kind === "assistant-message" || event.kind === "agent-checkpoint") {
      latestAssistantIndex = index;
      latestAssistantEvent = event;
    }
  }

  let selected = events[latestUserIndex];
  let inferred = false;
  if (latestAssistantIndex > latestUserIndex) {
    for (let index = events.length - 1; index > latestAssistantIndex; index -= 1) {
      const event = events[index]!;
      if (event.kind === "tool-result" && event.text !== undefined) {
        selected = event;
        inferred = true;
        break;
      }
    }
    if (selected === events[latestUserIndex] && latestAssistantEvent?.kind === "agent-checkpoint") {
      selected = latestAssistantEvent;
      inferred = true;
    }
  }
  if (selected?.text === undefined) {
    throw new Error("a Work Capsule needs evidence for the next action");
  }

  const ordered = orderedDirective(selected);
  if (ordered !== undefined) {
    return ordered;
  }
  const explicitNext = explicitNextDirective(selected);
  if (explicitNext !== undefined) {
    return explicitNext;
  }
  return {
    first: {
      text: inferred ? `Resolve the unresolved source result: ${selected.text}` : selected.text,
      sourceEventIds: [selected.id],
      inferred
    },
    then: [],
    forbiddenBefore: []
  };
}
