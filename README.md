# Claude Companion Codex Plugin

Claude Companion is a Codex plugin for delegating planning, code review, adversarial review, and explicitly write-enabled rescue work to local Claude Code.

The plugin is skill-driven and CLI-only. It does not use MCP.

## Requirements

- Node.js 18.18 or newer.
- Local Claude Code CLI installed and authenticated.
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

### Install From This Git Repository

This repository includes a local marketplace file at `.agents/plugins/marketplace.json`, so Codex can add the repository as a marketplace source.

```bash
codex plugin marketplace add git@github.com:HelloiOS2014/claude_work.git --ref codex/claude-companion-plugin
codex plugin marketplace list
```

Then install the plugin:

- Codex app: open **Plugins**, choose the `claude-companion-local` marketplace, open **Claude Companion**, and select **Add to Codex**.
- Codex CLI: run `codex`, enter `/plugins`, choose the `claude-companion-local` marketplace, open **Claude Companion**, and select `Install plugin`.

Restart Codex or start a new thread after installation so the bundled skills are loaded.

### Install From A Local Checkout

Use this when you are testing an unpublished checkout.

```bash
git clone git@github.com:HelloiOS2014/claude_work.git ~/code/claude_work
cd ~/code/claude_work
git checkout codex/claude-companion-plugin
codex plugin marketplace add "$(pwd)"
```

Then install it from **Plugins** in the Codex app or `/plugins` in the Codex CLI.

### Manual Personal Marketplace

Use this when you do not want Codex to track the Git repository as a marketplace source.

```bash
PLUGIN_SRC="/absolute/path/to/claude_work"
mkdir -p "$HOME/.codex/plugins/claude-companion" "$HOME/.agents/plugins"
cp -R "$PLUGIN_SRC"/. "$HOME/.codex/plugins/claude-companion/"
```

Create or update `~/.agents/plugins/marketplace.json`:

```json
{
  "name": "personal-local",
  "plugins": [
    {
      "name": "claude-companion",
      "source": {
        "source": "local",
        "path": "./.codex/plugins/claude-companion"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Coding",
      "interface": {
        "displayName": "Claude Companion"
      }
    }
  ]
}
```

Restart Codex, open **Plugins** or `/plugins`, and install **Claude Companion** from the `personal-local` marketplace.

### Verify Installation

Start a new Codex thread and run one of these prompts:

```text
Check Claude Companion setup.
Ask Claude to plan a small README cleanup.
Ask Claude to review my current changes.
```

The setup check should call:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs" setup --json
```

Expected result: `ready: true`, which means Claude Code is available and authenticated.

## How Codex Uses It

After the plugin is installed and enabled, Codex loads the skills in [`skills/`](skills/). The skills route natural-language requests to the companion CLI.

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

The skills call the CLI through `CLAUDE_PLUGIN_ROOT`. Direct use should do the same so commands do not depend on the reviewed repository's current directory.

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
- `--timeout-ms <n>` or `--timeout <n>`: cancel foreground Claude execution after the timeout.

Review options:

- `--scope auto|working-tree|branch`
- `--base <ref>` or `--against <ref>`
- `--max-diff-bytes <n>`
- `--max-untracked-file-bytes <n>`

## Background Jobs

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

## Safety Model

- `plan`, `review`, and `adversarial-review` are read-only companion commands.
- `rescue` is read-only unless `--write` is present.
- `rescue --write` is only for explicit user requests to edit or implement.
- Dangerous Claude Code bypass flags are rejected by the companion.
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
export CLAUDE_PLUGIN_ROOT="$PWD"
export CLAUDE_COMPANION_CLAUDE_BIN="$CLAUDE_PLUGIN_ROOT/tests/fake-claude-fixture.mjs"
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
CLAUDE_COMPANION_CLAUDE_BIN="$PWD/tests/fake-claude-fixture.mjs" \
  node "$PWD/scripts/claude-companion.mjs" review --cwd "$tmpdir" --scope working-tree
```

## Repository Layout

- `.codex-plugin/plugin.json`: Codex plugin manifest. Declares skills and no MCP servers.
- `.agents/plugins/marketplace.json`: local marketplace entry for installing this repository as a Codex plugin source.
- `skills/`: Codex skill instructions for plan, review, rescue, and result handling.
- `scripts/claude-companion.mjs`: CLI entrypoint.
- `scripts/lib/`: argument parsing, Claude invocation, git context, state, background jobs, rendering, and process helpers.
- `schemas/review-output.schema.json`: normalized result schema.
- `tests/`: fake Claude fixture and automated tests.
- `AGENTS.md`: maintenance rules for future agents.

## Limits

- Tests use a deterministic fake Claude fixture; they do not prove real Claude Code long-task behavior.
- `npm run check:manifest` is a lightweight manifest check. Detailed plugin behavior is covered by `npm test`.

## Troubleshooting

- Plugin does not appear: run `codex plugin marketplace list`, confirm the marketplace root is present, then restart Codex.
- Skills do not trigger: start a new thread and explicitly mention the plugin or skill. In the Codex app, type `@`; in CLI/IDE, use `/skills` or `$` skill invocation.
- `setup --json` returns `ready: false`: install Claude Code, run `claude auth login`, or set `CLAUDE_COMPANION_CLAUDE_BIN` to the Claude binary.
- Background job cannot be found: if the job was started with `--cwd <workspace>`, pass the same `--cwd` to `status`, `result`, or `cancel`.
- Local copy is stale: update the plugin directory or run `codex plugin marketplace upgrade`, then restart Codex.
