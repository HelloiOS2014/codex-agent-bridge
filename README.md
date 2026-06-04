# Codex Agent Bridge

Agent Bridge is a Codex marketplace for agent-specific bridge plugins. Each plugin delegates planning, code review, adversarial review, or explicitly write-enabled rescue work to one local agent CLI.

The shipped plugins are **Claude Code Bridge** and **Antigravity Bridge**. They are skill-driven and CLI-only, and they do not use MCP. Future agents should be added as separate plugins in the marketplace instead of being hidden behind keyword routing inside one generic plugin.

## Requirements

- Node.js 18.18 or newer.
- Local Claude Code CLI installed and authenticated for the current Claude adapter.
- Local Antigravity CLI installed for the Antigravity adapter. The companion auto-discovers `agy` at `$HOME/.local/bin/agy`, `/opt/homebrew/bin/agy`, and `/usr/local/bin/agy`.
- Codex must expose the plugin root as `CLAUDE_PLUGIN_ROOT` when skills call the companion CLI.
- Codex must expose the plugin root as `ANTIGRAVITY_PLUGIN_ROOT` when Antigravity skills call the companion CLI.
- The companion auto-discovers common local Claude installs. Codex agents may use command-scoped `CLAUDE_COMPANION_CLAUDE_BIN` after locating a binary, but should not ask users to edit shell PATH.
- Codex agents may use command-scoped `ANTIGRAVITY_COMPANION_AGY_BIN` after locating an Antigravity binary, but should not ask users to edit shell PATH.

Verify Claude Code before installing the plugin:

```bash
claude --version
claude auth status
```

If Claude Code is not authenticated, run:

```bash
claude auth login
```

Verify Antigravity before installing the plugin:

```bash
agy --version
```

## Installation

This repository supports two installation shapes:

- **Full marketplace**: add the root repository, then choose one or more plugins from the Agent Bridge source.
- **Single plugin**: add only `plugins/claude-code-bridge` or `plugins/antigravity-bridge` with sparse checkout. Each plugin directory carries its own marketplace file pointing at `./`.

### Codex App

In the Codex app:

1. Open **Plugins** from the sidebar.
2. Click **Create** and choose **Add plugin marketplace**.
3. Fill the dialog for the full Agent Bridge marketplace:
   - Source: `git@github.com:HelloiOS2014/codex-agent-bridge.git`
   - Git ref: `main`
   - Sparse path: leave empty for the full Agent Bridge marketplace.
4. Click **Add marketplace**.
5. Choose the **Agent Bridge** source, open **Claude Code Bridge** or **Antigravity Bridge**, and select **Add to Codex**.
6. Restart Codex or start a new thread so the bundled skills are loaded.

To install only the Claude plugin from the Codex app, use the same dialog with:

- Source: `git@github.com:HelloiOS2014/codex-agent-bridge.git`
- Git ref: `main`
- Sparse path: `plugins/claude-code-bridge`

Then choose the **Claude Code Bridge** source, open **Claude Code Bridge**, and select **Add to Codex**.

To install only the Antigravity plugin from the Codex app, use:

- Source: `git@github.com:HelloiOS2014/codex-agent-bridge.git`
- Git ref: `main`
- Sparse path: `plugins/antigravity-bridge`

Then choose the **Antigravity Bridge** source, open **Antigravity Bridge**, and select **Add to Codex**.

### Codex CLI

```bash
codex plugin marketplace add git@github.com:HelloiOS2014/codex-agent-bridge.git --ref main
```

This registers the marketplace only. The current Codex CLI does not install or enable an individual plugin from a marketplace. After adding the marketplace, open Codex **Plugins**, choose the **Agent Bridge** source, open **Claude Code Bridge** or **Antigravity Bridge**, and select **Add to Codex**.

For single-plugin installation:

```bash
codex plugin marketplace add git@github.com:HelloiOS2014/codex-agent-bridge.git --ref main --sparse plugins/claude-code-bridge
```

