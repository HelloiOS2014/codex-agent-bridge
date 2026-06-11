---
name: claude-review
description: Use when the user wants Claude Code, through Claude Code Bridge, to review code, review risks, or adversarially challenge an implementation or design from inside Codex.
---

# Claude Review

Use this skill to delegate read-only review to Claude Code through the Claude Code Bridge CLI. The companion is a CLI-only plugin surface; do not start, configure, or invent MCP behavior.

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
- If the user explicitly requests a Claude Code model, pass it with `--model <model>`. The model value may be a short alias such as `opus` or `sonnet`, or a full model name. If the user does not specify a model, omit `--model` so Claude Code uses its own default model.
- Do not add `--timeout` or `--timeout-ms` by default. These flags are hard stops for explicit user time budgets, smoke tests, or deliberate cancellation probes only.
- For broad branch reviews, large diffs, or deep adversarial review, use `--background --json` and report the job id.
- Do not use MCP, `--mcp-config`, dangerous bypass flags, or `--permission-mode bypassPermissions`.
- Never add `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
- Do not grant broad shell or git write tools in read mode; normal review uses pre-collected git context and no Claude tools by default.

## Codex Execution Defaults

- Bridge companion commands call local CLIs, plugin state, and user-selected workspaces. When invoking the companion through Codex tool execution, use `sandbox_permissions: "require_escalated"` on the first attempt. Do not run the companion in the default Codex sandbox first and retry after sandbox failure.
- An explicit user request to use this Bridge for the current task is enough delegation authorization. Do not ask for a second confirmation before calling the Bridge. Ask only if the target workspace is ambiguous, the request would expose secrets or credentials, the scope expands beyond the user request, or write-enabled rescue was not explicitly requested.
- Do not run `setup --json` or raw auth/version checks before every delegation. Assume the Bridge is installed and authenticated unless a companion command fails, the user asks for a setup check, or there is concrete evidence that local setup changed.

## Setup Check

Use setup only when the user asks to check setup, during installation verification, after a companion command reports a missing binary, authentication failure, or unusable state, or when there is concrete evidence that Claude setup changed:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
```

If setup reports a missing Claude binary, do not ask the user to edit shell PATH. First check common local install locations such as `$HOME/.local/bin/claude`, `$HOME/.claude/local/claude`, `/opt/homebrew/bin/claude`, and `/usr/local/bin/claude`; when one exists, rerun the companion with command-scoped `CLAUDE_COMPANION_CLAUDE_BIN="$CLAUDE_BIN"` for that call. If no binary is found, or authentication is missing, report that blocker and do not delegate the review.

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

When many companion jobs exist, a storage quota error blocks a new background job, or a result includes `metadata.storage.truncated`, inspect storage before starting more delegated work:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" storage --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --dry-run --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --all --dry-run --json
```

Do not request unbounded raw logs. Do not run broad `cleanup --all` unless `cleanup --all --dry-run --json` has been inspected first.

Present findings first, preserve file paths and line numbers, and keep the result as review output. If the user wants fixes, ask for or wait for an explicit implementation instruction.
