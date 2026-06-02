# Claude Companion Codex Plugin Design

Date: 2026-06-02

## Goal

Build a Codex plugin that lets Codex delegate planning, review, adversarial review, and explicitly requested implementation rescue work to Claude Code.

This is the reverse of `openai/codex-plugin-cc`: that project lets Claude Code call Codex; this project lets Codex call Claude Code. The design is not an MVP scope cut. It defines the full plugin surface, then implementation can be sequenced without changing the target capability set.

## Non-Goals

- Do not use MCP for the core design. The plugin does not need a tool server; a skill-driven Node companion CLI is enough.
- Do not make planning or review commands edit files.
- Do not enable dangerous Claude Code bypass modes.
- Do not write job state into the reviewed project working tree by default.
- Do not depend on live Claude network calls for normal automated tests.

## Architecture

The plugin has two layers:

1. Codex plugin skills route user intent and enforce behavior.
2. A Node companion CLI performs all runtime work: argument parsing, Claude invocation, git context collection, job tracking, output rendering, and cancellation.

Proposed repository layout:

```text
.codex-plugin/plugin.json
README.md
package.json
schemas/
  review-output.schema.json
scripts/
  claude-companion.mjs
  lib/
    args.mjs
    claude.mjs
    git.mjs
    jobs.mjs
    process.mjs
    render.mjs
    state.mjs
skills/
  claude-plan/SKILL.md
  claude-review/SKILL.md
  claude-rescue/SKILL.md
  claude-result-handling/SKILL.md
tests/
  fake-claude-fixture.mjs
  *.test.mjs
```

## Plugin Surface

The Codex plugin manifest declares the plugin metadata and the `skills/` path. It does not declare MCP servers.

Skills:

- `claude-plan`: use when the user wants planning, architecture, design, specs, or execution strategy from Claude Code.
- `claude-review`: use when the user wants Claude Code to review current changes, a branch diff, or challenge a design.
- `claude-rescue`: use when the user explicitly wants Claude Code to investigate, fix, implement, or continue work.
- `claude-result-handling`: use for setup, status, result, cancel, and interpreting stored Claude job output.

The skills should call the companion CLI rather than embedding direct `claude` invocations. This keeps behavior testable and consistent.

## Companion CLI

Command surface:

```bash
node scripts/claude-companion.mjs setup [--json]
node scripts/claude-companion.mjs plan [--background|--wait] [--model <model>] [--effort <level>] [prompt...]
node scripts/claude-companion.mjs review [--background|--wait] [--base <ref>] [--scope auto|working-tree|branch] [--json]
node scripts/claude-companion.mjs adversarial-review [--background|--wait] [--base <ref>] [--scope auto|working-tree|branch] [focus...]
node scripts/claude-companion.mjs rescue [--background|--wait] [--resume|--fresh] [--write] [--model <model>] [--effort <level>] [prompt...]
node scripts/claude-companion.mjs status [job-id] [--all] [--json]
node scripts/claude-companion.mjs result [job-id] [--json]
node scripts/claude-companion.mjs cancel [job-id] [--json]
```

The CLI must support prompt input from positionals, `--prompt-file`, and piped stdin where useful. It should use `spawn` with argv arrays, not shell string construction, for Claude and git calls.

## Permission Model

Read-only is enforced by command design, tool restrictions, and context collection, not only by prompt wording.

`plan`:

- Always read-only.
- Claude may read repository context if the invocation permits read tools.
- Claude must not receive edit/write tools.
- The prompt states that the expected output is a plan or design, not a patch.

`review`:

- Always read-only.
- The companion collects git context first: status, diff, changed files, branch/base metadata, and selected untracked text files.
- Claude reviews the collected context. It does not need broad write-capable access.
- The output is findings and risk analysis only.

`adversarial-review`:

- Always read-only.
- Uses the same target collection as `review`.
- Prompt framing challenges design choices, hidden assumptions, failure modes, rollback, data loss, race conditions, and alternatives.

`rescue`:

- Defaults to read-only investigation.
- `--write` is required for Claude Code to edit files.
- Skills add `--write` only when the user explicitly asks Claude to fix, implement, change code, apply a plan, or continue write-capable work.
- The companion must reject dangerous bypass flags and must not expose a passthrough that can smuggle them.

Setup, status, result, and cancel do not touch project files. They may write companion state outside the project tree.

## Claude Invocation

The companion uses the local `claude` binary and the user's existing Claude Code authentication.

Setup checks:

- `claude` availability.
- `claude --version`.
- `claude auth status`.
- Node.js version.

Invocation strategy:

- Use `claude -p --output-format json` for foreground structured runs.
- Use `--permission-mode plan` for planning where appropriate.
- For read-only review, prefer pre-collected git context plus constrained Claude execution.
- For write-capable rescue, use an explicit write mode and record touched files from git diff after completion.
- Prefer an explicit recorded Claude session id for resume. Do not blindly use `--continue` when the companion cannot identify the correct prior job.

The companion may support `claude ultrareview` as a later review mode, but normal local review must not depend on it.

## Review Target Resolution

Supported target modes:

- `working-tree`: staged, unstaged, and untracked text files.
- `branch`: diff against a detected or specified base branch.
- `auto`: working tree if dirty, otherwise branch diff against detected default branch.

Rules:

- If `--base <ref>` is provided, use branch mode.
- If `--scope working-tree` is provided, do not inspect branch diff.
- If no reviewable changes exist, report that directly.
- Include untracked text files up to a bounded byte limit.
- Skip binary files and directories with explicit notes.