Then open Codex **Plugins**, choose the **Claude Code Bridge** source, open **Claude Code Bridge**, and select **Add to Codex**.

For Antigravity single-plugin installation:

```bash
codex plugin marketplace add git@github.com:HelloiOS2014/codex-agent-bridge.git --ref main --sparse plugins/antigravity-bridge
```

Then open Codex **Plugins**, choose the **Antigravity Bridge** source, open **Antigravity Bridge**, and select **Add to Codex**.

If you previously added an older marketplace from an earlier README, remove the old entry and add the main-branch marketplace again:

```bash
codex plugin marketplace remove codex-agent-bridge
codex plugin marketplace remove claude-work
codex plugin marketplace remove claude-companion-local
codex plugin marketplace add git@github.com:HelloiOS2014/codex-agent-bridge.git --ref main
```

Refresh the marketplace snapshot:

```bash
codex plugin marketplace upgrade codex-agent-bridge
```

Do not use `--sparse .agents/plugins` for this repository. Use an empty sparse path for the full Agent Bridge marketplace, or `--sparse plugins/claude-code-bridge` / `--sparse plugins/antigravity-bridge` for a single plugin.

### Install on Another Machine

Use this sequence on a fresh machine:

1. Install and authenticate Claude Code, or install Antigravity CLI for Antigravity Bridge:

   ```bash
   claude --version
   claude auth status
   agy --version
   ```

2. Add the Git marketplace with either the Codex app or CLI:

   ```bash
   codex plugin marketplace add git@github.com:HelloiOS2014/codex-agent-bridge.git --ref main
   ```

3. In the Codex app, open **Plugins**, choose the **Agent Bridge** source, open **Claude Code Bridge** or **Antigravity Bridge**, and select **Add to Codex**.
4. Restart Codex or start a new thread so the bundled skills are loaded.
5. For later updates, run:

   ```bash
   codex plugin marketplace upgrade codex-agent-bridge
   ```

Codex App and Codex CLI share the same Codex home configuration. A correct full marketplace registration appears in `~/.codex/config.toml` like this:

```toml
[marketplaces.codex-agent-bridge]
source_type = "git"
source = "git@github.com:HelloiOS2014/codex-agent-bridge.git"
ref = "main"
```

### Verify Installation

Start a new Codex thread and run one of these prompts:

```text
Check Claude Code Bridge setup.
Ask Claude to plan a small README cleanup.
Ask Claude to review my current changes.
Check Antigravity Bridge setup.
Ask Antigravity to plan a small README cleanup.
Ask Antigravity to review my current changes.
```

The setup check should call:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
```

Expected result: `ready: true`, which means Claude Code is available and authenticated.

For Antigravity Bridge, the setup check should call:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" setup --json
```

Expected result: `ready: true`, which means Antigravity CLI is available.

## How Codex Uses It

After Claude Code Bridge is installed and enabled, Codex loads the skills in [`plugins/claude-code-bridge/skills/`](plugins/claude-code-bridge/skills/). After Antigravity Bridge is installed and enabled, Codex loads the skills in [`plugins/antigravity-bridge/skills/`](plugins/antigravity-bridge/skills/). These skills route natural-language requests to the selected local agent CLI.

Use these request patterns in Codex:

- Planning: "Ask Claude to plan this architecture", "让 Claude 规划这个改动".
- Normal review: "Ask Claude to review my current changes", "让 Claude review 当前工作区".
- Adversarial review: "Ask Claude to challenge this design", "让 Claude 从反方审查这个方案".
- Read-only rescue: "Ask Claude to investigate this failure", "让 Claude 排查这个问题但不要改文件".
- Write-enabled rescue: "Ask Claude to fix this issue", "让 Claude 修复这个问题".
- Job handling: "Check the Claude job status", "Show the last Claude result", "Cancel that Claude job".
- Antigravity planning: "Ask Antigravity to plan this architecture", "让 Antigravity 规划这个改动".
- Antigravity review: "Ask Antigravity to review my current changes", "让 Antigravity review 当前工作区".
- Antigravity rescue: "Ask Antigravity to fix this issue", "让 Antigravity 修复这个问题".
- Antigravity job handling: "Check the Antigravity job status", "Show the last Antigravity result", "Cancel that Antigravity job".

