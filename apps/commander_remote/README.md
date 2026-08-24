# Commander Remote MVP

Mobile Flutter control surface for `multi-ai-commander`.

## Step 1 scope

This first slice intentionally does only one real thing:

1. Accept a high-level Owner command.
2. Accept the existing Commander target aliases: `(let planner infer)`, `Commander`, `Owner`, `ClinicOS`.
3. Trigger `.github/workflows/commander-run.yml` using GitHub's workflow-dispatch REST endpoint.
4. Display the returned workflow run ID and GitHub run URL.

No AccessibilityService, screenshots, macro engine, or AI-provider workaround is included in this slice.

## Security boundary

The MVP accepts a GitHub token interactively and keeps it only in process memory. It is not written to source code or local storage. A later slice should replace this with a proper user-authentication flow or Android-backed secure credential storage.

The token needs permission to dispatch the Commander workflow. Use the least privilege GitHub credential that supports Actions write access for this repository.

## Bootstrap

The repository stores the authored Flutter source only. On a machine with Flutter installed, generate the normal platform shell and keep these source files:

```bash
cd apps/commander_remote
flutter create --platforms=android .
flutter pub get
flutter run
```

After `flutter create`, verify that `lib/main.dart` and `lib/services/github_dispatch_service.dart` still contain the Commander Remote sources from this branch.

## Next slice

- Query workflow-run state by run ID.
- Show queued / in-progress / completed status.
- Show conclusion and direct Actions link.
- Add refresh/polling with bounded intervals.
- Add token storage only after the authentication approach is fixed.
