# Bridge Storage Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Claude Code Bridge background jobs, logs, and results from growing without bounds while keeping status/result/cancel useful for agent-driven long tasks.

**Architecture:** Add a small storage policy layer under the Claude Code Bridge scripts. All durable writes go through bounded helpers, and background job lifecycle operations trigger safe pruning that never removes active jobs. Expose storage state and cleanup through CLI commands so Codex agents and users can inspect or reclaim space explicitly.

**Tech Stack:** Node.js ESM, built-in `fs`/`path` modules, existing `node:test` tests, Codex plugin skills and README docs.

---

## Design Decisions

1. The bridge remains CLI-only. No MCP server is added.
2. Storage lives outside the reviewed project using the existing state-root priority:
   `CLAUDE_COMPANION_STATE_DIR`, `CODEX_PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA`, OS temp.
3. Defaults must be conservative:
   - `CLAUDE_COMPANION_MAX_JOBS`: `50`
   - `CLAUDE_COMPANION_MAX_STATE_BYTES`: `536870912` bytes, 512 MiB
   - `CLAUDE_COMPANION_MAX_LOG_BYTES`: `5242880` bytes, 5 MiB per job log
   - `CLAUDE_COMPANION_MAX_RESULT_BYTES`: `2097152` bytes, 2 MiB per result JSON
   - `CLAUDE_COMPANION_MAX_RESULT_TEXT_BYTES`: `1048576` bytes, 1 MiB per large text field
   - `CLAUDE_COMPANION_MAX_JOB_AGE_DAYS`: `7`
4. Active jobs are protected from pruning. If a queued/running job is stale, existing reconciliation must first move it to `failed`, then pruning may remove it if old or over quota.
5. Truncation must be explicit. JSON results should include metadata such as `storage.truncated`, `storage.truncatedFields`, and `storage.omittedBytes`.
6. Per-job byte caps are archival caps, not execution caps. They must not kill Claude, truncate the prompt/context sent to Claude, or truncate stdout before Claude JSON has been parsed.
7. This plan does not solve unbounded in-memory stdout/stderr capture during execution. That requires a later streaming-capture design that preserves final JSON parsing while keeping bounded diagnostic output.
8. Result caps must be enforced on the final serialized JSON, not only on individual string fields. If known-field truncation still leaves the result above `maxResultBytes`, write a minimal schema-valid fallback result with status/kind/summary/rendered/rawOutput and storage metadata.
9. Automatic cleanup has two scopes: per-workspace retention (`maxJobs`, `maxJobAgeMs`) and state-root quota (`maxStateBytes`). State-root quota cleanup may remove old terminal artifacts from any workspace under the bridge state root, but never active jobs.
10. CLI failures should be graceful. If storage cannot be kept under quota after pruning, new background jobs fail with a clear error before creating another queued job.

## File Map

- Create `plugins/claude-code-bridge/scripts/lib/storage-policy.mjs`
  - Parse and validate storage-related environment variables.
  - Provide byte caps, retention caps, age caps, and quota values.
- Create `plugins/claude-code-bridge/scripts/lib/storage-prune.mjs`
  - Scan state roots and workspace state dirs.
  - Compute disk usage for job artifacts.
  - Prune terminal job files safely by age, per-workspace count, and state-root quota.
  - Protect active jobs and explicitly selected result jobs from cleanup.
  - Return dry-run and applied cleanup reports.
- Modify `plugins/claude-code-bridge/scripts/lib/state.mjs`
  - Add bounded result writing.
  - Add bounded log append/rotation.
  - Physically prune old files when updating state.
- Keep execution capture unchanged in `plugins/claude-code-bridge/scripts/lib/process.mjs`
  - Do not add pre-parse stdout/stderr truncation in this plan.
  - Do not change prompt, diff context, or Claude invocation size behavior.
- Modify `plugins/claude-code-bridge/scripts/lib/background.mjs`
  - Trigger reconcile then prune in `status`, `result`, `cancel`, job preflight, and job completion paths.
  - Fail job creation gracefully if quota remains exceeded before the queued job is written.
