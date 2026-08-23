# GitHub App authentication for Multi-AI Commander

Multi-AI Commander uses a GitHub App credential broker so the trusted Commander runtime can perform GitHub operations without giving long-lived GitHub credentials to Builder agents.

## Security model

```text
GitHub App
  -> private key in GitHub Actions Secrets
  -> Commander credential broker
  -> short-lived installation token in memory
  -> GitHub REST API

Claude / other Builder
  -> no GitHub App private key
  -> no PAT
  -> no installation token
```

The private key is a long-lived app credential and must remain in trusted secret storage. Installation access tokens are short-lived and are cached only in process memory. Commander refreshes them before the `expires_at` value returned by GitHub.

## First-slice scope

Install the app with **Only select repositories** and select only:

`avatarbd1/multi-ai-commander`

Do not select **All repositories** for this first slice. Requested token permissions and repository scope can never exceed the GitHub App installation grant.

Recommended repository permissions:

| Permission | Access | Purpose |
| --- | --- | --- |
| Contents | Read & write | Create branches and commit file content |
| Pull requests | Read & write | Create/update Draft PRs |
| Checks | Read | Read CI/check evidence |
| Actions | Read | Read workflow evidence when required |

Keep permissions at the minimum needed for Commander. Production deploy permission is not part of this app slice.

## One-time setup

1. Register a GitHub App under the account that owns `avatarbd1/multi-ai-commander`.
2. Disable webhooks for this slice unless a later design explicitly needs them.
3. Apply the repository permissions above.
4. Install it using **Only select repositories** -> `avatarbd1/multi-ai-commander`.
5. Generate a private key in the GitHub App settings.
6. Add these values to **GitHub Actions Secrets** for `avatarbd1/multi-ai-commander`:
   - `COMMANDER_GH_APP_ID`
   - `COMMANDER_GH_INSTALLATION_ID`
   - `COMMANDER_GH_PRIVATE_KEY`
7. Do not paste the private key into chat, repository files, command arguments, CI output, issues, PRs, or audit records.

The setup CLI reads the values from the environment injected by the trusted runner:

```bash
npm run validate:github-auth
```

For an explicit live verification against the selected repository, the trusted workflow may additionally set the non-secret variable:

```text
COMMANDER_GH_VERIFY_REPOSITORY=avatarbd1/multi-ai-commander
```

## Validation states

`LOCAL_CONFIG_VALID` means only:

- required environment variables are present;
- App ID and Installation ID formats are valid;
- the private key is parseable for RS256 signing;
- a GitHub App JWT can be signed locally.

It **does not** prove that the installation ID exists, that the app is installed on the intended repository, or that GitHub will accept the credential.

`LIVE_INSTALLATION_VERIFIED` means:

- GitHub accepted the App JWT;
- installation-token exchange succeeded;
- the broker-backed client successfully accessed the expected repository.

If no live repository check is requested, the CLI prints `LIVE_INSTALLATION_NOT_VERIFIED` rather than claiming live authentication success.

## Runtime behavior

For each authenticated request, `GitHubRestClient` obtains a token from its attached credential broker. The broker:

1. reuses a cached token only while it remains outside the refresh safety window;
2. otherwise signs an RS256 GitHub App JWT with `iat` backdated for clock skew;
3. exchanges the JWT for an installation token;
4. parses GitHub's authoritative `expires_at` response;
5. stores the token only in memory;
6. shares one in-flight refresh when concurrent requests race.

The canonical client supports PR/CI reads plus branch, repository-content, PR update, and PR-comment writes through the same broker-backed authentication path. Do not add a second GitHub API engine for these operations.

## Private-key rotation

GitHub App private keys do not automatically rotate for Commander. If a key must be rotated or is suspected compromised:

1. generate a new private key in the existing GitHub App settings;
2. update `COMMANDER_GH_PRIVATE_KEY` in GitHub Actions Secrets to the new key;
3. run local configuration validation and a live installation verification with the new key;
4. revoke/delete the **old private key** in the GitHub App settings after the new key is confirmed.

Do not delete the whole GitHub App merely to rotate one private key.

## Logging and errors

Credential/configuration failures identify the variable or operation, not its raw value. GitHub error response bodies are not copied into Commander exceptions because external responses may contain credential-shaped or sensitive request information.

Never add diagnostic commands that print stored tokens or private keys.

## Human gate

GitHub authentication grants transport capability only. It does not grant automatic merge or production-deploy authority. Commander verdicts remain human-gated, and production deployment is outside this credential-broker slice.
