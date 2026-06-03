---
name: claude-plan
description: Use when the user wants Claude Code, through Agent Bridge, to produce architecture plans, specs, sequencing, risk analysis, or implementation strategy for Codex.
---

# Claude Plan

Use this skill to delegate planning to Claude Code through the Agent Bridge Claude adapter CLI. The companion is a CLI-only plugin surface; do not start, configure, or invent MCP behavior.

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
- Do not ask Claude to edit files, create commits, or run write commands.
- Do not automatically apply Claude output, stage files, create commits, or push changes from planning flows.
- Do not use MCP, `--mcp-config`, dangerous bypass flags, or `--permission-mode bypassPermissions`.
- Never add `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
- Do not grant broad shell or git write tools in read mode; the companion plan command owns the allowed read profile.

## Setup Check

Before the first delegation in a workspace, or when Claude setup may have changed, run:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
```

If setup is not ready, tell the user what is missing, such as installing Claude Code or running `claude auth login`.

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

If the background or waited job was started with `--cwd "$WORKSPACE"`, pass the same `--cwd "$WORKSPACE"` to `status`, `result`, and `cancel`.

Return the companion output to the user. Preserve architecture decisions, assumptions, risks, sequencing, and verification guidance; do not turn the plan into edits unless the user explicitly asks Codex to implement it.