- Modify `plugins/claude-code-bridge/scripts/claude-companion.mjs`
  - Add `cleanup` and `storage` CLI commands.
  - Add help text and JSON output.
- Modify `plugins/claude-code-bridge/scripts/lib/render.mjs`
  - Render storage/truncation warnings in human output.
- Modify `plugins/claude-code-bridge/skills/claude-*/SKILL.md`
  - Tell agents to prefer `--background --json` for long work, avoid requesting unbounded logs, and check `storage --json` or `cleanup --dry-run --json` when jobs pile up.
- Modify `README.md` and `AGENTS.md`
  - Document defaults, env overrides, cleanup commands, and storage safety model.
- Modify `tests/state.test.mjs`
  - Unit-test bounded writes and truncation metadata.
- Create `tests/storage-prune.test.mjs`
  - Unit-test pruning rules, active job protection, dry-run behavior, and quota cleanup.
- Modify `tests/background.test.mjs`
  - Cover background job creation under quota and graceful failure when quota is exhausted.
- Modify `tests/skills.test.mjs`
  - Keep skill docs consistent with CLI command paths and storage commands.

---

## Task 1: Add Storage Policy Parsing

**Files:**
- Create: `plugins/claude-code-bridge/scripts/lib/storage-policy.mjs`
- Test: `tests/state.test.mjs`

- [ ] **Step 1: Write failing tests for default and env policy parsing**

Add tests asserting that missing env values produce the default caps above, valid integer env values override defaults, and invalid values throw a clear error.

Run: `npm test -- tests/state.test.mjs`
Expected: FAIL because `storage-policy.mjs` does not exist.

- [ ] **Step 2: Implement `readStoragePolicy(env)`**

Create `readStoragePolicy(env = process.env)` returning:

```js
{
  maxJobs: 50,
  maxStateBytes: 536870912,
  maxLogBytes: 5242880,
  maxResultBytes: 2097152,
  maxResultTextBytes: 1048576,
  maxJobAgeMs: 7 * 24 * 60 * 60 * 1000
}
```

Validate every override as a positive integer. Error messages must name the invalid environment variable.

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/state.test.mjs`
Expected: PASS.

---

## Task 2: Bound Per-Job Logs and Results

**Files:**
- Modify: `plugins/claude-code-bridge/scripts/lib/state.mjs`
- Modify: `plugins/claude-code-bridge/scripts/lib/render.mjs`
- Do not modify: `plugins/claude-code-bridge/scripts/lib/process.mjs`
- Test: `tests/state.test.mjs`
- Test: `tests/render.test.mjs`

- [ ] **Step 1: Write failing tests for log rotation**

Test `appendJobLog()` with `CLAUDE_COMPANION_MAX_LOG_BYTES=200`. Append several large lines and assert:

- The log file exists.
- The final size is at or below the configured cap, with the truncation marker included inside that cap.
- The newest line remains.
- A marker like `[storage] previous log output truncated` appears.

- [ ] **Step 2: Write failing tests for result truncation**

Call `writeJobResultFile()` with a result containing large `rawOutput`, `text`, and `rendered` fields. Assert:

- Large fields are truncated before disk write.
- Truncation happens after result normalization, not during Claude execution.
- `metadata.storage.truncated === true`.
- `metadata.storage.truncatedFields` includes the changed fields.
- `metadata.storage.omittedBytes` is greater than zero.
- The serialized `.result.json` file is at or below `CLAUDE_COMPANION_MAX_RESULT_BYTES`.

- [ ] **Step 2b: Write failing tests for fallback result capping**

Call `writeJobResultFile()` with a payload whose non-string arrays or objects still exceed `CLAUDE_COMPANION_MAX_RESULT_BYTES` after string-field truncation. Assert:

- The stored JSON remains valid.
- Required result fields remain present: `kind`, `status`, `summary`, `rawOutput`, and `rendered`.
- `metadata.storage.fallback === true`.
- The serialized file is at or below `CLAUDE_COMPANION_MAX_RESULT_BYTES`.

- [ ] **Step 3: Implement bounded helpers**

In `state.mjs`, add these internal helpers:

- `truncateUtf8Tail(value, maxBytes, marker)`: returns a UTF-8-safe tail-preserving string whose byte length is within `maxBytes`.
- `truncateResultPayload(payload, policy)`: clones a normalized result and truncates known large string fields while recording `metadata.storage`.
- `minimalStorageFallbackResult(payload, policy, omittedBytes)`: returns a schema-valid compact result when the full serialized result still exceeds `maxResultBytes`.
- `rotateLogFile(file, policy)`: keeps the newest log bytes and a truncation marker within `maxLogBytes`.

Use tail-preserving truncation for logs and head-plus-tail truncation for result text fields:

```text
<first half>

