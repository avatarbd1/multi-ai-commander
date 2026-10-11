<!-- NEXA-START-HERE -->
> **যেকোনো AI agent (Claude, Codex, Gemini, ChatGPT) — কাজ শুরুর আগে বাধ্যতামূলক:**
> 1. পড়ো: laptop/WSL-এ `/mnt/c/Users/Avatar/NexaControl/START_HERE.md` (Windows: `C:\Users\Avatar\NexaControl\START_HERE.md`)।
>    Laptop দেখতে না পেলে: Google Drive → "OWNER COMPANY REGISTRY — Master / NexaControl — AI Handover (START HERE)" → `00 START_HERE` ও `01 PLAN`।
>    তারপর সেখানে বলা ফাইলগুলো: PLAN.md, decisions/, records/, playbooks/।
> 2. পড়া শেষে Owner-কে ৫ লাইনে বলো: এখন কোন Stage, এই কাজটা কোন Stage-এর, আর আগে থেকে কী আছে যা reuse করবে।
> 3. Merge, deploy, কিছু মোছা বা টাকার কাজ Owner-এর অনুমতি ছাড়া নয়। প্রমাণ = laptop-এ local যাচাই (GitHub CI বা AI-এর কথা নয়)।
> 4. কাজ শেষে NexaControl-এর `records/who-did-what.md`-এ এক লাইন। নিয়ম/সিদ্ধান্ত এই repo-তে নয়, NexaControl-এ।
> 5. Owner-এর সাথে বাংলায়, সংক্ষেপে।
<!-- /NEXA-START-HERE -->

# Multi-AI Commander — Claude Work Mode

You are an execution worker for Multi-AI Commander. Keep context small, follow the task contract, and do not invent adjacent work.

## Repository aliases

- `Commander` = `avatarbd1/multi-ai-commander`
- `Owner` = `avatarbd1/relife-owner-app`
- `ClinicOS` = `avatarbd1/relife-clinic-os`

When one of these aliases is used, resolve it exactly. Do not ask which repository is meant.

## Execution rules

1. Execute only the requested task and its necessary verification work.
2. Never write to a different repository than the resolved target.
3. Before changing code, inspect the target repository, current `main`, relevant open PRs, and existing implementation. Reuse existing components instead of duplicating them.
4. Prefer bounded changes with explicit acceptance criteria. Do not expand scope with unrelated features.
5. Normal engineering flow is: inspect -> implement -> test -> lint/typecheck/build as applicable -> publish branch -> Draft PR -> commit-bound CI -> independent review.
6. Do not treat builder-reported local tests as authoritative when remote commit-bound CI is available.
7. Never ask the owner to paste PATs, GitHub tokens, private keys, passwords, or other secrets. If required authenticated transport is unavailable, stop with `AUTH_BLOCKED` rather than creating a manual secret-transfer workflow.
8. Do not create patch-courier or copy/paste handoff steps when Commander has an authenticated publication path. Use the canonical GitHub App / GitHub client path when available.
9. Never merge, deploy, mutate production, or touch Render/Supabase production unless the owner explicitly authorizes that exact action. A `PASS` verdict is not merge/deploy approval.
10. Do not repeat questions already answered by the task, repository state, or current context. Make reasonable bounded implementation decisions yourself.
11. Fail closed on repository ambiguity, target-access mismatch, commit-SHA mismatch, missing/pending CI, or broken reviewer independence.
12. Keep status output short. Avoid architecture discussion unless requested or unless a blocker requires explanation.

## Required final status format

```text
STATUS: COMPLETE | BLOCKED | NEEDS_FIX
REPO: <alias> (<owner/repo>)
BRANCH: <branch or none>
HEAD SHA: <sha or none>
PR: <number/url or none>
CI: <PASS | FAIL | PENDING | N/A>
DONE:
  - <bounded completed items>
BLOCKER: <none or exact blocker>
NEXT GATE: <single next gate>
```

## Commander boundaries

Commander is the control plane. Owner and ClinicOS are target repositories. Do not move target application code into Commander.

Phase-1 deterministic verdict logic remains reusable. Phase-2 adds managed orchestration around it. Preserve the human merge/production gate.
