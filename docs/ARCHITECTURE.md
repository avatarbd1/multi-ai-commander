# Architecture

Multi-AI Commander is a control plane, not a runtime dependency of Clinic OS.

```text
Task Contract
    |
Builder output + GitHub PR evidence
    |
Independent reviewer output
    |
Commit-bound CI evidence
    |
Deterministic Commander verdict
    |
Human approval gate
```

The deterministic core does not call model APIs. Phase 1 captures outputs produced by independent AI systems and evaluates them against the same contract and commit. This keeps the first version free-first and reproducible.

## Clinic OS boundary

Commander may read GitHub PR metadata, diffs and CI status for `avatarbd1/relife-owner-app`. It is not in the Clinic OS request path, does not require the Clinic OS Render service, does not use the Clinic OS production Supabase project, and does not deploy production automatically.

## Fail-closed rules

A run is `BLOCKED` when CI is missing/failing/pending, evidence points at a different commit, builder/reviewer independence is violated, the task contract is invalid, or the reviewer reports a critical finding. High/medium findings or unsatisfied acceptance criteria yield `NEEDS_FIX`. Only clean evidence yields `PASS`, and `PASS` still requires a human merge/deploy decision.
