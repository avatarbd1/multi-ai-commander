# Relife Program Control

This document centralizes cross-repository AI/process/control metadata for the Relife program.

## Repository roles
- `avatarbd1/relife-owner-app` — main SaaS/product runtime.
- `avatarbd1/relife-clinic-os` — legacy Telegram/support runtime.
- `avatarbd1/multi-ai-commander` — cross-repo orchestration, AI/team operating rules, automation experiments, release-control metadata.

## Actor split
- Owner: product/business authority and final merge/release authority.
- ChatGPT/Codex: planner, technical lead, independent reviewer, integrator, release controller.
- Claude/Builder: implementation inside approved scope; no self-approval.
- GitHub CI: commit-bound verification only; does not prove deploy/live state.

## Standard execution chain
`Owner goal -> task contract -> Builder -> independent verification -> Draft PR -> exact-head CI -> HUMAN_GATE -> Owner release decision`

## Fixed engineering rules
- One user action -> one canonical command/query -> one domain rule -> one writer/transaction -> one audit trail.
- No duplicate canonical writer or parallel business-rule engine.
- Critical security/finance/clinical writes fail closed.
- Fresh branch from current main for application changes.
- Builder claims are evidence, not acceptance.
- Merge != deploy != live verified.
- Product/domain acceptance criteria stay beside the product repo they govern.

## Repository-local product truth
Commander does not replace product documentation. These stay in Owner App because they describe its runtime/domain:
- architecture and canonical-path registry
- tenancy/kernel/cutover documentation
- migration and authority maps
- booking-vs-operating rules
- finance/clinical/security product invariants
- product-specific smoke/release evidence

## Archived Owner App process material
The following prior Owner App documents were process/control oriented and are now centralized here:
- `AGENTS.md` historical Relife Engine Lite workflow sections
- `CLAUDE.md` agent-role/process sections
- `docs/RELIFE_ENGINE_LITE.md`
- historical control issues #137 and #142

Repo-local `AGENTS.md`/`CLAUDE.md` may remain as thin pointers containing only repository-specific safety/product boundaries needed when an agent opens the repo.

## Historical Stage-B notes
Old Stage-B setup documents described an early CSV-publish/seed-fallback/default-PIN workflow and old deployment targets. They are retained only as history and must not be treated as current setup instructions:
- `READY_TO_TEST.md`
- `SETUP_LIVE_DATA.md`
- `STAGE_B_QUICK_START.md`
- `PWA_CLEAN_REBUILD.md` (completed branch note)

Current implementation truth must come from current code, product docs, active issues/PRs, and deployed/runtime evidence.

## Communication
Direct owner-facing explanations should be in Bangla. English is fine for code, identifiers, and exact copy-paste payloads when useful.
