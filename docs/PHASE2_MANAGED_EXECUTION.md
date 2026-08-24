# Phase 2 Managed Execution

Phase 2 turns Commander from a captured-evidence verdict engine into a managed, human-gated execution workflow.

## Runtime flow

`TASK -> TARGET_LOCK -> TARGET_ACCESS_VERIFY -> BUILD -> VERIFY -> PUBLISH -> CI -> REVIEW -> VERDICT -> HUMAN_GATE`

A failure at any pre-gate stage terminates as `BLOCKED`. `PASS` never merges or deploys automatically.

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

## Human gate

The integrated `runManagedCommander()` path stops at `HUMAN_GATE` only when the deterministic Phase-1 verdict is `PASS`. `NEEDS_FIX` and `BLOCKED` do not advance to merge. Production deployment remains outside this workflow and requires separate explicit approval.

## Running it

`commander run --task <task-contract.json>` is the one runnable control surface over this pipeline: it validates the task, loads runtime configuration, verifies GitHub App access, wires the canonical GitHub client and the Builder/Reviewer provider adapters, and invokes `runManagedCommander()`. See [`RUNNING.md`](RUNNING.md) for the exact command, required environment variables, and a runnable example task.
