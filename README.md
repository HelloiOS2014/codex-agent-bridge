# Codex Agent Bridge

Agent Bridge is a Codex marketplace for agent-specific bridge plugins. Each plugin delegates planning, code review, adversarial review, or explicitly write-enabled rescue work to one local agent CLI.

The shipped plugin is **Claude Code Bridge**. It is skill-driven and CLI-only, and it does not use MCP. Future agents should be added as separate plugins in the marketplace instead of being hidden behind keyword routing inside one generic plugin.

## Requirements

- Node.js 18.18 or newer.
- Local Claude Code CLI installed and authenticated for the current Claude adapter.
- Codex must expose the plugin root as `CLAUDE_PLUGIN_ROOT` when skills call the companion CLI.
- Optional: set `CLAUDE_COMPANION_CLAUDE_BIN` if `claude` is not on `PATH`.

Verify Claude Code before installing the plugin:

```bash
claude --version
claude auth status
```

If Claude Code is not authenticated, run:

```bash
claude auth login
```

## Installation

This repository supports two installation shapes:

- **Full marketplace**: add the root repository, then choose one or more plugins from the Agent Bridge source.
- **Single plugin**: add only `plugins/claude-code-bridge` with sparse checkout. That plugin directory carries its own marketplace file pointing at `./`.

### Codex App

In the Codex app:

1. Open **Plugins** from the sidebar.
2. Click **Create** and choose **Add plugin marketplace**.
3. Fill the dialog for the full Agent Bridge marketplace:
   - Source: `git@github.com:HelloiOS2014/codex-agent-bridge.git`
   - Git ref: `main`
   - Sparse path: leave empty for the full Agent Bridge marketplace.
4. Click **Add marketplace**.
5. Choose the **Agent Bridge** source, open **Claude Code Bridge**, and select **Add to Codex**.
6. Restart Codex or start a new thread so the bundled skills are loaded.

To install only the Claude plugin from the Codex app, use the same dialog with:

- Source: `git@github.com:HelloiOS2014/codex-agent-bridge.git`
- Git ref: `main`
- Sparse path: `plugins/claude-code-bridge`

Then choose the **Claude Code Bridge** source, open **Claude Code Bridge**, and select **Add to Codex**.

### Codex CLI

```bash
codex plugin marketplace add git@github.com:HelloiOS2014/codex-agent-bridge.git --ref main
```

Then open Codex **Plugins**, choose the **Agent Bridge** source, open **Claude Code Bridge**, and select **Add to Codex**.

For single-plugin installation:

```bash
codex plugin marketplace add git@github.com:HelloiOS2014/codex-agent-bridge.git --ref main --sparse plugins/claude-code-bridge
```

Then open Codex **Plugins**, choose the **Claude Code Bridge** source, open **Claude Code Bridge**, and select **Add to Codex**.

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

Do not use `--sparse .agents/plugins` for this repository. Use an empty sparse path for the full Agent Bridge marketplace, or `--sparse plugins/claude-code-bridge` for the single Claude Code Bridge plugin.

### Verify Installation

Start a new Codex thread and run one of these prompts:

```text
Check Claude Code Bridge setup.
Ask Claude to plan a small README cleanup.
Ask Claude to review my current changes.
```

The setup check should call:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
```

Expected result: `ready: true`, which means Claude Code is available and authenticated.

## How Codex Uses It

After Claude Code Bridge is installed and enabled, Codex loads the skills in [`plugins/claude-code-bridge/skills/`](plugins/claude-code-bridge/skills/). These skills route natural-language requests to the local Claude Code CLI.

Use these request patterns in Codex:

- Planning: "Ask Claude to plan this architecture", "让 Claude 规划这个改动".
- Normal review: "Ask Claude to review my current changes", "让 Claude review 当前工作区".
- Adversarial review: "Ask Claude to challenge this design", "让 Claude 从反方审查这个方案".
- Read-only rescue: "Ask Claude to investigate this failure", "让 Claude 排查这个问题但不要改文件".
- Write-enabled rescue: "Ask Claude to fix this issue", "让 Claude 修复这个问题".
- Job handling: "Check the Claude job status", "Show the last Claude result", "Cancel that Claude job".

Skill mapping:

| Skill | Purpose | Default write access |
| --- | --- | --- |
| `claude-plan` | Architecture, rollout, risk, and implementation planning | Read-only |
| `claude-review` | Normal review and adversarial review | Read-only |
| `claude-rescue` | Investigation, dry-run rescue, or explicit implementation rescue | Read-only unless `--write` is used |
| `claude-result-handling` | Setup, status, result, and cancellation for stored jobs | Read-only |

## Direct CLI Usage

The skills call the adapter CLI through `CLAUDE_PLUGIN_ROOT`. Direct use should do the same so commands do not depend on the reviewed repository's current directory.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" plan --json --prompt "$PROMPT"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" review --json --scope working-tree
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" adversarial-review --json --scope auto --prompt "$FOCUS"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --json --prompt "$PROMPT"
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" rescue --write --json --prompt "$PROMPT"
```

