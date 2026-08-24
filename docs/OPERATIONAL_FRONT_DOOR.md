# Operational Front Door

This is Commander's one operational entry point for the Owner: a GitHub Actions workflow
that takes a single high-level instruction and drives it, unattended, through

```text
OWNER COMMAND
   -> TaskContract           (commander plan)
   -> target lock
   -> Builder
   -> local verification
   -> Draft PR
   -> exact-SHA CI
   -> independent Reviewer
   -> bounded repair loop
   -> HUMAN_GATE
```

It replaces nothing described in [`RUNNING.md`](RUNNING.md) or
[`PHASE2_MANAGED_EXECUTION.md`](PHASE2_MANAGED_EXECUTION.md) -- `commander plan` and
`commander run` are the same CLIs documented there, just invoked back-to-back by the
workflow instead of by hand. See [`OPERATING_CONSTITUTION.md`](../OPERATING_CONSTITUTION.md),
[`CHATGPT_ROLE.md`](../CHATGPT_ROLE.md), [`CLAUDE_ROLE.md`](../CLAUDE_ROLE.md), and
[`COMMANDER_ROLE.md`](../COMMANDER_ROLE.md) for the behavioral contract every actor in this
flow operates under.

## How the Owner uses it

1. Go to the repository on GitHub.
2. **Actions** tab -> **Commander Run** in the left sidebar.
3. **Run workflow**.
4. Type one command into the **command** field, e.g.:

   > Complete T2-01 staff tenant membership and take it to HUMAN_GATE.

5. Optionally pick a **target** (`Commander` / `Owner` / `ClinicOS`) from the dropdown, or
   leave it on `(let planner infer)` to let the planning stage read the target out of the
   command text itself. Picking a target explicitly is safer whenever the command doesn't
   unambiguously name a repository -- if the planner's own choice of target ever disagrees
   with an explicitly picked one, the run fails closed (`PLANNER_TARGET_MISMATCH`) rather than
   silently using either.
6. **Run workflow**.

No one authors JSON by hand. The workflow's own **Convert command to a bounded
TaskContract** step is what turns the typed command into a `TaskContract`, through the exact
same normalization and validation (`normalizeTaskContract` / `validateTaskContract`) that a
hand-authored task file goes through.

The run's outcome (job summary, tab) always shows one of:

- **HUMAN_GATE** -- the Draft PR URL, its exact head SHA, and how many Builder attempts it
  took. A human decides whether to merge; the workflow does not.
- **BLOCKED** -- the exact blocker (a non-retryable failure, the repair-cycle limit, or
  no-progress detection).
- **ERROR** -- a pre-flight failure: bad input, invalid/ambiguous command, missing runtime
  configuration, or a failed GitHub App validation.

The workflow never merges a pull request and never deploys anything, regardless of outcome.

## Required repository configuration

### Secrets (Settings -> Secrets and variables -> Actions -> Secrets)

| Secret | Purpose |
| --- | --- |
| `COMMANDER_GH_APP_ID` | GitHub App ID -- Commander's only credential path (see [`AUTH_GITHUB_APP.md`](AUTH_GITHUB_APP.md)) |
| `COMMANDER_GH_INSTALLATION_ID` | GitHub App installation ID |
| `COMMANDER_GH_PRIVATE_KEY` | GitHub App private key (PEM) |

These are never echoed to a log, never written into a generated task file, and never passed
to the planner/Builder/Reviewer subprocess -- they reach only Commander's own credential
broker.

