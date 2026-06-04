---
name: antigravity-result-handling
description: Use when the user wants Antigravity Bridge setup, status, result, cancellation, or stored delegated job output from inside Codex.
---

# Antigravity Result Handling

Use this skill to check setup and manage Antigravity Bridge background or waited jobs. The companion is a CLI-only plugin surface; do not start, configure, or invent MCP behavior.

## When To Use

- Use for Antigravity Bridge setup checks.
- Use when the user asks for delegated job status, progress, latest result, a specific result, or cancellation.
- Use after any `--background --json` companion command returns a job id.
- Use after `--wait --json` when the user wants the stored job record or another copy of the result.

## When Not To Use

- Do not use for trivial local status questions unrelated to Antigravity Bridge jobs.
- Do not use when the user asked not to delegate or not to use Antigravity.
- Do not use to send secrets, credentials, private keys, tokens, or sensitive prompts.
- Do not call internal worker commands such as `run-job`; those are not user-facing skill commands.

## Safety Defaults

- Setup, status, result, and cancel do not edit project files.
- Do not automatically apply stored Antigravity output, stage files, create commits, or push changes while handling results.
- Do not add `--timeout` or `--timeout-ms` to status, result, or cancel commands.
- Do not use MCP, `--mcp-config`, dangerous bypass flags, or `--permission-mode bypassPermissions`.
- Never add `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
- Do not grant broad shell or git write tools in read mode; job management should only call the companion CLI commands below.

## Commands

Setup check:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" setup --json
```

Latest status:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" status --json
```

All recent jobs:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" status --all --json
```

Specific job status:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" status "$JOB_ID" --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" status "$JOB_ID" --cwd "$WORKSPACE" --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" status --all --brief --json
```

`status --json` includes `phase`, `pid`, `agyPid`, `agyArgv`, `runtimeMs`, `idleMs`, `lastActivityAt`, `firstOutputAt`, `lastOutputAt`, bounded `recentLog` entries, and bounded `stdoutTail` / `stderrTail` fields. Use these fields to report whether a long-running job has started, whether safe process ids are still known, whether Antigravity has produced output, how long it has been active, and when the bridge last recorded activity. Use `status --brief --json` when polling or reading broad history so prompt args, stdout/stderr tails, and embedded stored results are omitted.

A running job can legitimately have empty stdout/stderr for a while. Do not cancel, add a timeout, or rerun only because stdout/stderr is quiet or `metadata.resultAvailable` is `false`; keep polling unless the user set a time budget, the job reaches a terminal state, or status evidence shows the job is stale.

Latest finished result:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" result --json
```

Specific job result:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" result "$JOB_ID" --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" result "$JOB_ID" --cwd "$WORKSPACE" --json
```

Cancel a running job:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cancel "$JOB_ID" --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cancel "$JOB_ID" --cwd "$WORKSPACE" --json
```

Use the `--cwd "$WORKSPACE"` form when the original background or waited job was started with that workspace.

Inspect stored job usage without deleting files:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" storage --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" storage --cwd "$WORKSPACE" --json
```

Preview cleanup before deleting old terminal job artifacts:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cleanup --dry-run --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cleanup --all --dry-run --json
```

Do not run broad `cleanup --all` unless `cleanup --all --dry-run --json` has been inspected first. Do not request unbounded raw logs.

## Handling Output

For `setup --json`, treat `ready: true` as usable. If setup reports a missing Antigravity binary, do not ask the user to edit shell PATH. First check common local install locations such as `$HOME/.local/bin/agy`, `/opt/homebrew/bin/agy`, and `/usr/local/bin/agy`; when one exists, rerun the companion with command-scoped `ANTIGRAVITY_COMPANION_AGY_BIN="$AGY_BIN"` for that call. If no binary is found, or the state directory is unusable, report that blocker and do not start delegated work.

For `status --json`, report running jobs, the latest finished job, and the relevant job id. For `result --json`, preserve paths, line numbers, findings, changed-file summaries, verification, errors, and residual risk; if the selected job is queued or running and `metadata.resultAvailable` is `false`, say the result is not ready instead of calling it failed. For `cancel --json`, report whether cancellation was signalled, whether TERM or KILL was used, whether the known process ids exited, and whether the job is now cancelled.

For `storage --json`, report total state usage and whether cleanup may be needed. For `cleanup --dry-run --json`, report what would be removed before running any destructive cleanup. If `result --json` includes `metadata.storage.truncated` or `metadata.storage.fallback`, tell the user the archived result was shortened to protect disk usage.
