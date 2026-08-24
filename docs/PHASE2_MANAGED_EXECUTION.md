# Phase 2 Managed Execution

Phase 2 turns Commander from a captured-evidence verdict engine into a managed, human-gated execution workflow.

## Runtime flow

```text
TASK -> TARGET_LOCK -> TARGET_ACCESS_VERIFY -> BUILD -> VERIFY -> PUBLISH -> CI -> REVIEW -> VERDICT
                                                  ^                                              |
                                                  |                                          NEEDS_FIX /
                                                  +------------------ REPAIR <-----------  repairable failure
                                                                                              |
                                                                                          repair limit /
                                                                                       non-retryable / no
                                                                                       progress -> BLOCKED
```

A *repairable* failure (see "Bounded self-correcting repair loop" below) transitions through `REPAIR` back to
`BUILD` with a structured repair instruction, bounded by a strict retry limit. Every other failure -- at any
stage -- terminates immediately as `BLOCKED`, with no `REPAIR` hop. `PASS` never merges or deploys
automatically; only a final deterministic `PASS` reaches `HUMAN_GATE`.

## Managed builder

`ManagedBuilderRunner` creates a temporary Commander-owned Git workspace at the exact target `main` SHA, invokes an active builder provider inside that workspace, discovers changed files from Git, and runs verification automatically. The default verification planner supports Node repositories and runs install plus any available `lint`, `typecheck`, `test`, and `build` scripts.

Builder subprocesses inherit only a minimal safe environment. Commander GitHub App credentials, `GITHUB_TOKEN`, and `GH_TOKEN` are not inherited and cannot be explicitly passed through the JSON command provider.

The default local Git materializer uses read-only HTTPS clone/fetch and therefore requires the target repository to be publicly readable. A private target must use a trusted alternate workspace materializer; failure to fetch blocks the run instead of falling back to secret transfer.

## Publication

`PublicationOrchestrator` reuses the broker-backed `GitHubRestClient`. It creates the task branch at the locked base SHA, writes or deletes the exact managed changes, opens a Draft PR, and verifies that the resulting PR head matches the final pushed commit SHA.

## Commit-bound CI

`waitForCommitBoundCi()` polls CI for the exact published commit. Missing, pending, mismatched, failed, skipped, neutral, or cancelled checks do not pass the gate.

## Independent review

`IndependentReviewerRunner` requires an active reviewer provider whose identity differs from the builder. Before invocation it verifies PR and CI SHAs against the builder commit, fetches the exact remote PR diff through GitHub, and supplies that diff to the reviewer. Missing diff or incomplete acceptance-criterion coverage blocks the run.

## Active provider protocol

`JsonCommandBuilderProvider` and `JsonCommandReviewProvider` are process adapters. The command receives one JSON request on stdin and must emit one JSON payload on stdout. Builder commands execute with the managed workspace as their current working directory. Reviewer commands receive the task, builder evidence, PR metadata, commit-bound CI evidence, and exact PR diff.

Provider commands are run without a shell, with timeout and output-size limits. They can be wrappers around local AI CLIs or other trusted workers.

## Bounded self-correcting repair loop

`runManagedCommander()` does not stop at the first failure it can plausibly fix. When a failure is
*repairable*, it builds a structured `RepairRequest` from the exact evidence of that failure and sends it
back to the same configured Builder for another attempt, republishing to the same Draft PR and re-running
CI and independent review from scratch. This is still one orchestration engine and one state machine (see
`src/orchestration/state-machine.ts`) -- a repair is just another `BUILD` invocation, now carrying a
`RepairRequest`, reached through a new `REPAIR` state.

**What is repairable** (transitions to `REPAIR`):
- Local Builder verification failure (a failing `lint`/`typecheck`/`test`/`build` step), with the failing
  check's name and exit code as diagnostics.
- Commit-bound CI failure with real check-run evidence (`CI_NOT_SUCCESS`).
- A deterministic verdict of `NEEDS_FIX` (unmet acceptance criteria and/or reviewer findings).

**What is never repairable** (`BLOCKED` immediately, no `REPAIR` hop, zero repair attempts consumed):
authentication failure, GitHub App installation/permission failure, repository mismatch, an
unsupported/ambiguous target, Builder/Reviewer identity collision, broken reviewer independence, a
publication SHA mismatch, stale or mismatched CI/PR evidence (`CI_SHA_MISMATCH`, `CI_MISSING`,
`CI_PENDING` after exhausting polling, `REVIEW_PR_SHA_MISMATCH`, `REVIEW_CI_SHA_MISMATCH`), incomplete
reviewer coverage, and a deterministic verdict of `BLOCKED` (as opposed to `NEEDS_FIX`). These are
integrity/security conditions, not code defects a repair could plausibly fix -- retrying them would either
loop pointlessly or paper over a real problem.

