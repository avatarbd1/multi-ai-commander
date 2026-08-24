# Real provider setup

`Commander Run` is prewired to three live provider roles:

- Planner: OpenAI Responses API (`scripts/providers/openai-planner.mjs`)
- Builder: Claude Code CLI (`scripts/providers/claude-builder.mjs`)
- Reviewer: OpenAI Responses API (`scripts/providers/openai-reviewer.mjs`)

The workflow installs Claude Code `2.1.241` and uses Node 22's built-in `fetch` for OpenAI. Provider command Variables are no longer required for the standard GitHub Actions front door.

## Repository secrets required

Keep the existing Commander GitHub App secrets unchanged, then add:

- `OPENAI_API_KEY` — used only by Planner and Reviewer subprocesses.
- `ANTHROPIC_API_KEY` — used only by the Claude Builder subprocess.

Commander maps the secrets to provider-specific child-process environments. GitHub App credentials, `GITHUB_TOKEN`, and `GH_TOKEN` remain excluded by the existing provider credential firewall.

Do not paste either AI API key into chat, workflow inputs, repository Variables, task JSON, logs, or PR comments.

## Run

GitHub → `avatarbd1/multi-ai-commander` → Actions → **Commander Run** → **Run workflow**.

First intended real command:

`Complete T2-01 staff tenant membership and take it to HUMAN_GATE.`

Select the actual target alias containing T2-01 if you want to prevent planner target inference.

Commander must stop at `HUMAN_GATE`; this workflow does not merge or deploy.
