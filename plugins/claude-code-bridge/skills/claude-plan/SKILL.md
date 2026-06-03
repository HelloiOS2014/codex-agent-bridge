---
name: claude-plan
description: Use when the user wants Claude Code, through Claude Code Bridge, to produce architecture plans, specs, sequencing, risk analysis, or implementation strategy for Codex.
---

# Claude Plan

Use this skill to delegate planning to Claude Code through the Claude Code Bridge CLI. The companion is a CLI-only plugin surface; do not start, configure, or invent MCP behavior.

## When To Use

- Use when the user asks Codex to ask Claude or Claude Code for a plan, architecture, design, spec, rollout strategy, risk pass, or implementation sequence.
- Use when a broad design question benefits from an independent Claude Code planning pass over the current workspace.
- Prefer foreground for small planning requests and background for broad repo planning, multi-step architecture work, or long risk reviews.

## When Not To Use

- Do not use for trivial local tasks that Codex can answer or execute directly.
- Do not use when Claude Code is missing or setup reports `ready: false`; run setup and report the blocker instead.
- Do not use when the user asked not to delegate or not to use Claude.
- Do not send secrets, credentials, private keys, tokens, or sensitive prompts when delegation would be unsafe.

## Safety Defaults

- Planning is read-only.
- The companion plan command uses Claude Code's non-interactive `dontAsk` permission mode with the read-only `Read,Glob,Grep` tool profile.
- Do not ask Claude to edit files, create commits, or run write commands.
- Do not automatically apply Claude output, stage files, create commits, or push changes from planning flows.
- If the user explicitly requests a Claude Code model, pass it with `--model <model>`. The model value may be a short alias such as `opus` or `sonnet`, or a full model name. If the user does not specify a model, omit `--model` so Claude Code uses its own default model.
- Do not add `--timeout` or `--timeout-ms` by default. These flags are hard stops for explicit user time budgets, smoke tests, or deliberate cancellation probes only.
- For broad repo planning, multi-step architecture work, risk reviews, or anything likely to exceed a short foreground response, use `--background --json` and report the job id.
- Do not use MCP, `--mcp-config`, dangerous bypass flags, or `--permission-mode bypassPermissions`.
- Never add `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
- Do not grant broad shell or git write tools in read mode; the companion plan command owns the allowed read profile.

## Setup Check

Before the first delegation in a workspace, or when Claude setup may have changed, run:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
```

If setup reports a missing Claude binary, do not ask the user to edit shell PATH. First check common local install locations such as `$HOME/.local/bin/claude`, `$HOME/.claude/local/claude`, `/opt/homebrew/bin/claude`, and `/usr/local/bin/claude`; when one exists, rerun the companion with command-scoped `CLAUDE_COMPANION_CLAUDE_BIN="$CLAUDE_BIN"` for that call. If no binary is found, or authentication is missing, report that blocker instead of delegating.

## Commands

Use `--json` when Codex should parse the result before presenting it:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" plan --json --prompt "$PROMPT"
```

For long-running planning:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" plan --background --json --prompt "$PROMPT"
```

Use `--wait` when the job should be tracked as a companion job but Codex should wait for completion:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" plan --wait --json --prompt "$PROMPT"
```

After a background job starts, report the job id and use:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" status "$JOB_ID" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" result "$JOB_ID" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cancel "$JOB_ID" --json
```

A running job can legitimately have empty stdout/stderr for a while. Do not cancel, add a timeout, or rerun only because stdout/stderr is quiet or `metadata.resultAvailable` is `false`; keep polling unless the user set a time budget, the job reaches a terminal state, or status evidence shows the job is stale.

If the background or waited job was started with `--cwd "$WORKSPACE"`, pass the same `--cwd "$WORKSPACE"` to `status`, `result`, and `cancel`.

When many companion jobs exist, a storage quota error blocks a new background job, or a result includes `metadata.storage.truncated`, inspect storage before starting more delegated work:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" storage --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --dry-run --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --all --dry-run --json
```

Do not request unbounded raw logs. Do not run broad `cleanup --all` unless `cleanup --all --dry-run --json` has been inspected first.

Return the companion output to the user. Preserve architecture decisions, assumptions, risks, sequencing, and verification guidance; do not turn the plan into edits unless the user explicitly asks Codex to implement it.
