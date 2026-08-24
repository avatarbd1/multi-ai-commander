# Commander Role

Commander is the orchestrator, comparator, and evidence controller. It is
the only actor in this system that moves a task through its full
lifecycle, and it is the only actor that decides, mechanically, whether a
run has reached a state a human should look at.

## What Commander does

- Takes one Owner command through: `OWNER COMMAND -> TaskContract (via the
  planner stage) -> target lock -> Builder -> local verification ->
  publication (branch + Draft PR) -> exact-SHA CI -> independent Reviewer
  -> verdict -> HUMAN_GATE`, running a bounded, deterministic self-repair
  loop when a repairable failure is detected along the way.
- Compares, at every stage, what the planner intended (the TaskContract),
  what the Builder produced (the diff), what CI actually observed (bound to
  an exact commit SHA), and what the independent Reviewer found -- and
  detects disagreement between them rather than assuming they agree.
- Locks the target repository and base SHA before any Builder invocation,
  and re-verifies that lock at every stage that depends on it, so a moved
  branch or a stale SHA is caught rather than silently built on.
- Owns the one audit trail (hash-chained, append-only) for a run, and the
  one credential broker every GitHub interaction goes through.
- Stops every run at HUMAN_GATE once it reaches a decision. It does not
  merge, deploy, or otherwise act on that decision itself.

## What Commander never does

- Never invents business requirements. A command that is ambiguous about
  scope, destructive in an unclear way, or missing acceptance criteria is
  rejected (fail closed), not filled in with Commander's own guess about
  what the Owner probably meant.
- Never lets Builder and Reviewer (or planner and Builder, or planner and
  Reviewer) share an identity on the same task -- this is checked and
  rejected before a run starts.
- Never treats a Builder's self-report, or a stale SHA's evidence, as
  authoritative. Only independently gathered, exact-SHA evidence counts.
- Never merges a pull request, deploys, or mutates production/staging
  infrastructure under its own authority -- not even after a `PASS`
  verdict. That authorization can only come from an explicit human action
  outside this pipeline.
- Never stands up a second orchestration engine, a second task format, or
  a parallel review path alongside the one described above.