Skill mapping:

| Skill | Purpose | Default write access |
| --- | --- | --- |
| `claude-plan` | Architecture, rollout, risk, and implementation planning | Read-only |
| `claude-review` | Normal review and adversarial review | Read-only |
| `claude-rescue` | Investigation, dry-run rescue, or explicit implementation rescue | Read-only unless `--write` is used |
| `claude-result-handling` | Setup, status, result, and cancellation for stored jobs | Read-only |
| `antigravity-plan` | Architecture, rollout, risk, and implementation planning | Read-only |
| `antigravity-review` | Normal review and adversarial review | Read-only |
| `antigravity-rescue` | Investigation, dry-run rescue, or explicit implementation rescue | Read-only unless `--write` is used |
| `antigravity-result-handling` | Setup, status, result, and cancellation for stored jobs | Read-only |

## Direct CLI Usage

The skills call the adapter CLI through `CLAUDE_PLUGIN_ROOT`. Direct use should do the same so commands do not depend on the reviewed repository's current directory.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" plan --json --prompt "$PROMPT"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" review --json --scope working-tree
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" adversarial-review --json --scope auto --prompt "$FOCUS"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --json --prompt "$PROMPT"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --write --json --prompt "$PROMPT"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" storage --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --dry-run --json
```

Antigravity skills call the adapter CLI through `ANTIGRAVITY_PLUGIN_ROOT`:

```bash
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" setup --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" plan --json --prompt "$PROMPT"
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" review --json --scope working-tree
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" adversarial-review --json --scope auto --prompt "$FOCUS"
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --json --prompt "$PROMPT"
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --write --json --prompt "$PROMPT"
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" rescue --resume --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" storage --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cleanup --dry-run --json
```

Common options:

- `--cwd <workspace>`: run against a specific repository/workspace.
- `--json`: return machine-readable output for Codex to parse.
- `--prompt <text>`: pass the prompt explicitly.
- `--prompt-file <file>`: read the prompt from a file relative to the command workspace.
- `--model <model>`: pass a user-requested Claude Code model through to Claude. The value may be a short alias such as `opus` or `sonnet`, or a full model name. If the user does not specify a model, omit `--model` so Claude Code uses its own default model.
- Antigravity Bridge does not expose `--model`; local `agy` 1.0.4 has no model flag in this bridge.
- Antigravity `rescue --resume` passes `agy --continue`; `rescue --fresh` starts without continue mode.
- `--background`: start a stored job and return immediately.
- `--wait`: store the job, wait for completion, and return the result.
- `--timeout-ms <n>` or `--timeout <n>`: optional hard stop for deliberate time-boxed runs. Agents should not add this by default.
- `status --brief --json`: omit prompt args, stdout/stderr tails, and embedded stored result payloads from status output for polling or large histories.
- `storage --json`: report bridge state usage without deleting files.
- `cleanup --dry-run --json`: preview cleanup before deleting old stored job artifacts.
- `cleanup --json`: prune old terminal job artifacts while preserving active jobs.

Review options:

- `--scope auto|working-tree|branch`
- `--base <ref>` or `--against <ref>`
- `--max-diff-bytes <n>`
- `--max-untracked-file-bytes <n>`

## Background Jobs

Agents should use background jobs for broad plans, deep reviews, adversarial passes, long debugging, and implementation rescue. Do not add `--timeout` or `--timeout-ms` to normal delegated work unless the user gave an explicit time budget, the command is a smoke test, or the agent is intentionally probing cancellation behavior.

Start a long-running job:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" plan --background --json --prompt "$PROMPT"
```

