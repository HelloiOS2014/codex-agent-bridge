# Agent Instructions

This repository builds a Codex plugin that lets Codex call local Claude Code for planning, review, adversarial review, and explicitly write-enabled rescue work.

## Core Rules

- Keep the plugin CLI-only. Do not add MCP servers or `mcpServers` to `.codex-plugin/plugin.json`.
- Skills must invoke the companion through `node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs"`.
- Do not invoke the companion through a bare relative script path in README, skills, or tests.
- `plan`, `review`, and `adversarial-review` must remain read-only.
- `rescue` must remain read-only unless the user explicitly requested file edits and the command uses `--write`.
- Do not add Claude bypass behavior or allow `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, or `--permission-mode bypassPermissions`.
- Companion flows must not automatically apply Claude output, stage files, create commits, or push changes.

## Background Job Rules

- Preserve terminal job states. A worker must not overwrite a cancelled, failed, or completed job.
- If a worker cannot start, persist a failed job result instead of leaving a permanent queued job.
- Reconcile stale queued/running jobs to failed results.
- For jobs started with `--cwd`, `status`, `result`, and `cancel` must support the same `--cwd`.
- Keep job state outside the reviewed project. Preserve the state root priority: `CLAUDE_COMPANION_STATE_DIR`, `CODEX_PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA`, then OS temp.

## Documentation Rules

- README must document installation, Codex usage, direct CLI usage, safety model, background jobs, state storage, tests, troubleshooting, and repository layout.
- README and all skills must mention the `$CLAUDE_PLUGIN_ROOT` command path.
- README and skills must stay consistent for `--background`, `--wait`, `--cwd`, `status`, `result`, and `cancel`.
- Keep `.agents/plugins/marketplace.json` valid when changing plugin name, display name, or repository layout. This is a single-plugin repository; the marketplace entry should point to this repository's plugin root with `source.local.path = "./"`.
- Do not document personal marketplace copying or `--sparse .agents/plugins` installation for this repository.
- Update `tests/skills.test.mjs` when changing README or skill behavior.

## Verification

Run these before claiming work is complete:

```bash
npm test
npm run check:manifest
git diff --check
git status --short
```

For CLI smoke testing, use `tests/fake-claude-fixture.mjs` through `CLAUDE_COMPANION_CLAUDE_BIN`.
