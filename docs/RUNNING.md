# Running Commander

Commander's Phase-2 pipeline is a library (`runManagedCommander()` and the engines it
composes -- see [`PHASE2_MANAGED_EXECUTION.md`](PHASE2_MANAGED_EXECUTION.md)). This
document covers the one runnable control surface built on top of it:
`commander run --task <task-contract.json>`.

## Prerequisites

- Node.js 22+.
- `COMMANDER_GH_APP_ID`, `COMMANDER_GH_INSTALLATION_ID`, `COMMANDER_GH_PRIVATE_KEY` set in
  the trusted runtime environment -- see [`AUTH_GITHUB_APP.md`](AUTH_GITHUB_APP.md). Never
  `GITHUB_TOKEN`/`GH_TOKEN`; Commander does not read them and has no fallback to them.
- A Builder command and a Reviewer command: two separate trusted executables that speak the
  JSON-in/JSON-out contract described in `PHASE2_MANAGED_EXECUTION.md`'s "Active provider
  protocol" section, with two different provider identities.

## Runtime configuration (environment variables)

All required values are read only from the trusted runtime process environment.
`loadRuntimeConfigFromEnv` (`src/config/runtime-config.ts`) fails closed -- it throws,
rather than silently defaulting, if a required value is missing or if the builder and
reviewer identities collide.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `COMMANDER_GH_APP_ID` | yes | - | GitHub App ID |
| `COMMANDER_GH_INSTALLATION_ID` | yes | - | GitHub App installation ID |
| `COMMANDER_GH_PRIVATE_KEY` | yes | - | GitHub App private key (PEM) |
| `COMMANDER_BUILDER_COMMAND` | yes | - | Executable implementing the Builder JSON contract |
| `COMMANDER_BUILDER_NAME` | no | `claude` | Builder provider identity |
| `COMMANDER_BUILDER_ARGS` | no | `[]` | JSON array of extra args for the builder command |
| `COMMANDER_BUILDER_TIMEOUT_MS` | no | `600000` | Builder command timeout |
| `COMMANDER_BUILDER_MAX_OUTPUT_BYTES` | no | `1048576` | Builder stdout cap |
| `COMMANDER_REVIEWER_COMMAND` | yes | - | Executable implementing the Reviewer JSON contract |
| `COMMANDER_REVIEWER_NAME` | no | `independent-reviewer` | Reviewer identity (must differ from the builder's) |
| `COMMANDER_REVIEWER_ARGS` / `_TIMEOUT_MS` / `_MAX_OUTPUT_BYTES` | no | same as builder | Reviewer command tuning |
| `COMMANDER_CI_MAX_ATTEMPTS` | no | `30` | commit-bound CI poll attempts |
| `COMMANDER_CI_INTERVAL_MS` | no | `10000` | commit-bound CI poll interval (ms) |

## The `commander run` command

```bash
npm run build
node dist/cli/run.js run --task <task-contract.json>
```

or, equivalently, the npm script:

```bash
npm run commander -- run --task <task-contract.json>
```

In order, it: validates the task file and resolves its target (a supported alias --
`Commander` / `Owner` / `ClinicOS` -- or an exact `owner/repo`); loads runtime configuration
(fails closed on anything missing); instantiates the one canonical broker-backed
`GitHubRestClient`; runs a live GitHub App installation/permission check against the task's
target (fails closed); instantiates the Builder and Reviewer provider adapters; and hands
off to `runManagedCommander()` -- the existing
`TASK -> TARGET_LOCK -> TARGET_ACCESS_VERIFY -> BUILD -> VERIFY -> PUBLISH -> CI -> REVIEW -> VERDICT -> HUMAN_GATE`
pipeline. No step here re-implements any part of that pipeline.

It prints one JSON object describing the outcome and sets a process exit code:

- `0` -- the run reached `HUMAN_GATE` (verdict was `PASS`). Nothing merges or deploys
  automatically; that remains a separate human action.
- `1` -- the run legitimately stopped `BLOCKED` at some stage (build/verification failure,
  CI failure, incomplete review coverage, `NEEDS_FIX`/`BLOCKED` verdict, ...).
- `2` -- a pre-flight failure: bad CLI arguments, an invalid task file, missing runtime
  configuration, or a failed GitHub App validation.

## One exact runnable example (harmless test task)

Save as `task.json`:

```json
{
  "id": "T-doc-example",
  "title": "Add a harmless doc comment",
  "targetRepository": "Commander",
  "objective": "Demonstrate the Commander managed-execution CLI end to end with a trivial, reviewable change.",
  "acceptanceCriteria": [
    {
      "id": "A1",
      "requirement": "A short comment is added to docs/PHASE2_MANAGED_EXECUTION.md without changing its meaning",
      "evidenceRequired": ["diff"]
    }
  ],
  "constraints": [
    "No dependency changes",
    "No changes outside docs/"
  ],
  "riskLevel": "low",
  "productionMutationAllowed": false
}
```

`targetRepository: "Commander"` resolves to `avatarbd1/multi-ai-commander` through the same
target resolver the live orchestration run uses.

With the environment variables above set in a trusted runtime, and `COMMANDER_BUILDER_COMMAND`
/ `COMMANDER_REVIEWER_COMMAND` pointing at real trusted executables:

```bash
npm run build
node dist/cli/run.js run --task ./task.json
```

This slice does not ship a bundled Claude Builder or reviewer executable --
`ClaudeBuilderAdapter` and `IndependentReviewerAdapter` are trusted wrappers around whatever
command is configured; they never assume or fabricate a live call. Until a native Claude
CLI/runtime is wired into `COMMANDER_BUILDER_COMMAND`, point it (and
`COMMANDER_REVIEWER_COMMAND`) at a command that implements the same JSON contract the
automated tests exercise (see `tests/cli-run.test.mjs`).

Given a valid task file, a passing `COMMANDER_GH_*` GitHub App validation, and working
Builder/Reviewer commands, `commander run` genuinely opens a Draft PR against
`avatarbd1/multi-ai-commander` bound to the exact published commit SHA and stops at
`HUMAN_GATE` -- merge remains a separate, explicit human action.

## What this slice does not add

- No automatic fix-and-retry loop.
- No auto-merge, no auto-deploy.
- No second GitHub client/auth engine -- `commander run` uses the same broker-backed
  `GitHubRestClient` and `createGitHubAppClient` as every other Commander entrypoint.
- No LLM task planner -- the task contract is supplied by the operator as a JSON file.
