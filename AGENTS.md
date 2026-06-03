# Agent Instructions

This repository builds an Agent Bridge Codex marketplace. The marketplace can expose multiple agent-specific plugins; the current shipped plugin is Claude Code Bridge for planning, review, adversarial review, and explicitly write-enabled rescue work.

## Core Rules

- Keep every plugin CLI-only. Do not add MCP servers or `mcpServers` to `plugins/claude-code-bridge/.codex-plugin/plugin.json`.
- Skills must invoke the companion through `node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs"`.
- Do not invoke the companion through a bare relative script path in README, skills, or tests.
- Keep marketplace, plugin, and agent boundaries distinct. Do not route multiple agents through one generic plugin by keyword matching.
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
- README installation docs must cover both Codex App UI fields and Codex CLI commands.
- README installation docs must use the main branch as the install ref, not a development branch.
- README installation docs must cover full marketplace installation and single-plugin sparse installation.
- README and skills must stay consistent for `--background`, `--wait`, `--cwd`, `status`, `result`, and `cancel`.
- Skills must tell Codex agents not to add `--timeout` or `--timeout-ms` by default. Expected long-running delegated work should use `--background --json`; timeout flags are only for explicit user time budgets, smoke tests, or deliberate cancellation-style probes.
- Marketplace and plugin manifests must use a Codex App-visible category such as `Developer Tools`; do not invent categories like `Coding`.
- Keep `.agents/plugins/marketplace.json` valid when changing plugin name, display name, or repository layout. This is a multi-plugin marketplace repository; the root marketplace entry for Claude Code Bridge must point to `./plugins/claude-code-bridge`.
- Keep each installable plugin's plugin-local marketplace valid for single-plugin sparse installation. For Claude Code Bridge, `plugins/claude-code-bridge/.agents/plugins/marketplace.json` must use `source.path = "./"`.
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
