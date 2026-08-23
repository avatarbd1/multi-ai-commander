# Phase 1 Scope — 2026-08-24

## In scope

1. Task contract with builder requirements and acceptance criteria.
2. Builder output capture: summary, branch, commit, changed files and tests.
3. Independent reviewer capture: requirements, bugs, security, regression and missing requirements.
4. Deterministic verdict: `PASS`, `NEEDS_FIX` or `BLOCKED`.
5. GitHub PR/read integration and commit-bound CI evidence.
6. CI gate: lint, typecheck, tests and build. CI failure means the task is not done.
7. Hash-chained audit records for reproducible runs.
8. Human gate: Commander never performs an automatic production deployment.

## Explicitly out of scope

- Fancy dashboard.
- SaaS billing.
- Multi-tenant Commander.
- Mobile app.
- Autonomous production deployment.
- Paid model API orchestration or extra AI features.

## Success metric

Phase 1 succeeds when it can be used to evaluate a real Clinic OS pull request from a task contract through builder evidence, independent review, CI evidence and a human-gated verdict.
