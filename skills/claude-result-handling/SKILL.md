---
name: claude-result-handling
description: Use when the user wants Claude Companion setup, status, result, cancellation, or stored delegated job output from inside Codex.
---

# Claude Result Handling

Use this skill to check setup and manage Claude Companion background or waited jobs. The companion is a CLI-only plugin surface; do not start, configure, or invent MCP behavior.

## When To Use

- Use for Claude Companion setup checks.
- Use when the user asks for delegated job status, progress, latest result, a specific result, or cancellation.
- Use after any `--background --json` companion command returns a job id.
- Use after `--wait --json` when the user wants the stored job record or another copy of the result.

## When Not To Use

- Do not use for trivial local status questions unrelated to Claude Companion jobs.
- Do not use when the user asked not to delegate or not to use Claude.
- Do not use to send secrets, credentials, private keys, tokens, or sensitive prompts.
- Do not call internal worker commands such as `run-job`; those are not user-facing skill commands.

## Safety Defaults

- Setup, status, result, and cancel do not edit project files.
- Do not use MCP, `--mcp-config`, dangerous bypass flags, or `--permission-mode bypassPermissions`.
- Never add `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, or `--dangerously-bypass-approvals-and-sandbox`.
- Do not grant broad shell or git write tools in read mode; job management should only call the companion CLI commands below.

## Commands

Setup check:

```bash
node scripts/claude-companion.mjs setup --json
```

Setup check from a target project with an absolute plugin-root path:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
```

Latest status:

```bash
node scripts/claude-companion.mjs status --json
```

All recent jobs:

```bash
node scripts/claude-companion.mjs status --all --json
```

Specific job status:

```bash
node scripts/claude-companion.mjs status "$JOB_ID" --json
```

Latest finished result:

```bash
node scripts/claude-companion.mjs result --json
```

Specific job result:

```bash
node scripts/claude-companion.mjs result "$JOB_ID" --json
```

Cancel a running job:

```bash
node scripts/claude-companion.mjs cancel "$JOB_ID" --json
```

## Handling Output

For `setup --json`, treat `ready: true` as usable. If `ready: false`, report the missing Claude binary, authentication, or state-directory issue and do not start delegated work.

For `status --json`, report running jobs, the latest finished job, and the relevant job id. For `result --json`, preserve paths, line numbers, findings, changed-file summaries, verification, errors, and residual risk. For `cancel --json`, report whether cancellation was signalled and whether the job is now cancelled.
