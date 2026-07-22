# AgentCarry

AgentCarry describes task continuity between coding agents without claiming that
their private session state is interchangeable.

## Language

**Work Capsule**:
The evidence-backed, agent-neutral state required to continue one coding task.
_Avoid_: Export, transcript bundle, memory dump

**Loss Receipt**:
The explicit account of task state that was unavailable, redacted, inferred, or
otherwise not transferred with a Work Capsule.
_Avoid_: Warning log, migration notes

**Handoff Attempt**:
One person's single use of AgentCarry to transfer a real coding task from a
source session into a target session, ending in continuation or a blocker.
_Avoid_: Test run, migration

**Continuation**:
The target agent receives the handoff and begins the recorded first action
without requiring the person to paste private source messages.
_Avoid_: Target launched, session created, reply received

**Acceptance Record**:
A privacy-safe, publicly auditable account of one Handoff Attempt and its
outcome.
_Avoid_: Testimonial, survey response

**Non-author Participant**:
A person who had not authored AgentCarry repository changes before their
Handoff Attempt.
_Avoid_: User, tester

**Manual Supplement**:
Task information a participant must add after launch before Continuation is
possible.
_Avoid_: Clarification, correction

**Time to Continuation**:
Elapsed wall-clock time from entering the AgentCarry command until the target
agent begins the recorded first action.
_Avoid_: Launch time, response latency
