# Multi-AI Commander — Agent Security Rules

These rules apply to every AI agent, builder, reviewer, and automation working in this repository.

## GitHub credential firewall

1. Never ask the owner to paste a GitHub PAT, OAuth token, password, private key, or other secret into chat.
2. Never print, echo, inspect, or expose GitHub credentials. In particular, do not run commands intended to reveal credentials such as `gh auth token` or `gh auth status --show-token`.
3. Never place credentials in a Git remote URL, command argument, commit, patch, issue, PR, log, audit record, test fixture, or repository file.
4. Never commit `.config/gh/hosts.yml`, credential-helper stores, `.env` secrets, or equivalent authentication material.
5. Prefer an already-authenticated GitHub CLI session. If no session exists, use GitHub CLI browser/device OAuth only.
6. If authentication cannot be established without exposing a secret, stop and return `AUTH_REQUIRED`. Do not request a PAT from the owner.
7. After authentication, use `gh auth setup-git` or an equivalent credential-helper integration rather than token-bearing remotes.
8. Treat authentication state as potentially ephemeral. Do not claim persistence across sessions unless it has been verified in a later fresh session.
9. Redact credential-shaped values from any user-visible output or durable audit material.

## Production and merge gate

- GitHub authentication never grants permission to merge or deploy production automatically.
- Production deployment and merge remain human-gated unless the owner explicitly authorizes the specific action.
- Do not access Render, Supabase, or other production infrastructure merely to solve GitHub authentication.

## Failure behavior

When GitHub transport is unavailable, report the exact non-secret blocker and stop. Use a status such as:

`AUTH_REQUIRED: GitHub transport is unavailable without a non-secret authentication flow.`

Do not weaken these rules to make a task appear complete.