Wait while still recording the job:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" review --wait --json --scope working-tree
```

Manage jobs:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" status "$JOB_ID" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" status --all --brief --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" result "$JOB_ID" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cancel "$JOB_ID" --json
```

`status --json` includes `phase`, `pid`, `claudePid`, `claudeArgv`, `runtimeMs`, `idleMs`, `lastActivityAt`, `firstOutputAt`, `lastOutputAt`, bounded `recentLog` entries, and bounded `stdoutTail` / `stderrTail` fields so callers can tell whether a long-running job has started, spawned Claude, produced output, and where it last recorded activity. Use `status --brief --json` when polling or reading broad history so prompt args, stdout/stderr tails, and embedded stored results are omitted.

Antigravity Bridge uses the same job commands. Its `status --json` includes `agyPid` and `agyArgv` instead of `claudePid` and `claudeArgv`.

Running Claude jobs can legitimately have empty stdout/stderr for a while. Agents should not cancel, add a timeout, or rerun only because stdout/stderr is quiet or `metadata.resultAvailable` is `false`; they should keep polling unless the user set a time budget, the job reaches a terminal state, or status evidence shows the job is stale.

`result "$JOB_ID" --json` on a queued or running job returns the job status with `metadata.resultAvailable: false` instead of reporting a failed result. `cancel "$JOB_ID" --json` reports whether TERM or KILL was signalled and whether the known worker / Claude process ids exited.

For background or waited jobs started with `--cwd <workspace>`, pass the same `--cwd` to `status`, `result`, and `cancel`:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" status "$JOB_ID" --cwd "$WORKSPACE" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" result "$JOB_ID" --cwd "$WORKSPACE" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cancel "$JOB_ID" --cwd "$WORKSPACE" --json
```

Inspect state usage:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" storage --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" storage --cwd "$WORKSPACE" --json
```

