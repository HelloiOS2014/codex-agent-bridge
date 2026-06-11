# Agent Instructions

This repository builds an Agent Bridge Codex marketplace. The marketplace exposes multiple agent-specific plugins. The shipped plugins are Claude Code Bridge and Antigravity Bridge for planning, review, adversarial review, and explicitly write-enabled rescue work.

## Core Rules

- Keep every plugin CLI-only. Do not add MCP servers or `mcpServers` to any `.codex-plugin/plugin.json`.
- Skills must invoke the companion through `node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs"`.
- Antigravity skills must invoke the companion through `node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs"`.
- Do not invoke the companion through a bare relative script path in README, skills, or tests.
- Keep marketplace, plugin, and agent boundaries distinct. Do not route multiple agents through one generic plugin by keyword matching.
- `plan`, `review`, and `adversarial-review` must remain read-only.
- `rescue` must remain read-only unless the user explicitly requested file edits and the command uses `--write`.
- Do not add Claude or Antigravity bypass behavior or allow `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, or `--permission-mode bypassPermissions`.
- Companion flows must not automatically apply delegated output, stage files, create commits, or push changes.

## Codex Invocation Rules

- Codex agents invoking Bridge companion commands must request `sandbox_permissions: "require_escalated"` on the first attempt. Do not run Bridge companion commands in the default Codex sandbox first and retry after sandbox failure.
- A user's explicit request to use a Bridge is delegation authorization for the named Bridge and current task. Do not ask for a second delegation confirmation unless the workspace is ambiguous, the request would expose secrets or credentials, scope expands beyond the user request, or write-enabled rescue was not explicitly requested.
- Do not run `setup --json`, `claude auth status`, or `agy --version` before every delegation. Assume the bridge is already installed and authenticated unless a companion command reports a missing binary, authentication failure, unusable state, or the user explicitly asks for a setup check.

## Background Job Rules

- Preserve terminal job states. A worker must not overwrite a cancelled, failed, or completed job.
- If a worker cannot start, persist a failed job result instead of leaving a permanent queued job.
- Reconcile stale queued/running jobs to failed results.
- For jobs started with `--cwd`, `status`, `result`, and `cancel` must support the same `--cwd`.
- Keep job state outside the reviewed project. Preserve each plugin's state root priority. Claude uses `CLAUDE_COMPANION_STATE_DIR`, `CODEX_PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA`, then OS temp. Antigravity uses `ANTIGRAVITY_COMPANION_STATE_DIR`, `CODEX_PLUGIN_DATA`, `ANTIGRAVITY_PLUGIN_DATA`, then OS temp.
- Keep stored job artifacts bounded. Result and log caps are archival caps only; do not truncate prompts, review context, or stdout before delegated output parsing.
- Preserve active jobs during cleanup. `queued` and `running` jobs must not be deleted by cleanup.
- Preserve explicitly selected result jobs while reading results.
- Keep truncation metadata visible through `metadata.storage`.
- If storage cleanup behavior changes, update `tests/state.test.mjs`, `tests/storage-prune.test.mjs`, `tests/background.test.mjs`, and `tests/skills.test.mjs`.

## Documentation Rules

- README must document installation, Codex usage, direct CLI usage, safety model, background jobs, state storage, tests, troubleshooting, and repository layout.
- README and Claude skills must mention the `$CLAUDE_PLUGIN_ROOT` command path.
- README and Antigravity skills must mention the `$ANTIGRAVITY_PLUGIN_ROOT` command path.
- README installation docs must cover both Codex App UI fields and Codex CLI commands.
- README installation docs must use the main branch as the install ref, not a development branch.
- README installation docs must cover root marketplace installation only.
- README and skills must stay consistent for `--background`, `--wait`, `--cwd`, `status`, `result`, `cancel`, `storage`, and `cleanup`.
- If the user specifies a Claude Code model, pass it with `--model`. Short aliases such as `opus` or `sonnet` must be passed through as model values. If the user does not specify a model, omit `--model` so Claude Code uses its own default model.
- Do not document or pass `--model` for Antigravity Bridge unless local `agy` exposes a supported model flag and tests are updated.
- Skills must tell Codex agents not to add `--timeout` or `--timeout-ms` by default. Expected long-running delegated work should use `--background --json`; timeout flags are only for explicit user time budgets, smoke tests, or deliberate cancellation-style probes.
- Skills must tell Codex agents: Do not ask users to edit shell PATH. If setup reports a missing Claude binary, agents should check common local install locations and use command-scoped `CLAUDE_COMPANION_CLAUDE_BIN` for the retry.
- Antigravity skills must tell Codex agents: Do not ask users to edit shell PATH. If setup reports a missing `agy` binary, agents should check common local install locations and use command-scoped `ANTIGRAVITY_COMPANION_AGY_BIN` for the retry.
- Skills must tell Codex agents to inspect `storage --json` or `cleanup --dry-run --json` when many jobs exist, storage warnings appear, or quota errors block background work. Broad `cleanup --all` must be preceded by `cleanup --all --dry-run --json`.
- Marketplace and plugin manifests must use a Codex App-visible category such as `Developer Tools`; do not invent categories like `Coding`.
- Keep `.agents/plugins/marketplace.json` valid when changing plugin name, display name, or repository layout. This repository has exactly one marketplace, and the root marketplace entry for Claude Code Bridge must point to `./plugins/claude-code-bridge`, while the root marketplace entry for Antigravity Bridge must point to `./plugins/antigravity-bridge`.
- Do not add plugin-local marketplaces such as `plugins/*/.agents/plugins/marketplace.json`.
- Do not document personal marketplace copying or sparse marketplace installation for this repository.
- Update `tests/skills.test.mjs` when changing README or skill behavior.

## Verification

Run these before claiming work is complete:

```bash
npm test
npm run check:manifest
git diff --check
git status --short
```

For Claude CLI smoke testing, use `tests/fake-claude-fixture.mjs` through `CLAUDE_COMPANION_CLAUDE_BIN`.
For Antigravity CLI smoke testing, use `tests/fake-agy-fixture.mjs` through `ANTIGRAVITY_COMPANION_AGY_BIN`.
