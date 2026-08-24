# ChatGPT Role

ChatGPT (or an equivalent configured planning/review model) fills two
distinct positions in a Commander-managed run: **planner** and
**independent Reviewer**. They are never the same invocation or the same
process as the Builder, and per the Operating Constitution, a planner
identity and a Builder identity may never collide, nor may a Reviewer
identity and a Builder identity.

## As planner: goal to bounded engineering intent

- Receives the Owner's natural-language command, an optional target hint,
  the full Operating Constitution, the list of repository aliases
  Commander actually supports, and a short guide to the required
  TaskContract shape. Nothing else.
- Converts that command into one bounded `TaskContract`: an id, a title, a
  target repository, a base branch, an objective, explicit acceptance
  criteria, explicit constraints, a risk level, and `productionMutationAllowed`.
- Must not invent requirements beyond what the command actually asks for.
  If the command is ambiguous about scope, the planner narrows -- it does
  not expand.
- Must fail closed rather than guess: an unsupported target, a
  destructively ambiguous request, or a request with no clear acceptance
  criteria should produce a planner response Commander's own validation
  rejects, not a best-effort contract.
- Has no execution capability. It returns JSON on stdout and nothing more
  -- no GitHub credentials, no workspace, no ability to call any tool that
  mutates repository or infrastructure state. Commander normalizes and
  validates its output through the same pipeline used for a
  human-authored task file before treating it as real.

## As independent Reviewer: challenge, don't rubber-stamp

- Receives the exact remote diff for a commit SHA and the exact CI
  evidence for that same SHA. Never the Builder's workspace, never the
  Builder's credentials, never any shared identity or memory with the
  Builder invocation that produced the diff.
- Its job is to challenge the Builder's output against the task's
  acceptance criteria and constraints -- not to assume good faith, and not
  to defer to the Builder's own description of what it did.
- Its findings (`PASS` / `NEEDS_FIX` / structured reasons) feed Commander's
  verdict logic. They are one input among several (contract compliance, CI
  result, review report) -- never treated as implementation evidence by
  themselves, and never a stand-in for CI actually passing.

## What ChatGPT never does in this system

- Never merges, deploys, or otherwise mutates a target repository or
  infrastructure directly.
- Never receives a GitHub App credential, installation token, or any other
  secret.
- Never acts as Builder and Reviewer (or planner and Builder, or planner
  and Reviewer) within the same task.
- Never has its judgment treated as a substitute for the human decision at
  HUMAN_GATE.
