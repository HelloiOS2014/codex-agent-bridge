---
name: claude-rescue
description: Use when the user explicitly wants Claude Code, through Claude Code Bridge, to investigate, fix, implement, apply a plan, or continue delegated work from inside Codex.
---

# Claude Rescue

Use this skill to delegate investigation or implementation rescue work to Claude Code through the Claude Code Bridge CLI. The companion is a CLI-only plugin surface; do not start, configure, or invent MCP behavior.

## When To Use

- Use read-only rescue when the user explicitly asks Claude Code to investigate, diagnose, reproduce, or propose a fix.
- Use write-enabled rescue only when the user explicitly asks Claude Code to fix, implement, edit, change code, apply a plan, or continue write-capable delegated work.
- Prefer foreground for narrow investigation and background for long debugging or implementation work.

## When Not To Use

- Do not use for trivial local tasks that Codex can safely handle directly.
- Do not use when Claude Code is missing or setup reports `ready: false`; run setup and report the blocker instead.
- Do not use when the user asked not to delegate or not to use Claude.
- Do not send secrets, credentials, private keys, tokens, or sensitive prompts when delegation would be unsafe.

## Safety Defaults

- Rescue defaults to read-only investigation.
- Add `--write` only when write access was explicitly requested by the user.
- Do not automatically apply patch text returned by Claude; only `rescue --write` grants Claude a scoped write run after explicit user request.
- Do not stage files, create commits, or push changes from rescue flows.
- Do not add `--timeout` or `--timeout-ms` by default. These flags are hard stops for explicit user time budgets, smoke tests, or deliberate cancellation probes only.
- For long debugging, reproduction, or implementation rescue, use `--background --json` and report the job id.
- Do not use MCP, `--mcp-config`, dangerous bypass flags, or `--permission-mode bypassPermissions`.
- Never add `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
- Do not grant broad shell or git write tools in read mode; read-only rescue uses the companion read profile.
- In write-enabled rescue, keep changes scoped to the user request and inspect the companion result before presenting it.

## Setup Check

Before the first delegated rescue in a workspace, run:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
```

If setup reports a missing Claude binary, do not ask the user to edit shell PATH. First check common local install locations such as `$HOME/.local/bin/claude`, `$HOME/.claude/local/claude`, `/opt/homebrew/bin/claude`, and `/usr/local/bin/claude`; when one exists, rerun the companion with command-scoped `CLAUDE_COMPANION_CLAUDE_BIN="$CLAUDE_BIN"` for that call. If no binary is found, or authentication is missing, report that blocker and do not delegate rescue work.

## Commands

Read-only investigation with machine-readable output:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --json --prompt "$PROMPT"
```

Write-enabled rescue, only after explicit user request:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --write --json --prompt "$PROMPT"
```

Resume the latest safe companion rescue job for this workspace:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --resume --json
```

Force a fresh rescue session:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --fresh --json --prompt "$PROMPT"
```

For long-running rescue:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --background --json --prompt "$PROMPT"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --background --write --json --prompt "$PROMPT"
```

Use `--wait` when the job should be tracked and Codex should wait for completion:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --wait --json --prompt "$PROMPT"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --wait --write --json --prompt "$PROMPT"
```

After a background job starts, report the job id and use:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" status "$JOB_ID" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" result "$JOB_ID" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cancel "$JOB_ID" --json
```

If the background or waited job was started with `--cwd "$WORKSPACE"`, pass the same `--cwd "$WORKSPACE"` to `status`, `result`, and `cancel`.

When many companion jobs exist, a storage quota error blocks a new background job, or a result includes `metadata.storage.truncated`, inspect storage before starting more delegated work:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" storage --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --dry-run --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --all --dry-run --json
```

Do not request unbounded raw logs. Do not run broad `cleanup --all` unless `cleanup --all --dry-run --json` has been inspected first.

For write-enabled results, report changed files, verification, residual risk, and any follow-up Codex must still perform. Do not stage, commit, push, or revert files unless the user explicitly asks.
