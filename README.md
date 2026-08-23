# Multi-AI Commander

A human-gated build/review control plane for real GitHub pull-request workflows.

Phase 1 turns four evidence sets into a deterministic verdict:

1. task contract,
2. builder output,
3. independent AI review,
4. commit-bound CI evidence.

The output is `PASS`, `NEEDS_FIX`, or `BLOCKED`. `PASS` never means auto-deploy: a human gate is mandatory.

## Why this exists

The first target is Clinic OS engineering. Commander can inspect PR/CI evidence, but it is intentionally separate from Clinic OS production infrastructure. Commander failure must never affect clinic operations.

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

`GitHubRestClient` reads PR metadata, changed files and check runs using the GitHub REST API. Set `GITHUB_TOKEN` in the environment only when authenticated/private access is required. No token is stored by Commander.

## Phase 1 constraints

See [`docs/PHASE1_SCOPE.md`](docs/PHASE1_SCOPE.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/SECURITY.md`](docs/SECURITY.md).
