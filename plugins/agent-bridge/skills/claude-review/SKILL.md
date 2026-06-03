---
name: claude-review
description: Use when the user wants Claude Code, through Agent Bridge, to review code, review risks, or adversarially challenge an implementation or design from inside Codex.
---

# Claude Review

Use this skill to delegate read-only review to Claude Code through the Agent Bridge Claude adapter CLI. The companion is a CLI-only plugin surface; do not start, configure, or invent MCP behavior.

## When To Use

- Use `review` when the user asks Claude Code to review current changes, a working tree, a branch diff, or implementation risk.
- Use `adversarial-review` when the user asks Claude Code to challenge assumptions, design direction, tradeoffs, rollback, data loss paths, race conditions, or alternatives.
- Prefer foreground for narrow diffs and background for broad branch reviews or deep adversarial review.

## When Not To Use

- Do not use for trivial local checks that Codex can inspect directly.
- Do not use when Claude Code is missing or setup reports `ready: false`; run setup and report the blocker instead.
- Do not use when the user asked not to delegate or not to use Claude.
- Do not send secrets, credentials, private keys, tokens, or sensitive prompts when delegation would be unsafe.

## Safety Defaults

- Normal review and adversarial review are read-only.
- Do not fix issues, apply patches, create commits, or continue into implementation in the same delegated review.
- Do not automatically apply Claude output, stage files, create commits, or push changes from review flows.
- Do not use MCP, `--mcp-config`, dangerous bypass flags, or `--permission-mode bypassPermissions`.
- Never add `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
- Do not grant broad shell or git write tools in read mode; normal review uses pre-collected git context and no Claude tools by default.

## Setup Check

Before the first delegated review in a workspace, run:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
```

If setup is not ready, report the setup blocker and do not delegate the review.

## Commands

Machine-readable working tree review:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" review --json --scope working-tree
```

Branch review against a base ref:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" review --json --scope branch --base "$BASE_REF"
```

Adversarial review with a focus prompt:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" adversarial-review --json --scope auto --prompt "$FOCUS"
```

For long-running review:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" review --background --json --scope branch --base "$BASE_REF"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" adversarial-review --background --json --scope auto --prompt "$FOCUS"
```

Use `--wait` when the job should be tracked and Codex should wait for completion:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" review --wait --json --scope working-tree
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" adversarial-review --wait --json --scope auto --prompt "$FOCUS"
```

After a background job starts, report the job id and use:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" status "$JOB_ID" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" result "$JOB_ID" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cancel "$JOB_ID" --json
```

If the background or waited job was started with `--cwd "$WORKSPACE"`, pass the same `--cwd "$WORKSPACE"` to `status`, `result`, and `cancel`.

Present findings first, preserve file paths and line numbers, and keep the result as review output. If the user wants fixes, ask for or wait for an explicit implementation instruction.
