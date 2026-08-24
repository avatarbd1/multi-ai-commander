# Relife Program Control

This document centralizes cross-repository AI/process/control metadata for the Relife program and indexes historical planning/audit material that should no longer clutter active product repositories.

## Repository roles
- `avatarbd1/relife-owner-app` — main SaaS/product runtime.
- `avatarbd1/relife-clinic-os` — legacy Telegram/support runtime.
- `avatarbd1/multi-ai-commander` — cross-repo orchestration, AI/team operating rules, automation experiments, release-control metadata, and historical planning archive.

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
Commander does not replace product documentation. These remain in Owner App because they describe current runtime/domain truth:
- `ARCHITECTURE.md`
- `MIGRATION_AUDIT.md`
- `TENANCY.md`
- `docs/CANONICAL_PATH_REGISTRY.md`
- `docs/BOOKING_OPERATING_SPLIT.md`
- `docs/MULTITENANT_KERNEL_V1.md`
- `docs/TENANT1_CUTOVER_AUDIT.md`
- `docs/V1A_AUTHORITY_MAP.md`
- `docs/TELEGRAM_WEB_PARITY.md`
- `docs/RENDER_ORIGIN_FIX.md`
- current product-specific active issues/PRs and smoke evidence

## Centralized process material
The following prior Owner App material was process/control oriented and is centralized here:
- historical `AGENTS.md` Relife Engine Lite workflow sections
- historical `CLAUDE.md` agent-role/process sections
- `docs/RELIFE_ENGINE_LITE.md`
- historical control issues Owner App #137 and #142

Repo-local `AGENTS.md` and `CLAUDE.md` should remain thin entrypoints containing only product-local boundaries plus a pointer here.

## Historical Owner App planning/audit archive
These documents captured valid historical evidence or plans at the time, but their baselines are superseded by later merges/tenant work and should not act as current roadmap truth. Git history remains the full-fidelity archive; this index preserves their purpose:

- `docs/BATCH_2_CORE_OPERATIONS_AUDIT.md` — historical Batch-2 core-operations audit; recorded canonical paths and an attendance locking defect on an older baseline.
- `docs/COMPLETE_PRODUCTION_AUDIT.md` — 17 Aug 2026 production audit inventory with then-current P0/P1 findings; later work superseded many statuses.
- `docs/IMPLEMENTATION_ROADMAP_CURRENT.md` — 18 Aug 2026 feature roadmap focused on communications/charts/mobile/VoIP; no longer the current tenant/SaaS execution tracker.
- `docs/Implementation_Blueprint.md` — V1 parity blueprint using Golden Bot as reference; useful history, but current app/tenant architecture and active issues now govern execution.
- `docs/PR90_USER_FLOW_EVIDENCE.md` — PR #90 payment-concurrency evidence; PR/history and later distributed-lock work supersede the standalone file.
- `docs/PRODUCTION_CLOSURE_CHECKLIST.md` — older closure checklist whose open-item statuses no longer match current repository state.

Do not use these archived documents to decide current work without checking current main, current product docs, active issues/PRs, CI, and runtime evidence.

## Historical Stage-B archive
Old Stage-B setup documents described an early CSV-publish/seed-fallback/default-PIN workflow and old deployment targets. They are historical only and must not be treated as current setup instructions:
- `READY_TO_TEST.md`
- `SETUP_LIVE_DATA.md`
- `STAGE_B_QUICK_START.md`
- `PWA_CLEAN_REBUILD.md` — completed branch note

Current implementation truth must come from current code, retained product docs, active issues/PRs, and deployed/runtime evidence.

## Communication
Direct owner-facing explanations should be in Bangla. English is fine for code, identifiers, and exact copy-paste payloads when useful.
