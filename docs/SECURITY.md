# Security

- Never commit GitHub, AI-provider, Render or Supabase secrets.
- GitHub access uses `GITHUB_TOKEN` only from the environment when authentication is required.
- Phase 1 has no production deployment capability.
- Reviewer independence is enforced: the builder and reviewer provider identifiers must differ.
- CI evidence must match the exact builder commit SHA.
- Missing or pending CI fails closed.
- Audit records are hash chained so later mutation can be detected when a stored chain is re-verified.
- Clinic OS patient, clinical and finance data must not be copied into Commander audit logs.
- Commander must remain outside the Clinic OS production request path.