Preview cleanup before broad cleanup:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --dry-run --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --all --dry-run --json
```

Agents should run `storage --json` or `cleanup --dry-run --json` when many jobs exist, when a storage warning appears in a result, or when a new background job reports that the storage quota is exceeded. Do not run broad `cleanup --all` without first using `cleanup --all --dry-run --json`.

## State Storage

Job state is stored outside the reviewed project. State root priority:

1. `CLAUDE_COMPANION_STATE_DIR`
2. `CODEX_PLUGIN_DATA`
3. `CLAUDE_PLUGIN_DATA`
4. OS temp directory under `claude-companion`

Each workspace gets a hashed state directory. Job ids are safe filename identifiers and are validated before reading or writing job files.

These state variable names belong to Claude Code Bridge. Additional agents should have their own plugin-specific state names.

Antigravity Bridge uses the same storage model with Antigravity-specific names:

1. `ANTIGRAVITY_COMPANION_STATE_DIR`
2. `CODEX_PLUGIN_DATA`
3. `ANTIGRAVITY_PLUGIN_DATA`
4. OS temp directory under `antigravity-companion`

Storage is bounded so background jobs cannot grow without limit:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `CLAUDE_COMPANION_MAX_JOBS` | `50` | Recent terminal jobs to retain per workspace. |
| `CLAUDE_COMPANION_MAX_STATE_BYTES` | `536870912` | Total state-root quota, 512 MiB. |
| `CLAUDE_COMPANION_MAX_LOG_BYTES` | `5242880` | Per-job log cap, 5 MiB. |
| `CLAUDE_COMPANION_MAX_RESULT_BYTES` | `2097152` | Per-job stored result JSON cap, 2 MiB. |
| `CLAUDE_COMPANION_MAX_RESULT_TEXT_BYTES` | `1048576` | Per large text field cap, 1 MiB. |
| `CLAUDE_COMPANION_MAX_JOB_AGE_DAYS` | `7` | Age cap for terminal job artifacts. |

Antigravity Bridge uses matching caps with the `ANTIGRAVITY_COMPANION_` prefix, including `ANTIGRAVITY_COMPANION_MAX_STATE_BYTES`.

These caps are archival caps, not execution caps. They do not stop Claude Code, do not shrink the prompt or review context sent to Claude, and do not truncate stdout before Claude JSON has been parsed. They only bound what the bridge stores after a result has been normalized.

When stored output exceeds a cap, the bridge writes `metadata.storage.truncated` and records the affected fields and omitted byte count. If a result is still too large after string truncation, the bridge stores a compact fallback result with `metadata.storage.fallback`.

Cleanup never removes `queued` or `running` jobs. Explicit `result <job-id>` reads protect that selected result from the cleanup pass used during result handling.

## Safety Model

- `plan`, `review`, and `adversarial-review` are read-only companion commands.
- `plan` uses Claude Code's non-interactive `dontAsk` permission mode with the read-only `Read,Glob,Grep` tool profile.
- Antigravity read-only commands use `agy --print` with `--sandbox`; this is not the same tool-profile model as Claude Code.
- `rescue` is read-only unless `--write` is present.
- `rescue --write` is only for explicit user requests to edit or implement.
- Dangerous Claude Code bypass flags are rejected by the current adapter.
- Dangerous Antigravity bypass flags, including `--dangerously-skip-permissions`, are rejected by the Antigravity adapter.
- Do not automatically apply Claude output or Antigravity output, and do not stage, commit, or push from companion flows.
- Job management commands do not edit project files.
- The plugin is CLI-only and does not use MCP.

Rejected dangerous options include:

- `--dangerously-skip-permissions`
- `--allow-dangerously-skip-permissions`
- `--dangerously-bypass-approvals-and-sandbox`
- `--permission-mode bypassPermissions`

## Testing

Run the full test suite:

```bash
npm test
npm run check:manifest
```

Local smoke tests can use the deterministic fake Claude fixture:

```bash
export CLAUDE_PLUGIN_ROOT="$PWD/plugins/claude-code-bridge"
export CLAUDE_COMPANION_CLAUDE_BIN="$PWD/tests/fake-claude-fixture.mjs"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" plan "plan the plugin"
```

Local Antigravity smoke tests can use the deterministic fake agy fixture:

```bash
export ANTIGRAVITY_PLUGIN_ROOT="$PWD/plugins/antigravity-bridge"
export ANTIGRAVITY_COMPANION_AGY_BIN="$PWD/tests/fake-agy-fixture.mjs"
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" setup --json
node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" plan "plan the plugin"
```

Review smoke in a temporary dirty repository:

```bash
tmpdir="$(mktemp -d)"
git -C "$tmpdir" init -q
git -C "$tmpdir" config user.email test@example.com
git -C "$tmpdir" config user.name "Test User"
printf "initial\n" > "$tmpdir/README.md"
git -C "$tmpdir" add README.md
git -C "$tmpdir" commit -q -m initial
printf "changed\n" > "$tmpdir/changed.txt"
export CLAUDE_PLUGIN_ROOT="$PWD/plugins/claude-code-bridge"
CLAUDE_COMPANION_CLAUDE_BIN="$PWD/tests/fake-claude-fixture.mjs" \
  node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" review --cwd "$tmpdir" --scope working-tree
export ANTIGRAVITY_PLUGIN_ROOT="$PWD/plugins/antigravity-bridge"
ANTIGRAVITY_COMPANION_AGY_BIN="$PWD/tests/fake-agy-fixture.mjs" \
  node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" review --cwd "$tmpdir" --scope working-tree
