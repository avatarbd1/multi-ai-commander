# Security

- Never commit GitHub, AI-provider, Render or Supabase secrets.
- GitHub access uses a GitHub App credential broker only (`COMMANDER_GH_APP_ID`, `COMMANDER_GH_INSTALLATION_ID`, `COMMANDER_GH_PRIVATE_KEY`). `GitHubRestClient` requires a broker and installation ID; there is no static-token (`GITHUB_TOKEN`/`GH_TOKEN`) fallback. See [`docs/AUTH_GITHUB_APP.md`](AUTH_GITHUB_APP.md).
- GitHub credentials never enter Builder/Reviewer subprocess environments.
- Phase 1 has no production deployment capability.
- Reviewer independence is enforced: the builder and reviewer provider identifiers must differ.
- CI evidence must match the exact builder commit SHA.
- Missing or pending CI fails closed.
- Live installation and branch-protection verification fail closed: an unreachable repository or a policy that does not meet the required checks blocks the gate instead of defaulting to allow.
- Audit records are hash chained so later mutation can be detected when a stored chain is re-verified. `AuditEventLogger` redacts credential-shaped values from event details before they are appended to the chain.
- Clinic OS patient, clinical and finance data must not be copied into Commander audit logs.
- Commander must remain outside the Clinic OS production request path.
