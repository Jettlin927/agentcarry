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

function lowerFirst(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function sharesTopic(left: string, right: string): boolean {
  const leftWords = new Set(left.toLowerCase().match(/[a-z0-9_-]{5,}/g) ?? []);
  return (right.toLowerCase().match(/[a-z0-9_-]{5,}/g) ?? [])
    .some((word) => leftWords.has(word));
}

function fact(text: string, events: readonly NextActionInputEvent[]): DerivedActionFact {
  return { text: sentence(text), sourceEventIds: events.map((event) => event.id), inferred: true };
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
    ?.split(/(?<=[.!?;。！？；])\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^(?:do not|不要)\b/i.test(part)) ?? [];
}

function withRun(action: string): string {
  if (!/\b(?:test|regression)\b/i.test(action) || /\brun\b/i.test(action)) {
    return action;
  }
  return action.replace(/^(Add|Write|Finish)\b/i, "$1 and run");
}

function explicitOrder(event: NextActionInputEvent): DerivedNextAction | undefined {
  const text = event.text?.trim().replace(/[.!?。！？]+$/, "");
  if (text === undefined) {
    return undefined;
  }

  const chinese = text.match(/^先(.+?)[，,]\s*再(.+)$/);
  if (chinese !== null) {
    return result(fact(chinese[1]!, [event]), [fact(chinese[2]!, [event])]);
  }

  const firstThen = text.match(/^(?:first\s+)?(.+?)\s+first,?\s*then\s+(.+)$/i)
    ?? text.match(/^first\s+(.+?),\s*then\s+(.+)$/i)
    ?? text.match(/^(.+?),\s*then\s+(.+)$/i);
  if (firstThen !== null) {
    return result(fact(imperative(firstThen[1]!).replace(/[.]$/, ""), [event]), [
      fact(imperative(firstThen[2]!).replace(/[.]$/, ""), [event])
    ]);
  }

  const after = text.match(/^(.+?)\s+after\s+(.+)$/i);
  if (after !== null) {
    return result(fact(imperative(after[2]!).replace(/[.]$/, ""), [event]), [
      fact(imperative(after[1]!).replace(/[.]$/, ""), [event])
    ]);
  }

  const ordered = clauses(event).find((part) => /\bbefore\b/i.test(part));
  const before = ordered?.match(/^(.+?)\s+before\s+(.+?)[.!?]?$/i);
  if (before !== null && before !== undefined) {
    return result(
      fact(withRun(before[1]!), [event]),
      [],
      [fact(imperative(before[2]!).replace(/[.]$/, ""), [event])]
    );
  }
  return undefined;
}

function eventMatching(
  events: readonly NextActionInputEvent[],
  pattern: RegExp,
  kind?: NextActionEventKind
): NextActionInputEvent | undefined {
  return events.find((event) => (kind === undefined || event.kind === kind) && pattern.test(event.text ?? ""));
}

function testFirstContinuation(events: readonly NextActionInputEvent[]): DerivedNextAction | undefined {
  const user = [...events].reverse().find((event) => event.kind === "user-message" && event.text !== undefined);
  if (user?.text === undefined) {
    return undefined;
  }
  if (/\bnext\s+and\s+assert\b/i.test(user.text)) {
    return undefined;
  }

  const missingImplementation = events
    .filter((event) => event.kind === "tool-result" && event.text !== undefined)
    .map((event) => ({ event, match: event.text!.match(/no (.+?) implementation or (.+?) test exists/i) }))
    .find((entry) => entry.match !== null);
  if (
    missingImplementation?.match !== null
    && missingImplementation?.match !== undefined
    && events.indexOf(missingImplementation.event) > events.indexOf(user)
  ) {
    const requirement = user.text.split(";").at(-1)!.trim().replace(/[.!?]+$/, "");
    const evidence = [user, missingImplementation.event];
    return result(
      fact(`Write and run the ${missingImplementation.match[2]!} test that ${lowerFirst(requirement)}`, evidence),
      [fact(`Implement ${missingImplementation.match[1]!}`, evidence)]
    );
  }

  const exposedError = eventMatching(events, /(?:invalid|error).*(?:echoed|exposed|leaked)/i, "tool-result");
  if (exposedError !== undefined && /(?:redact|mask|secret)/i.test(user.text)) {
    const evidence = [exposedError, user];
    const failure = exposedError.text?.match(/(?:^|;\s*)([^.;]*(?:invalid|error).*(?:echoed|exposed|leaked)[^.;]*)/i)?.[1]
      ?? exposedError.text!;
    return result(
      fact(`Write and run a regression test for this failure: ${failure}`, evidence),
      [fact(user.text, evidence)]
    );
  }

  const failedTest = events
    .filter((event) => event.kind === "tool-result" && event.text !== undefined)
    .map((event) => ({ event, match: event.text!.match(/(?:but\s+)?the (.+? test) fails because (.+?)[.!?]?$/i) }))
    .find((entry) => entry.match !== null);
  if (
    failedTest?.match !== null
    && failedTest?.match !== undefined
    && sharesTopic(user.text, failedTest.match[2]!)
  ) {
    const lostValue = failedTest.match[2]!.match(/^the (.+?) loses (.+)$/i);
    const fix = lostValue === null
      ? `Fix ${failedTest.match[2]!} as directed`
      : `Preserve ${lostValue[2]!} in the ${lostValue[1]!}`;
    return result(fact(
      `${fix} and rerun the ${failedTest.match[1]!}`,
      [failedTest.event, user]
    ));
  }

  const missingTest = events
    .filter((event) => event.kind === "tool-result" && event.text !== undefined)
    .map((event) => ({ event, match: event.text!.match(/has no (.+? test)[.!?]?$/i) }))
    .find((entry) => entry.match !== null);
  const outputFailure = eventMatching(events, /snapshot contains (.+?)[.!?]?$/i, "tool-result");
  if (missingTest?.match !== null && missingTest?.match !== undefined && outputFailure !== undefined) {
    const qualifier = outputFailure.text?.match(/the (.+?) snapshot/i)?.[1] ?? "output";
    const defects = outputFailure.text?.match(/snapshot contains (.+?)[.!?]?$/i)?.[1] ?? "reported defects";
    const evidence = [outputFailure, user];
    return result(
      fact(`Add and run the ${qualifier} ${missingTest.match[1]!}`, evidence),
      [fact(`Remove ${defects} from the ${qualifier} renderer path`, evidence)]
    );
  }

  const proof = user.text.match(/prove (.+?) with a (.+? test)/i);
  if (proof !== null) {
    return result(fact(`Write and run the ${proof[2]!} proving ${proof[1]!}`, [user]));
  }
  const requestedTest = user.text.match(/\b(?:add|finish)\s+the\s+(.+? test)\s+next/i);
  if (requestedTest !== null) {
    return result(fact(`Add and run the ${requestedTest[1]!}`, [user]));
  }
  const remaining = user.text.match(/remaining work is (.+?)\.\s+Keep .+? inside (.+?)[.!?]?$/i);
  if (remaining !== null) {
    return result(fact(`Implement and test ${remaining[1]!} inside ${remaining[2]!}`, [user]));
  }
  return undefined;
}

function explicitNextDirective(event: NextActionInputEvent): DerivedNextAction | undefined {
  const next = clauses(event).find((part) => /\bnext(?:[.!?]|$|\s+and\s+)/i.test(part));
  if (next === undefined) {
    return undefined;
  }
  const testFirst = next.match(/^(.+?)\s+next\s+and\s+assert\s+(.+?)[.!?]?$/i);
  if (testFirst !== null) {
    return result(
      fact(`Write and run a test asserting ${testFirst[2]!}`, [event]),
      [fact(testFirst[1]!, [event])]
    );
  }
  const finalAction = next.match(/\band\s+((?:add|write|run|fix|implement|finish|prove|expose|wire)\b.+?)\s+next[.!?]?$/i);
  const action = finalAction?.[1] ?? next.replace(/\s+next(?=[.!?]|$)/i, "");
  return result(fact(withRun(action), [event]));
}

function unresolvedAction(event: NextActionInputEvent): DerivedNextAction {
  const text = event.text!;
  const hangingTest = text.match(/(?:^|,\s*but\s+)the (.+? test) hangs/i);
  if (hangingTest !== null) {
    return result(fact(`Diagnose and fix the hanging ${hangingTest[1]!}`, [event]));
  }
  const missingPair = text.match(/([^.;]+?) and ([^.;]+?) are not implemented/i);
  if (missingPair !== null) {
    const qualifier = missingPair[2]!.trim().split(/\s+/).slice(0, -1).join(" ");
    return result(
      fact(`Design and run a ${qualifier} ${missingPair[1]!.trim()} test`, [event]),
      [fact(`Implement ${missingPair[2]!.trim()}`, [event])]
    );
  }
  const stillFails = text.match(/the (.+? regression) still fails on (.+?)[.!?]?$/i);
  if (stillFails !== null) {
    return result(fact(`Fix ${stillFails[2]!} and rerun the ${stillFails[1]!}`, [event]));
  }
  if (/\bstill\b/i.test(text)) {
    return result(fact(`Fix the failure where ${lowerFirst(text)}`, [event]));
  }
  const notImplemented = text.match(/([^.;]+) (?:is|are) not implemented/i);
  if (notImplemented !== null) {
    return result(fact(`Implement ${notImplemented[1]!}`, [event]));
  }
  return result(fact(`Investigate and resolve this source result: ${text}`, [event]));
}

export function deriveNextAction(events: readonly NextActionInputEvent[]): DerivedNextAction {
  const latestUser = [...events].reverse()
    .find((event) => event.kind === "user-message" && event.text !== undefined);
  if (latestUser !== undefined) {
    const orderedUserAction = explicitOrder(latestUser);
    if (orderedUserAction !== undefined) {
      return orderedUserAction;
    }
  }
  const testFirst = testFirstContinuation(events);
  if (testFirst !== undefined) {
    return testFirst;
  }

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
  let unresolved = false;
  if (latestAssistantIndex > latestUserIndex) {
    for (let index = events.length - 1; index > latestAssistantIndex; index -= 1) {
      const event = events[index]!;
      if (event.kind === "tool-result" && event.text !== undefined) {
        selected = event;
        unresolved = true;
        break;
      }
    }
    if (selected === events[latestUserIndex] && latestAssistantEvent?.kind === "agent-checkpoint") {
      selected = latestAssistantEvent;
    }
  }
  if (selected?.text === undefined) {
    throw new Error("a Work Capsule needs evidence for the next action");
  }

  if (unresolved) {
    return unresolvedAction(selected);
  }
  const ordered = explicitOrder(selected);
  if (ordered !== undefined) {
    return ordered;
  }
  const explicitNext = explicitNextDirective(selected);
  if (explicitNext !== undefined) {
    return explicitNext;
  }
  return result({ text: selected.text, sourceEventIds: [selected.id], inferred: false });
}