```

## Repository Layout

- `.agents/plugins/marketplace.json`: root marketplace entry for installing all Agent Bridge plugins from this repository.
- `plugins/claude-code-bridge/.agents/plugins/marketplace.json`: plugin-local marketplace for sparse single-plugin installation.
- `plugins/claude-code-bridge/.codex-plugin/plugin.json`: Codex plugin manifest. Declares skills and no MCP servers.
- `plugins/claude-code-bridge/skills/`: Codex skill instructions for plan, review, rescue, and result handling.
- `plugins/claude-code-bridge/scripts/claude-companion.mjs`: current Claude Code adapter CLI entrypoint.
- `plugins/claude-code-bridge/scripts/lib/`: argument parsing, Claude invocation, git context, state, background jobs, rendering, and process helpers.
- `plugins/claude-code-bridge/schemas/review-output.schema.json`: normalized result schema.
- `plugins/antigravity-bridge/.agents/plugins/marketplace.json`: plugin-local marketplace for sparse single-plugin installation.
- `plugins/antigravity-bridge/.codex-plugin/plugin.json`: Codex plugin manifest. Declares skills and no MCP servers.
- `plugins/antigravity-bridge/skills/`: Codex skill instructions for plan, review, rescue, and result handling.
- `plugins/antigravity-bridge/scripts/antigravity-companion.mjs`: current Antigravity adapter CLI entrypoint.
- `plugins/antigravity-bridge/scripts/lib/`: argument parsing, `agy` invocation, git context, state, background jobs, rendering, and process helpers.
- `plugins/antigravity-bridge/schemas/review-output.schema.json`: normalized result schema.
- `tests/`: fake Claude and fake agy fixtures plus automated tests.
- `AGENTS.md`: maintenance rules for future agents.

## Limits

- Tests use a deterministic fake Claude fixture; they do not prove real Claude Code long-task behavior.
- Tests use a deterministic fake agy fixture; they do not prove real Antigravity long-task behavior.
- `npm run check:manifest` is a lightweight manifest check. Detailed plugin behavior is covered by `npm test`.
- Storage caps apply to archived job output. They do not solve unbounded in-memory stdout/stderr capture while Claude is still running.

## Troubleshooting

- Plugin does not appear in the Codex app: restart Codex and choose the **Agent Bridge** source. If you added an older marketplace, remove `codex-agent-bridge`, `claude-work`, or `claude-companion-local` and add the current main-branch marketplace again.
- CLI-managed marketplace is stale: run `codex plugin marketplace upgrade codex-agent-bridge`.
- Skills do not trigger: start a new thread and explicitly mention the plugin or skill. In the Codex app, type `@`; in CLI/IDE, use `/skills` or `$` skill invocation.
- Claude `setup --json` returns `ready: false`: if the binary is missing, the agent should check common local install locations and retry once with command-scoped `CLAUDE_COMPANION_CLAUDE_BIN`. Do not ask users to edit shell PATH. If no binary is found, report the setup blocker; if authentication is missing, run `claude auth login`.
- Antigravity `setup --json` returns `ready: false`: if the binary is missing, the agent should check `$HOME/.local/bin/agy`, `/opt/homebrew/bin/agy`, and `/usr/local/bin/agy`, then retry once with command-scoped `ANTIGRAVITY_COMPANION_AGY_BIN`. Do not ask users to edit shell PATH.
- Background job cannot be found: if the job was started with `--cwd <workspace>`, pass the same `--cwd` to `status`, `result`, or `cancel`.
- Storage quota exceeded: run `node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cleanup --dry-run --json`, then use `cleanup --json` or increase `CLAUDE_COMPANION_MAX_STATE_BYTES`.
- Antigravity storage quota exceeded: run `node "$ANTIGRAVITY_PLUGIN_ROOT/scripts/antigravity-companion.mjs" cleanup --dry-run --json`, then use `cleanup --json` or increase `ANTIGRAVITY_COMPANION_MAX_STATE_BYTES`.
- Stored result says `metadata.storage.truncated`: the archived output was shortened to protect disk usage. Increase `CLAUDE_COMPANION_MAX_RESULT_BYTES` or `CLAUDE_COMPANION_MAX_RESULT_TEXT_BYTES` for future runs if you need larger stored output.
- Local copy is stale: run `codex plugin marketplace upgrade codex-agent-bridge`, then restart Codex.