[storage] output truncated; omitted N bytes

<last half>
```

- [ ] **Step 4: Wire helpers into write paths**

Update:

- `writeJobResultFile(workspaceRoot, jobId, payload, env)`
- `appendJobLog(workspaceRoot, jobId, message, env)`

Both functions must apply `readStoragePolicy(env)`.

`writeJobResultFile()` order:

1. Clone and truncate known large string fields.
2. Serialize and measure byte size.
3. If still over `maxResultBytes`, replace with a minimal schema-valid fallback result.
4. Atomically write the bounded JSON.

Do not apply these caps to:

- Prompt text sent to Claude.
- Review diff/context collected before Claude execution.
- Raw stdout/stderr while `runCommand()` is still waiting for Claude to finish.
- Claude JSON parsing inputs before `runClaudePrint()` extracts the final result.

- [ ] **Step 5: Render truncation warnings**

In `render.mjs`, make human output show a short warning when `metadata.storage.truncated` is true. JSON output remains structured.

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/state.test.mjs tests/render.test.mjs`
Expected: PASS.

---

## Task 3: Prune Old and Excess Terminal Jobs

**Files:**
- Create: `plugins/claude-code-bridge/scripts/lib/storage-prune.mjs`
- Modify: `plugins/claude-code-bridge/scripts/lib/state.mjs`
- Test: `tests/storage-prune.test.mjs`

- [ ] **Step 1: Write failing tests for artifact inventory**

Create temporary state roots with multiple workspace dirs and job artifacts:

- `job-a.json`
- `job-a.result.json`
- `job-a.log`
- `job-b.json`

Assert the inventory reports total bytes and groups artifacts by job id.

- [ ] **Step 2: Write failing tests for active-job protection**

Create one `running` job and one old `completed` job. Run prune. Assert the completed job artifacts are removable and the running job artifacts remain.

- [ ] **Step 3: Write failing tests for max job count**

Create more than `maxJobs` terminal jobs. Assert the oldest terminal job artifacts are selected first.

- [ ] **Step 4: Write failing tests for max age**

Create terminal jobs older than `maxJobAgeMs`. Assert dry-run marks them and applied prune removes them.

- [ ] **Step 5: Write failing tests for quota cleanup**

Set `CLAUDE_COMPANION_MAX_STATE_BYTES` to a small value and create large terminal artifacts. Assert prune removes oldest terminal artifacts until under quota or reports that active jobs prevent full cleanup.

- [ ] **Step 5b: Write failing tests for selected-result protection**

Create an old terminal job that would normally be pruned. Run result selection or prune with that job id in a protected set. Assert its `.json`, `.result.json`, and `.log` files remain until after the read path completes.

- [ ] **Step 6: Implement prune module**

Export these public functions:

- `collectStorageUsage(stateRoot, env = process.env)`: returns state-root, workspace, job-artifact, and byte totals without deleting files.
- `pruneWorkspaceState(workspaceRoot, options = {})`: applies age/count cleanup to one workspace and returns a report.
- `pruneStateRoot(options = {})`: applies global quota cleanup across the state root and returns a report.
- `formatStorageReport(report)`: renders the same report shape for human CLI output.

`options.protectedJobIds` must be supported and applied across workspace and state-root pruning.

Report shape:

