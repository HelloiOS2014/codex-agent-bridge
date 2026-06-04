---
name: antigravity-plan
description: Use when the user wants Antigravity, through Antigravity Bridge, to produce architecture plans, specs, sequencing, risk analysis, or implementation strategy for Codex.
---

# Antigravity Plan

Use this skill to delegate planning to Antigravity through the Antigravity Bridge CLI. The companion is a CLI-only plugin surface; do not start, configure, or invent MCP behavior.

## When To Use

- Use when the user asks Codex to ask Antigravity or Antigravity for a plan, architecture, design, spec, rollout strategy, risk pass, or implementation sequence.
- Use when a broad design question benefits from an independent Antigravity planning pass over the current workspace.
- Prefer foreground for small planning requests and background for broad repo planning, multi-step architecture work, or long risk reviews.

## When Not To Use

- Do not use for trivial local tasks that Codex can answer or execute directly.
- Do not use when Antigravity is missing or setup reports `ready: false`; run setup and report the blocker instead.
- Do not use when the user asked not to delegate or not to use Antigravity.
- Do not send secrets, credentials, private keys, tokens, or sensitive prompts when delegation would be unsafe.

## Safety Defaults

- Planning is read-only.
- The companion plan command uses Antigravity CLI print mode with `--sandbox` inside a disposable isolated workspace snapshot.
- Treat `--sandbox` as one layer only. The bridge protects the real project by running read-only planning in an isolated snapshot and failing the result if Antigravity changes files there.
- Do not ask Antigravity to edit files, create commits, or run write commands.
- Do not automatically apply Antigravity output, stage files, create commits, or push changes from planning flows.
- If the user explicitly requests an Antigravity model, pass it with `--model <model>`. If the user does not specify a model, omit `--model` so `agy` uses its own default or configured model.
- Do not add `--timeout` or `--timeout-ms` by default. These flags are hard stops for explicit user time budgets, smoke tests, or deliberate cancellation probes only.
- For broad repo planning, multi-step architecture work, risk reviews, or anything likely to exceed a short foreground response, use `--background --json` and report the job id.
- Do not use MCP, `--mcp-config`, dangerous bypass flags, or `--permission-mode bypassPermissions`.
- Never add `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
- Do not disable sandboxing or isolated-workspace behavior in read mode; the companion plan command owns those defaults.

## Setup Check

Before the first delegation in a workspace, or when Antigravity setup may have changed, run:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" setup --json
```

If setup reports a missing Antigravity binary, do not ask the user to edit shell PATH. First check common local install locations such as `$HOME/.local/bin/agy`, `/opt/homebrew/bin/agy`, and `/usr/local/bin/agy`; when one exists, rerun the companion with command-scoped `ANTIGRAVITY_COMPANION_AGY_BIN="$AGY_BIN"` for that call. If no binary is found, report that blocker instead of delegating.

## Commands

Use `--json` when Codex should parse the result before presenting it:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" plan --json --prompt "$PROMPT"
```

For long-running planning:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" plan --background --json --prompt "$PROMPT"
```

Use `--wait` when the job should be tracked as a companion job but Codex should wait for completion:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" plan --wait --json --prompt "$PROMPT"
```

After a background job starts, report the job id and use:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" status "$JOB_ID" --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" result "$JOB_ID" --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cancel "$JOB_ID" --json
```

A running job can legitimately have empty stdout/stderr for a while. Do not cancel, add a timeout, or rerun only because stdout/stderr is quiet or `metadata.resultAvailable` is `false`; keep polling unless the user set a time budget, the job reaches a terminal state, or status evidence shows the job is stale.

If the background or waited job was started with `--cwd "$WORKSPACE"`, pass the same `--cwd "$WORKSPACE"` to `status`, `result`, and `cancel`.

When many companion jobs exist, a storage quota error blocks a new background job, or a result includes `metadata.storage.truncated`, inspect storage before starting more delegated work:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" storage --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cleanup --dry-run --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cleanup --all --dry-run --json
```

Do not request unbounded raw logs. Do not run broad `cleanup --all` unless `cleanup --all --dry-run --json` has been inspected first.

Return the companion output to the user. Preserve architecture decisions, assumptions, risks, sequencing, and verification guidance; do not turn the plan into edits unless the user explicitly asks Codex to implement it.
