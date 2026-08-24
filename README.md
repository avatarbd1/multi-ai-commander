# Multi-AI Commander

A human-gated managed execution and review control plane for real GitHub pull-request workflows.

## Architecture

**Phase 1: Deterministic Task Verdict Engine**

Evaluates four evidence sets into a deterministic verdict:

1. task contract,
2. builder output,
3. independent AI review,
4. commit-bound CI evidence.

Output: `PASS`, `NEEDS_FIX`, or `BLOCKED`. `PASS` requires human approval before merge/deploy.

**Phase 2: Managed Execution Layer**

Commander orchestrates the full workflow:

```text
Task contract
  ↓
Managed Builder (isolated workspace, auto-verification)
  ↓
Draft PR publication with exact SHA binding
  ↓
Commit-bound CI gating (strict, fail-closed)
  ↓
Independent Reviewer (provider separation enforced)
  ↓
Deterministic verdict
  ↓
Human merge/deploy gate
```

Key properties:
- Builder and Reviewer execute in isolated subprocesses with minimal safe environment
- GitHub credentials do not leak to builder/reviewer subprocesses
- Exact SHA chain verification across PR head, CI, and builder output
- CI validation is strict: pending, missing, failed, or mismatched commits block the gate
- `PASS` verdict stops at human gate — no automatic merge or production deployment
- Comprehensive audit chain for reproducible runs

## Why this exists

The first target is Clinic OS engineering. Commander can automate task execution and evidence collection, but it is intentionally separate from Clinic OS production infrastructure. Commander failure must never affect clinic operations.

## Development

```bash
npm install --no-audit --no-fund
npm run lint
npm run typecheck
npm test
npm run build
```

Node.js 22+ is required.

## GitHub integration

Multi-AI Commander uses GitHub App credential broker authentication through environment variables:

- `COMMANDER_GH_APP_ID`: Numeric GitHub App ID (required)
- `COMMANDER_GH_INSTALLATION_ID`: Positive integer installation ID (required)
- `COMMANDER_GH_PRIVATE_KEY`: Private key in PEM format (required)
- `COMMANDER_GH_VERIFY_REPOSITORY`: Optional, for live installation verification

Never set `GITHUB_TOKEN` or `GH_TOKEN` in the runtime environment — Commander does not use them. Local development can use `npm run validate:github-auth` to validate configuration.

See [`docs/AUTH_GITHUB_APP.md`](docs/AUTH_GITHUB_APP.md) for setup and rotation procedures.

## Operational front door

Owners drive Commander end to end from one GitHub Actions run — no hand-authored JSON — via
the **Commander Run** workflow: Actions → Commander Run → Run workflow → type one command →
Run. See [`docs/OPERATIONAL_FRONT_DOOR.md`](docs/OPERATIONAL_FRONT_DOOR.md) for the exact
usage, required Secrets/Variables, and what remains to make the planner and Reviewer live.

The behavioral contract every actor (planner, Builder, Reviewer, Commander itself) operates
under is in [`OPERATING_CONSTITUTION.md`](OPERATING_CONSTITUTION.md),
[`CHATGPT_ROLE.md`](CHATGPT_ROLE.md), [`CLAUDE_ROLE.md`](CLAUDE_ROLE.md), and
[`COMMANDER_ROLE.md`](COMMANDER_ROLE.md).

## Documentation

- [`docs/PHASE1_SCOPE.md`](docs/PHASE1_SCOPE.md) — Phase 1 scope and constraints
- [`docs/PHASE2_MANAGED_EXECUTION.md`](docs/PHASE2_MANAGED_EXECUTION.md) — Phase 2 managed execution details
- [`docs/RUNNING.md`](docs/RUNNING.md) — the `commander run --task <task-contract.json>` CLI
- [`docs/OPERATIONAL_FRONT_DOOR.md`](docs/OPERATIONAL_FRONT_DOOR.md) — the GitHub Actions front door (`commander plan` + `commander run`)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — System architecture and fail-closed rules
- [`docs/SECURITY.md`](docs/SECURITY.md) — Security boundaries and isolation
- [`docs/AUTH_GITHUB_APP.md`](docs/AUTH_GITHUB_APP.md) — GitHub App credential broker setup