```js
{
  stateRoot,
  dryRun,
  beforeBytes,
  afterBytes,
  removedBytes,
  removedFiles,
  protectedActiveJobs,
  protectedSelectedJobs,
  truncated: false,
  warnings: []
}
```

- [ ] **Step 7: Update state index pruning**

Keep `state.json` consistent with physical files. After deleting a terminal job's artifacts, remove that job from the workspace state index.

- [ ] **Step 8: Run tests**

Run: `npm test -- tests/storage-prune.test.mjs tests/state.test.mjs`
Expected: PASS.

---

## Task 4: Integrate Pruning with Background Lifecycle

**Files:**
- Modify: `plugins/claude-code-bridge/scripts/lib/background.mjs`
- Test: `tests/background.test.mjs`

- [ ] **Step 1: Write failing test for create-time quota check**

Set a tiny `CLAUDE_COMPANION_MAX_STATE_BYTES`, create non-prunable active artifacts, then call background job creation. Assert the command fails clearly before creating another queued job file.

- [ ] **Step 2: Write failing test for completion-time cleanup**

Create several old terminal jobs, then complete a new background job. Assert old terminal artifacts are pruned and the latest result remains readable.

- [ ] **Step 3: Add lifecycle hooks**

Call prune in these places:

- Before `createQueuedJob()` writes the new queued job, after reconciling stale active jobs and pruning eligible terminal jobs.
- After `runStoredJob()` writes a terminal result.
- After `cancelJob()` writes a terminal result.
- In `statusSnapshot()` after stale active reconciliation.
- In `readSelectedResult()` after selecting the requested result, with that job id protected from that prune pass.

- [ ] **Step 4: Preserve active-state safety**

Use the existing rule: a worker must not overwrite cancelled, failed, or completed jobs. Pruning must never delete queued/running jobs.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/background.test.mjs tests/storage-prune.test.mjs`
Expected: PASS.

---

## Task 5: Add CLI Commands for Visibility and Manual Cleanup

**Files:**
- Modify: `plugins/claude-code-bridge/scripts/claude-companion.mjs`
- Modify: `plugins/claude-code-bridge/scripts/lib/render.mjs`
- Test: `tests/background.test.mjs`
- Test: `tests/args.test.mjs`

- [ ] **Step 1: Add parser tests**

Assert these commands parse:

```bash
claude-companion storage --json
claude-companion storage --cwd /tmp/project --json
claude-companion storage --all --json
claude-companion cleanup --dry-run --json
claude-companion cleanup --cwd /tmp/project --json
claude-companion cleanup --all --dry-run --json
```

- [ ] **Step 2: Extend command config**

Add:

```js
storage: { booleanOptions: ["all", "json"], valueOptions: ["cwd"] },
cleanup: { booleanOptions: ["all", "dry-run", "json"], valueOptions: ["cwd"] }
```

- [ ] **Step 3: Implement handlers**

`storage` reports usage without deleting files. `cleanup` runs prune. Both support `--cwd` so agents can inspect the target workspace state.

Command scope rules:

- Default: current workspace retention plus state-root quota summary.
- `--cwd <workspace>`: selected workspace retention plus state-root quota summary.
- `--all`: all workspace dirs under the state root for age/count cleanup plus state-root quota cleanup.

- [ ] **Step 4: Update usage text**

Add:

```text
claude-companion storage [--cwd <workspace>] [--all] [--json]
claude-companion cleanup [--cwd <workspace>] [--all] [--dry-run] [--json]
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/args.test.mjs tests/background.test.mjs`
Expected: PASS.

---

## Task 6: Document Agent Behavior and User Controls

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `plugins/claude-code-bridge/skills/claude-plan/SKILL.md`
- Modify: `plugins/claude-code-bridge/skills/claude-review/SKILL.md`
- Modify: `plugins/claude-code-bridge/skills/claude-rescue/SKILL.md`
- Modify: `plugins/claude-code-bridge/skills/claude-result-handling/SKILL.md`
- Test: `tests/skills.test.mjs`

- [ ] **Step 1: Update README storage section**

Document:

- State root priority.
- Default caps.
- Env overrides.
- `storage` and `cleanup` commands.
- `cleanup --dry-run --json` before broad `cleanup --all`.
- Truncation behavior.
- Active job protection.
- Explicit result-read protection.
- What users can delete manually if they want a full reset.

- [ ] **Step 2: Update skill instructions**

Every skill must continue to use:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/claude-companion.mjs"
```