### Variables (Settings -> Secrets and variables -> Actions -> Variables)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `COMMANDER_GH_VERIFY_REPOSITORY` | no | - | `owner/repo` for an extra live installation-access sanity check in the preflight step |
| `COMMANDER_PLANNER_COMMAND` | **yes** | - | Executable implementing the planner JSON contract (`PlannerRequest` in, `TaskContract` out) |
| `COMMANDER_PLANNER_NAME` | no | `chatgpt-planner` | Planner provider identity (must differ from the Builder's and the Reviewer's) |
| `COMMANDER_PLANNER_ARGS` / `_TIMEOUT_MS` / `_MAX_OUTPUT_BYTES` | no | - / `600000` / `1048576` | Planner command tuning |
| `COMMANDER_BUILDER_COMMAND` | **yes** | - | Executable implementing the Builder JSON contract |
| `COMMANDER_BUILDER_NAME` | no | `claude` | Builder provider identity |
| `COMMANDER_BUILDER_ARGS` / `_TIMEOUT_MS` / `_MAX_OUTPUT_BYTES` | no | - / `600000` / `1048576` | Builder command tuning |
| `COMMANDER_REVIEWER_COMMAND` | **yes** | - | Executable implementing the Reviewer JSON contract |
| `COMMANDER_REVIEWER_NAME` | no | `independent-reviewer` | Reviewer provider identity (must differ from the Builder's and the planner's) |
| `COMMANDER_REVIEWER_ARGS` / `_TIMEOUT_MS` / `_MAX_OUTPUT_BYTES` | no | - / `600000` / `1048576` | Reviewer command tuning |
| `COMMANDER_CI_MAX_ATTEMPTS` / `COMMANDER_CI_INTERVAL_MS` | no | `30` / `10000` | commit-bound CI poll bounds |
| `COMMANDER_MAX_REPAIR_CYCLES` | no | `2` | bounded repair attempts (hard maximum `3`) |

Missing any **yes** row above stops the run at the **Validate required runtime
configuration** step with the exact missing variable named -- never a silent default,
never a partial run.

## The planner and Reviewer are wrapper interfaces, not bundled models

`COMMANDER_PLANNER_COMMAND` and `COMMANDER_REVIEWER_COMMAND` must point at an operator-supplied
executable that speaks the relevant JSON-on-stdin/JSON-on-stdout contract (see
`src/planner/planner-request.ts` for the planner's request shape, and
`src/review/independent-reviewer-runner.ts` for the reviewer's). This repository does not ship
a real ChatGPT/OpenAI-backed executable for either role: `PlannerAdapter` and
`IndependentReviewerAdapter` are fully implemented, tested wrappers that fail closed
(`PLANNER_COMMAND_REQUIRED` / `INDEPENDENT_REVIEWER_COMMAND_REQUIRED`) when no executable is
configured, and they never fabricate a live result if one is misconfigured or unreachable.

**Exact remaining requirement to make either live:** an executable, reachable at the
configured path in the Actions runner, that reads the documented JSON request on stdin and
writes the documented JSON response on stdout within the configured timeout. How that
executable obtains its own model credentials (an API key, a service account, a mounted
secret) is outside Commander's scope by design: Commander's credential firewall
(`buildEnvironment()` in `src/providers/json-command-provider.ts`) deliberately does not
forward arbitrary environment variables -- including third-party model API keys -- into the
planner/Builder/Reviewer subprocess; it forwards only `PATH`/`HOME`/`TMPDIR`-class variables
plus whatever is explicitly in that provider's own `env` config. This is the same boundary
that keeps GitHub App credentials from ever reaching those subprocesses. A real wrapper must
therefore source its own model credentials through its own trusted channel (its own config
file, a mounted secret, a keychain) rather than expecting Commander to hand it one.

Until such an executable is configured, `COMMANDER_PLANNER_COMMAND` /
`COMMANDER_REVIEWER_COMMAND` may point at any deterministic stand-in that honors the same
contract (as the test suite's stub scripts do) for staging/testing -- but a real Owner command
against a real target should not be run that way, since a stand-in cannot make a genuine
planning or review judgment.

## First real command: ready, not yet executed

The front door is ready to accept, as its first real Owner command:

> Complete T2-01 staff tenant membership and take it to HUMAN_GATE.

This task was **not** executed as part of building this front door -- only the front door
itself was built and verified. To run it for real: pick whichever of `Owner` /
`ClinicOS` actually contains T2-01 as the **target** (don't leave it on
`(let planner infer)` for a task-ID-specific command like this one, since the planner has no
way to look up which repository a given task ID lives in), and ensure a real planner and a
real Builder/Reviewer are configured as described above.

## What this slice does not add

- No second orchestration engine and no replacement for `commander run` -- the workflow is a
  thin, auditable caller of the existing `commander plan` / `commander run` CLIs.
- No auto-merge, no auto-deploy, anywhere in the workflow.
- No Owner/ClinicOS code changes -- this slice only builds Commander's own front door.
- No production-mutation path -- `commander plan` unconditionally forces
  `productionMutationAllowed: false` on every generated task, since this front door exposes no
  explicit-authorization input.
