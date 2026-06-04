import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
} from "../plugins/antigravity-bridge/scripts/lib/state.mjs";
import { pruneWorkspaceState } from "../plugins/antigravity-bridge/scripts/lib/storage-prune.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function terminalJob(id, daysAgo = 10) {
  return {
    id,
    kind: "plan",
    status: "completed",
    cwd: "/tmp/antigravity-workspace",
    workspaceRoot: "/tmp/antigravity-workspace",
    createdAt: isoDaysAgo(daysAgo),
    startedAt: isoDaysAgo(daysAgo),
    endedAt: isoDaysAgo(daysAgo),
    pid: null,
    command: "plan",
    args: [],
    phase: "completed",
    logPath: null,
    resultPath: null,
    summary: `${id} completed`,
    error: null
  };
}

function persistJob(workspaceRoot, job, env) {
  const stored = {
    ...job,
    workspaceRoot,
    cwd: workspaceRoot,
    logPath: resolveJobLogFile(workspaceRoot, job.id, env),
    resultPath: resolveJobResultFile(workspaceRoot, job.id, env)
  };
  writeJobFile(workspaceRoot, stored.id, stored, env);
  writeJobResultFile(workspaceRoot, stored.id, {
    kind: stored.kind,
    status: stored.status,
    summary: stored.summary,
    rawOutput: "raw",
    rendered: "rendered",
    metadata: { jobId: stored.id }
  }, env);
  appendJobLog(workspaceRoot, stored.id, `log ${stored.id}`, env);
  const state = readState(workspaceRoot, env);
  writeState(workspaceRoot, { jobs: [stored, ...state.jobs.filter((entry) => entry.id !== stored.id)] }, env);
  return stored;
}

test("Antigravity cleanup rethrows artifact deletion errors other than ENOENT", (t) => {
  const stateRoot = makeTempDir("antigravity-prune-state-");
  const workspaceRoot = makeTempDir("antigravity-prune-workspace-");
  const env = {
    ANTIGRAVITY_COMPANION_STATE_DIR: stateRoot,
    ANTIGRAVITY_COMPANION_MAX_JOB_AGE_DAYS: "1"
  };
  const job = persistJob(workspaceRoot, terminalJob("blocked-delete"), env);
  const originalUnlink = fs.unlinkSync;
  t.after(() => {
    fs.unlinkSync = originalUnlink;
  });
  fs.unlinkSync = (file) => {
    const error = new Error(`permission denied deleting ${file}`);
    error.code = "EACCES";
    throw error;
  };

  assert.throws(
    () => pruneWorkspaceState(workspaceRoot, { env }),
    /permission denied deleting/
  );
  assert.equal(fs.existsSync(resolveJobFile(workspaceRoot, job.id, env)), true);
});

test("Antigravity cleanup ignores ENOENT from concurrent artifact removal", (t) => {
  const stateRoot = makeTempDir("antigravity-prune-state-");
  const workspaceRoot = makeTempDir("antigravity-prune-workspace-");
  const env = {
    ANTIGRAVITY_COMPANION_STATE_DIR: stateRoot,
    ANTIGRAVITY_COMPANION_MAX_JOB_AGE_DAYS: "1"
  };
  const job = persistJob(workspaceRoot, terminalJob("concurrent-delete"), env);
  const originalUnlink = fs.unlinkSync;
  t.after(() => {
    fs.unlinkSync = originalUnlink;
  });
  fs.unlinkSync = () => {
    const error = new Error("already removed");
    error.code = "ENOENT";
    throw error;
  };

  const report = pruneWorkspaceState(workspaceRoot, { env });

  assert.equal(report.removedFiles.some((file) => file.endsWith("concurrent-delete.json")), true);
  assert.equal(readState(workspaceRoot, env).jobs.some((entry) => entry.id === job.id), false);
});

