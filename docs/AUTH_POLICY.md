# GitHub Authentication Policy

Multi-AI Commander must never persist or expose an owner's GitHub credential in repository content or AI conversation context.

## Supported authentication order

1. Reuse an already-authenticated GitHub CLI session when available.
2. Otherwise use GitHub CLI browser/device OAuth.
3. If neither is available without exposing a secret, stop with `AUTH_REQUIRED`.

A PAT, OAuth token, password, private key, credential-helper store, or `gh` credential file must never be committed to this repository.

## Important limitation

Repository files and GitHub Actions secrets are not a persistent credential store for an arbitrary external AI container. A Claude/other Builder session running outside GitHub must still have an authenticated transport session of its own, or Commander must move GitHub transport into a trusted service/runner in a later phase.

## Forbidden operations

- Asking the owner to paste a secret into chat.
- Running commands whose purpose is to reveal an authentication token.
- Embedding credentials in a Git remote URL or command-line argument.
- Copying authentication state into logs, audit records, patches, issues, or pull requests.
- Claiming authentication persists across fresh AI sessions unless that persistence has been independently verified.

## Human gate

Authentication enables transport only. It does not authorize automatic merge or production deployment.