Add instructions:

- Agents should use `--background --json` for long-running work.
- Agents should poll `status --json`.
- Agents should call `result --json` for terminal jobs.
- Agents should call `storage --json` or `cleanup --dry-run --json` when many jobs exist or storage warnings appear.
- Agents should not run `cleanup --all` without first using `cleanup --all --dry-run --json`.
- Agents must not request unbounded raw logs.

- [ ] **Step 3: Update AGENTS.md**

Add storage rules:

- Keep job state outside reviewed projects.
- Preserve active jobs during cleanup.
- Preserve explicitly selected result jobs while reading results.
- Keep truncation metadata visible.
- Update tests when changing storage defaults or CLI command behavior.

- [ ] **Step 4: Update docs tests**

Update `tests/skills.test.mjs` so docs stay consistent for:

- `--background`
- `--wait`
- `--cwd`
- `status`
- `result`
- `cancel`
- `storage`
- `cleanup`
- `cleanup --all --dry-run`

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/skills.test.mjs`
Expected: PASS.

---

## Task 7: Full Verification

**Files:**
- No additional source files.

- [ ] **Step 1: Run repository test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Run manifest check**

Run: `npm run check:manifest`
Expected: pass.

- [ ] **Step 3: Run whitespace check**

Run: `git diff --check`
Expected: no output.

- [ ] **Step 4: Inspect working tree**

Run: `git status --short`
Expected: only intentional files changed.

- [ ] **Step 5: Optional CLI smoke test with fake Claude**

Run:

```bash
CLAUDE_COMPANION_CLAUDE_BIN=tests/fake-claude-fixture.mjs \
CLAUDE_COMPANION_STATE_DIR="$(mktemp -d)" \
node plugins/claude-code-bridge/scripts/claude-companion.mjs plan --background --json "storage smoke"
```

Then run `status --json`, `result --json`, `storage --json`, and `cleanup --dry-run --json` against the same state directory.

Expected: job completes, result is readable, storage reports usage, dry-run cleanup reports without deleting active jobs.

---

## Acceptance Criteria

- Background jobs cannot create unbounded result or log files.
- The latest useful result remains readable after pruning.
- Explicit `result <job-id>` reads protect the selected result from that prune pass.
- Old terminal jobs are physically removed, not just hidden from `state.json`.
- Active jobs are never deleted by cleanup.
- Broad cleanup is previewable with `cleanup --all --dry-run --json`.
- Storage warnings are visible in human and JSON result paths.
- Agents have documented commands to inspect and clean storage.
- Users can tune caps through environment variables.
- The plugin remains CLI-only and does not add MCP.
- Verification commands from `AGENTS.md` pass.

## Rollback Plan

If storage pruning causes an issue:

1. Disable automatic cleanup by setting very high caps:
   `CLAUDE_COMPANION_MAX_STATE_BYTES`, `CLAUDE_COMPANION_MAX_JOBS`, and `CLAUDE_COMPANION_MAX_JOB_AGE_DAYS`.
2. Keep bounded result/log writing enabled because it protects disk usage and only affects stored output size.
3. Revert the CLI `cleanup` integration separately if needed; it should be isolated behind `storage-prune.mjs` and lifecycle calls.

## Self-Review

- Spec coverage: The plan covers state storage, log/result caps, stale job reconciliation interaction, quota cleanup, CLI visibility, docs, tests, and verification.
- Placeholder scan: No task depends on an undefined future component; every new module and command is named with expected behavior.
- Type consistency: Storage metadata is consistently represented under `metadata.storage`, and CLI commands consistently use `storage` and `cleanup`.