**Retry policy.** `RepairPolicy.maxRepairCycles` bounds how many repair attempts a run may use --
default `2`, hard maximum `3` (`src/orchestration/repair-policy.ts`; `COMMANDER_MAX_REPAIR_CYCLES` at the
CLI, see [`RUNNING.md`](RUNNING.md)). There is no way to configure an unlimited loop. Exhausting the
budget stops the run `BLOCKED` with `REPAIR_LIMIT_EXCEEDED`.

**No-progress detection.** Before spending another repair attempt, Commander compares the current
attempt's changeset and failure outcome against the immediately preceding attempt
(`src/orchestration/repair-progress.ts`) -- both are deterministic fingerprints (a content hash of the
diff, and the failing check names/reasons), not an LLM judgment call. If a repair changed nothing
material and hit the same wall again, the run stops `BLOCKED` with `NO_PROGRESS_DETECTED` immediately,
without waiting to exhaust the full retry budget. A repair whose Builder invocation produces no diff at
all fails the same way, via `BUILDER_PRODUCED_NO_CHANGES`.

**One PR per task.** A repair updates the *same* Builder branch and Draft PR rather than opening a new
one: `PublicationOrchestrator.publish()` accepts the previous `{branch, pullRequestNumber}` and, when
given, skips creating a new branch/PR and instead pushes the new commit to the existing branch and
re-fetches the existing PR to confirm its head. `getFileMetadata` is always checked against the branch's
*current* head (not the task's base SHA), so a repair correctly treats a file the first attempt already
added as "update", not "create" -- otherwise it would collide with the previous attempt's own commit.

**Repair workspace continuity.** A repair's local workspace starts from the *previous attempt's exact
published SHA* -- the current task branch's own head -- not a fresh checkout of the original locked base.
`ManagedBuilderRunner` re-derives the task's deterministic branch name and fetches it at
`RepairRequest.previousBuilderSha` (after first asserting that SHA equals `RepairRequest.pullRequestHeadSha`
-- both were set from the same prior publish, so they must already agree); `LocalGitWorkspaceManager`'s own
git-level fetch then independently confirms the *remote's actual current state* matches that expectation,
failing closed (`REPAIR_START_SHA_MISMATCH`) rather than proceeding on a stale assumption if it doesn't. The
Builder subprocess itself never fetches anything or needs GitHub credentials -- Commander establishes the
exact starting tree before invoking it. Because the workspace already contains everything the previous
attempt published, `collectChanges` against that same SHA yields the *true incremental repair delta* (only
what actually changed this attempt), so a repair that only touches file B can never lose attempt 1's fix to
file A -- there is nothing to reconstruct, and nothing gets silently erased. A repair that has no previous
publish to continue from (a local-verification failure repaired before anything was ever published) falls
back to the locked base, same as an initial attempt.

**Exact-SHA freshness.** Every attempt re-establishes, independently, that Builder output SHA = remote PR
head SHA = CI SHA = the SHA the reviewer actually inspected -- the same invariant a single-attempt run
already enforced (`PublicationOrchestrator`'s head-match check, `IndependentReviewerRunner`'s PR/CI SHA
checks). A repair never reuses a previous attempt's CI or review evidence: `waitForCommitBoundCi` and the
independent reviewer are both invoked fresh, against the exact new commit, every attempt. Any SHA mismatch
blocks immediately rather than retrying.

**Base branch drift.** Before publishing a repair, Commander re-reads the target's current base branch
head and compares it to the SHA locked at the start of the run. If the base has moved, the run stops
`BLOCKED` with `BASE_BRANCH_DRIFTED` rather than silently republishing against a now-stale assumption --
picking up a moved base is a controlled rebase/replan decision, not something a repair cycle does
automatically.

**Audit trail.** Every attempt is recorded in the same canonical `AuditChain` a single-attempt run already
used (`orchestration.attempt`, `builder.work`, `builder.output`, `pull_request.created` /
`pull_request.updated`, `ci.evidence`, `review.report`, `commander.verdict`), plus an
`orchestration.repair` event per repair capturing the attempt transition and its trigger. The chain stays
hash-linked and verifiable across the whole multi-attempt sequence -- there is no separate audit system
for repairs.

## Human gate

The integrated `runManagedCommander()` path stops at `HUMAN_GATE` only when the deterministic Phase-1 verdict is `PASS` -- whether that happens on the first attempt or after one or more repairs. `NEEDS_FIX` and `BLOCKED` do not advance to merge. Production deployment remains outside this workflow and requires separate explicit approval.

## Running it

`commander run --task <task-contract.json>` is the one runnable control surface over this pipeline: it validates the task, loads runtime configuration, verifies GitHub App access, wires the canonical GitHub client and the Builder/Reviewer provider adapters, and invokes `runManagedCommander()`. See [`RUNNING.md`](RUNNING.md) for the exact command, required environment variables, and a runnable example task.
