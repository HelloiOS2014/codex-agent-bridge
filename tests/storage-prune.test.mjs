import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.mjs";
import {
  appendJobLog,
  readState,
  resolveJobFile,
  resolveJobLogFile,
  resolveJobResultFile,
  writeJobFile,
  writeJobResultFile,
  writeState
} from "../plugins/claude-code-bridge/scripts/lib/state.mjs";
import {
  collectStorageUsage,
  pruneStateRoot,
  pruneWorkspaceState
} from "../plugins/claude-code-bridge/scripts/lib/storage-prune.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function jobRecord(id, status, daysAgo = 1, extra = {}) {
  const terminal = status !== "queued" && status !== "running";
  return {
    id,
    kind: "plan",
    status,
    cwd: extra.workspaceRoot ?? "/tmp/workspace-a",
    workspaceRoot: extra.workspaceRoot ?? "/tmp/workspace-a",
    createdAt: isoDaysAgo(daysAgo),
    startedAt: terminal ? isoDaysAgo(daysAgo) : null,
    endedAt: terminal ? isoDaysAgo(daysAgo) : null,
    pid: terminal ? null : 999999,
    command: "plan",
    args: [],
    phase: status,
    logPath: null,
    resultPath: null,
    summary: `${id} ${status}`,
    error: null,
    ...extra
  };
}

function persistJob(workspaceRoot, job, env, options = {}) {
  const stored = {
    ...job,
    workspaceRoot,
    cwd: workspaceRoot,
    logPath: resolveJobLogFile(workspaceRoot, job.id, env),
    resultPath: resolveJobResultFile(workspaceRoot, job.id, env)
  };
  writeJobFile(workspaceRoot, stored.id, stored, env);
  if (stored.status !== "queued" && stored.status !== "running") {
    writeJobResultFile(workspaceRoot, stored.id, {
      kind: stored.kind,
      status: stored.status,
      summary: stored.summary,
      rawOutput: options.rawOutput ?? "raw",
      rendered: options.rendered ?? "rendered",
      metadata: { jobId: stored.id }
    }, env);
  }
  appendJobLog(workspaceRoot, stored.id, options.log ?? `log ${stored.id}`, env);
  const state = readState(workspaceRoot, env);
  writeState(workspaceRoot, { jobs: [stored, ...state.jobs.filter((entry) => entry.id !== stored.id)] }, env);
  return stored;
}

test("collectStorageUsage groups job artifacts and byte totals by state root", () => {
  const stateRoot = makeTempDir("storage-root-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateRoot };
  const workspaceRoot = makeTempDir("storage-workspace-");
  persistJob(workspaceRoot, jobRecord("job-a", "completed"), env, { log: "hello" });
  persistJob(workspaceRoot, jobRecord("job-b", "running"), env, { log: "running" });

  const report = collectStorageUsage(stateRoot, env);
  const workspace = report.workspaces.find((entry) => entry.workspaceRoot === workspaceRoot);

  assert.equal(report.stateRoot, stateRoot);
  assert.ok(report.totalBytes > 0);
  assert.ok(workspace);
  assert.equal(workspace.jobs.some((job) => job.id === "job-a" && job.bytes > 0), true);
  assert.equal(workspace.jobs.some((job) => job.id === "job-b" && job.active === true), true);
});

test("pruneWorkspaceState deletes old terminal jobs while preserving active jobs", () => {
  const stateRoot = makeTempDir("storage-root-");
  const workspaceRoot = makeTempDir("storage-workspace-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: stateRoot,
    CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "7"
  };
  const oldDone = persistJob(workspaceRoot, jobRecord("old-done", "completed", 20), env);
  const oldRunning = persistJob(workspaceRoot, jobRecord("old-running", "running", 20), env);

  const report = pruneWorkspaceState(workspaceRoot, { env });

  assert.equal(report.removedFiles.some((file) => file.endsWith("old-done.json")), true);
  assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, oldDone.id, env)), false);
  assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, oldRunning.id, env)), true);
  assert.equal(readState(workspaceRoot, env).jobs.some((job) => job.id === oldDone.id), false);
});

test("pruneWorkspaceState enforces maxJobs for terminal jobs by removing the oldest first", () => {
  const stateRoot = makeTempDir("storage-root-");
  const workspaceRoot = makeTempDir("storage-workspace-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: stateRoot,
    CLAUDE_COMPANION_MAX_JOBS: "2",
    CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "365"
  };
  persistJob(workspaceRoot, jobRecord("oldest", "completed", 5), env);
  persistJob(workspaceRoot, jobRecord("middle", "completed", 3), env);
  persistJob(workspaceRoot, jobRecord("newest", "completed", 1), env);

  pruneWorkspaceState(workspaceRoot, { env });

  assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, "oldest", env)), false);
  assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, "middle", env)), true);
  assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, "newest", env)), true);
});

test("pruneWorkspaceState dry-run reports old jobs without deleting them", () => {
  const stateRoot = makeTempDir("storage-root-");
  const workspaceRoot = makeTempDir("storage-workspace-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: stateRoot,
    CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "1"
  };
  persistJob(workspaceRoot, jobRecord("old-dry-run", "completed", 10), env);

  const report = pruneWorkspaceState(workspaceRoot, { env, dryRun: true });

  assert.equal(report.dryRun, true);
  assert.equal(report.removedFiles.some((file) => file.endsWith("old-dry-run.json")), true);
  assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, "old-dry-run", env)), true);
});

test("pruneStateRoot applies global quota cleanup across workspaces", () => {
  const stateRoot = makeTempDir("storage-root-");
  const left = makeTempDir("storage-workspace-left-");
  const right = makeTempDir("storage-workspace-right-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: stateRoot,
    CLAUDE_COMPANION_MAX_STATE_BYTES: "4500",
    CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "365",
    CLAUDE_COMPANION_MAX_LOG_BYTES: "2000",
    CLAUDE_COMPANION_MAX_RESULT_BYTES: "2000"
  };
  persistJob(left, jobRecord("old-left", "completed", 30), env, {
    rawOutput: "left ".repeat(250),
    rendered: "left ".repeat(250),
    log: "left ".repeat(250)
  });
  persistJob(right, jobRecord("new-right", "completed", 1), env, {
    rawOutput: "right ".repeat(250),
    rendered: "right ".repeat(250),
    log: "right ".repeat(250)
  });

  const report = pruneStateRoot({ stateRoot, env });

  assert.ok(report.beforeBytes > report.afterBytes);
  assert.ok(report.afterBytes <= 4500);
  assert.equal(fs.existsSync(resolveJobFile(left, "old-left", env)), false);
  assert.equal(fs.existsSync(resolveJobFile(right, "new-right", env)), true);
});

test("protected job ids are not pruned while a selected result is being read", () => {
  const stateRoot = makeTempDir("storage-root-");
  const workspaceRoot = makeTempDir("storage-workspace-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: stateRoot,
    CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "1"
  };
  persistJob(workspaceRoot, jobRecord("protected-old", "completed", 10), env);

  const report = pruneWorkspaceState(workspaceRoot, {
    env,
    protectedJobIds: new Set(["protected-old"])
  });

  assert.equal(report.protectedSelectedJobs.includes("protected-old"), true);
  assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, "protected-old", env)), true);
  assert.equal(fs.existsSync(resolveJobResultFile(workspaceRoot, "protected-old", env)), true);
  assert.equal(fs.existsSync(resolveJobLogFile(workspaceRoot, "protected-old", env)), true);
});