## State Management

The companion stores state outside the project by default.

State root priority:

1. `CLAUDE_COMPANION_STATE_DIR`
2. Codex/plugin data directory if available in the environment
3. `$TMPDIR/claude-companion`

Each workspace gets an isolated state directory based on the real workspace path plus a stable hash.

State files:

- `state.json`: config and recent job index.
- `jobs/<job-id>.json`: full job record and result payload.
- `jobs/<job-id>.log`: progress log.

Job fields:

- `id`
- `kind`
- `status`
- `phase`
- `pid`
- `cwd`
- `workspaceRoot`
- `createdAt`
- `startedAt`
- `completedAt`
- `summary`
- `sessionId`
- `claudeSessionId`
- `logFile`
- `resultFile`
- `write`
- `touchedFiles`
- `errorMessage`

Keep a bounded recent job list and prune only companion-owned job/log files.

## Background Jobs

Foreground mode runs Claude and prints the final rendered output.

Background mode:

- Creates a job record before launching work.
- Starts a detached worker process.
- Updates status and phase as work progresses.
- Writes progress to the job log.
- Stores rendered and raw output on completion.
- Supports `status`, `result`, and `cancel`.

`cancel` should terminate the process tree for an active job and mark the job cancelled. It must not delete logs or results.

## Output Protocol

Each command supports human-readable output. Most commands also support `--json`.

Stored result shape:

```json
{
  "status": "completed",
  "kind": "review",
  "summary": "Short result summary",
  "rawOutput": "Claude raw final output",
  "rendered": "Markdown rendered for Codex",
  "reasoningSummary": [],
  "touchedFiles": [],
  "metadata": {}
}
```

Render rules:

- Preserve Claude's important details.
- Keep file paths and line numbers exact.
- For review, lead with findings and risks.
- For planning, preserve architecture, sequencing, risks, and acceptance criteria.
- For rescue, report changed files, commands run, verification, and residual risk.
- If JSON parsing fails, preserve raw output and include a parse error instead of dropping the result.

## Skill Behavior

`claude-plan`:

- Trigger on planning, architecture, design, spec, and execution strategy requests.
- Do not add `--write`.
- Prefer foreground for small planning asks and background for broad repo planning.

`claude-review`:

- Trigger on review, risk review, adversarial review, challenge this approach, and compare implementation choices.
- Do not fix reported issues.
- Use `adversarial-review` when the user asks to challenge assumptions or design direction.

`claude-rescue`:

- Trigger on explicit delegation to Claude for investigation or implementation.
- Use read-only rescue for investigation.
- Add `--write` only for explicit fix/implement/change/apply/continue instructions.
- On follow-up work, ask or infer whether to resume the latest Claude job only when the prior job belongs to the same workspace.

`claude-result-handling`:

- Trigger on checking setup, status, result, cancellation, or resuming prior Claude delegated work.
- Present status compactly and result fully.

## Error Handling

The companion must handle:

- Missing `claude`.
- Claude not authenticated.
- Unsupported Claude version or missing non-interactive mode.
- Not inside a git repo when review requires git.
- Ambiguous job id prefix.
- Background worker crash.
- Cancel on a completed job.
- Missing result for a running job.
- Invalid permission combination, such as write requested for review.
- Prompt missing for commands that require one.

Errors should be actionable and should not imply work was done when it was not.

## Testing

Use Node's built-in test runner.

Test layers:

- `args` tests for command parsing and dangerous flag rejection.
- `git` tests with temporary git fixtures for working-tree, branch, untracked, and empty states.
- `state` tests for workspace hashing, job persistence, pruning, and result lookup.
- `render` tests for plan/review/rescue output.
- `claude` tests using a fake `claude` fixture.
- CLI integration tests for setup, plan, review, rescue, status, result, and cancel.

The fake Claude fixture should simulate:

- Successful JSON output.
- Plain text output.
- Auth status.
- Non-zero failure.
- Slow background job.
- Session id in output.

Manual verification after implementation:

- `node --test tests/*.test.mjs`
- `node scripts/claude-companion.mjs setup`
- A real read-only plan run.
- A real read-only review run in a dirty temporary repo.
- A background run followed by status/result/cancel where applicable.

## Risks

- Claude Code CLI flags may change. Mitigation: centralize all Claude invocation in `lib/claude.mjs` and test with fixtures.
- Read-only mode could be weakened by poor invocation choices. Mitigation: pre-collect review context and do not expose write tools for plan/review.
- Background processes can leave stale jobs. Mitigation: status checks pid liveness and marks stale jobs failed or stale.
- State can leak across workspaces. Mitigation: hash the real workspace path.
- Large diffs can overflow prompt limits. Mitigation: include shortstat and changed-file lists, bound inline diffs and untracked file content, and report truncation.
- Write-capable rescue can surprise users. Mitigation: skills add `--write` only for explicit write intent and companion rejects write modes for plan/review.

## Acceptance Criteria

- The repository contains a valid Codex plugin manifest with skills and no MCP server configuration.
- Codex skills route plan, review, adversarial review, rescue, and result handling through the companion CLI.
- Plan and review cannot modify project files through the companion's intended interfaces.
- Rescue can modify files only when `--write` is explicitly present.
- State and logs are stored outside the project tree by default.
- Background jobs are trackable by `status`, inspectable by `result`, and cancellable by `cancel`.
- Tests cover fake Claude execution, git target resolution, state management, rendering, and dangerous flag rejection.