Common options:

- `--cwd <workspace>`: run against a specific repository/workspace.
- `--json`: return machine-readable output for Codex to parse.
- `--prompt <text>`: pass the prompt explicitly.
- `--prompt-file <file>`: read the prompt from a file relative to the command workspace.
- `--background`: start a stored job and return immediately.
- `--wait`: store the job, wait for completion, and return the result.
- `--timeout-ms <n>` or `--timeout <n>`: optional hard stop for deliberate time-boxed runs. Agents should not add this by default.

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
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" result "$JOB_ID" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cancel "$JOB_ID" --json
```

For background or waited jobs started with `--cwd <workspace>`, pass the same `--cwd` to `status`, `result`, and `cancel`:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" status "$JOB_ID" --cwd "$WORKSPACE" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" result "$JOB_ID" --cwd "$WORKSPACE" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" cancel "$JOB_ID" --cwd "$WORKSPACE" --json
```

## State Storage

Job state is stored outside the reviewed project. State root priority:

1. `CLAUDE_COMPANION_STATE_DIR`
2. `CODEX_PLUGIN_DATA`
3. `CLAUDE_PLUGIN_DATA`
4. OS temp directory under `claude-companion`

Each workspace gets a hashed state directory. Job ids are safe filename identifiers and are validated before reading or writing job files.

These state variable names belong to Claude Code Bridge. Additional agents should have their own plugin-specific state names.

## Safety Model

- `plan`, `review`, and `adversarial-review` are read-only companion commands.
- `rescue` is read-only unless `--write` is present.
- `rescue --write` is only for explicit user requests to edit or implement.
- Dangerous Claude Code bypass flags are rejected by the current adapter.
- Do not automatically apply Claude output, and do not stage, commit, or push from companion flows.
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
```

## Repository Layout

- `.agents/plugins/marketplace.json`: root marketplace entry for installing all Agent Bridge plugins from this repository.
- `plugins/claude-code-bridge/.agents/plugins/marketplace.json`: plugin-local marketplace for sparse single-plugin installation.
- `plugins/claude-code-bridge/.codex-plugin/plugin.json`: Codex plugin manifest. Declares skills and no MCP servers.
- `plugins/claude-code-bridge/skills/`: Codex skill instructions for plan, review, rescue, and result handling.
- `plugins/claude-code-bridge/scripts/claude-companion.mjs`: current Claude Code adapter CLI entrypoint.
- `plugins/claude-code-bridge/scripts/lib/`: argument parsing, Claude invocation, git context, state, background jobs, rendering, and process helpers.
- `plugins/claude-code-bridge/schemas/review-output.schema.json`: normalized result schema.
- `tests/`: fake Claude fixture and automated tests.
- `AGENTS.md`: maintenance rules for future agents.

## Limits

- Tests use a deterministic fake Claude fixture; they do not prove real Claude Code long-task behavior.
- `npm run check:manifest` is a lightweight manifest check. Detailed plugin behavior is covered by `npm test`.

## Troubleshooting

- Plugin does not appear in the Codex app: restart Codex and choose the **Agent Bridge** source. If you added an older marketplace, remove `codex-agent-bridge`, `claude-work`, or `claude-companion-local` and add the current main-branch marketplace again.
- CLI-managed marketplace is stale: run `codex plugin marketplace upgrade codex-agent-bridge`.
- Skills do not trigger: start a new thread and explicitly mention the plugin or skill. In the Codex app, type `@`; in CLI/IDE, use `/skills` or `$` skill invocation.
- `setup --json` returns `ready: false`: install Claude Code, run `claude auth login`, or set `CLAUDE_COMPANION_CLAUDE_BIN` to the Claude binary.
- Background job cannot be found: if the job was started with `--cwd <workspace>`, pass the same `--cwd` to `status`, `result`, or `cancel`.
- Local copy is stale: run `codex plugin marketplace upgrade codex-agent-bridge`, then restart Codex.
