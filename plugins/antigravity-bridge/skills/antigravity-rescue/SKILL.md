---
name: antigravity-rescue
description: Use when the user explicitly wants Antigravity, through Antigravity Bridge, to investigate, fix, implement, apply a plan, or continue delegated work from inside Codex.
---

# Antigravity Rescue

Use this skill to delegate investigation or implementation rescue work to Antigravity through the Antigravity Bridge CLI. The companion is a CLI-only plugin surface; do not start, configure, or invent MCP behavior.

## When To Use

- Use read-only rescue when the user explicitly asks Antigravity to investigate, diagnose, reproduce, or propose a fix.
- Use write-enabled rescue only when the user explicitly asks Antigravity to fix, implement, edit, change code, apply a plan, or continue write-capable delegated work.
- Prefer foreground for narrow investigation and background for long debugging or implementation work.

## When Not To Use

- Do not use for trivial local tasks that Codex can safely handle directly.
- Do not use when Antigravity is missing or setup reports `ready: false`; run setup and report the blocker instead.
- Do not use when the user asked not to delegate or not to use Antigravity.
- Do not send secrets, credentials, private keys, tokens, or sensitive prompts when delegation would be unsafe.

## Safety Defaults

- Rescue defaults to read-only investigation.
- Read-only rescue runs in a disposable isolated workspace snapshot. If Antigravity changes files in that snapshot, the companion marks the run failed and reports the touched files while leaving the real project untouched.
- Add `--write` only when write access was explicitly requested by the user.
- Do not automatically apply patch text returned by Antigravity; only `rescue --write` grants Antigravity a scoped write run after explicit user request.
- Do not stage files, create commits, or push changes from rescue flows.
- If the user explicitly requests an Antigravity model, pass it with `--model <model>`. If the user does not specify a model, omit `--model` so `agy` uses its own default or configured model.
- Do not add `--timeout` or `--timeout-ms` by default. These flags are hard stops for explicit user time budgets, smoke tests, or deliberate cancellation probes only.
- For long debugging, reproduction, or implementation rescue, use `--background --json` and report the job id.
- Do not use MCP, `--mcp-config`, dangerous bypass flags, or `--permission-mode bypassPermissions`.
- Never add `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
- Do not disable sandboxing or isolated-workspace behavior in read mode; read-only rescue uses the companion's `--sandbox` default.
- In write-enabled rescue, keep changes scoped to the user request and inspect the companion result before presenting it.

## Setup Check

Before the first delegated rescue in a workspace, run:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" setup --json
```

If setup reports a missing Antigravity binary, do not ask the user to edit shell PATH. First check common local install locations such as `$HOME/.local/bin/agy`, `/opt/homebrew/bin/agy`, and `/usr/local/bin/agy`; when one exists, rerun the companion with command-scoped `ANTIGRAVITY_COMPANION_AGY_BIN="$AGY_BIN"` for that call. If no binary is found, report that blocker and do not delegate rescue work.

## Commands

Read-only investigation with machine-readable output:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --json --prompt "$PROMPT"
```

Write-enabled rescue, only after explicit user request:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --write --json --prompt "$PROMPT"
```

Resume the previous Antigravity CLI conversation only for explicit write-enabled rescue. This passes `agy --continue`; read-only `rescue --resume` is rejected because continued CLI conversations may retain write-capable workspace context. Use `--fresh` when you need a read-only fresh session:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --write --resume --json
```

Force a fresh rescue session:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --fresh --json --prompt "$PROMPT"
```

For long-running rescue:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --background --json --prompt "$PROMPT"
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --background --write --json --prompt "$PROMPT"
```

Use `--wait` when the job should be tracked and Codex should wait for completion:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --wait --json --prompt "$PROMPT"
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --wait --write --json --prompt "$PROMPT"
```

After a background job starts, report the job id and use:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" status "$JOB_ID" --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" result "$JOB_ID" --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cancel "$JOB_ID" --json
```

If the background or waited job was started with `--cwd "$WORKSPACE"`, pass the same `--cwd "$WORKSPACE"` to `status`, `result`, and `cancel`.

When many companion jobs exist, a storage quota error blocks a new background job, or a result includes `metadata.storage.truncated`, inspect storage before starting more delegated work:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" storage --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cleanup --dry-run --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cleanup --all --dry-run --json
```

Do not request unbounded raw logs. Do not run broad `cleanup --all` unless `cleanup --all --dry-run --json` has been inspected first.

For write-enabled results, report changed files, verification, residual risk, and any follow-up Codex must still perform. Do not stage, commit, push, or revert files unless the user explicitly asks.
