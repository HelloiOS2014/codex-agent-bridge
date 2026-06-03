import test from "node:test";
import assert from "node:assert/strict";
import { createJobRecord, completeJobRecord, startJobRecord, summarizeStatus } from "../plugins/agent-bridge/scripts/lib/jobs.mjs";
import { makeTempDir } from "./helpers.mjs";
import { readJobFile, resolveJobLogFile, resolveJobResultFile, writeJobFile } from "../plugins/agent-bridge/scripts/lib/state.mjs";

test("createJobRecord creates the required job shape with command args and paths", () => {
  const stateRoot = makeTempDir("job-state-");
  const workspaceRoot = makeTempDir("job-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateRoot };
  const args = ["--print", "review this"];
  const job = createJobRecord({
    kind: "plan",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "claude",
    args,
    write: false,
    summary: "queued",
    env
  });
  const expectedLogPath = resolveJobLogFile(workspaceRoot, job.id, env);
  const expectedResultPath = resolveJobResultFile(workspaceRoot, job.id, env);

  assert.match(job.id, /^plan-/);
  assert.match(job.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual({
    id: job.id,
    kind: job.kind,
    status: job.status,
    cwd: job.cwd,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    pid: job.pid,
    command: job.command,
    args: job.args,
    logPath: job.logPath,
    resultPath: job.resultPath,
    error: job.error,
    phase: job.phase,
    workspaceRoot: job.workspaceRoot,
    summary: job.summary,
    sessionId: job.sessionId,
    claudeSessionId: job.claudeSessionId,
    write: job.write,
    touchedFiles: job.touchedFiles
  }, {
    id: job.id,
    kind: "plan",
    status: "queued",
    cwd: workspaceRoot,
    createdAt: job.createdAt,
    startedAt: null,
    endedAt: null,
    pid: null,
    command: "claude",
    args,
    logPath: expectedLogPath,
    resultPath: expectedResultPath,
    error: null,
    phase: "queued",
    workspaceRoot,
    summary: "queued",
    sessionId: null,
    claudeSessionId: null,
    write: false,
    touchedFiles: []
  });
  assert.equal(job.logPath.endsWith(`${job.id}.log`), true);
  assert.equal(job.resultPath.endsWith(`${job.id}.result.json`), true);
  assert.equal(Object.hasOwn(job, "completedAt"), false);
  assert.equal(Object.hasOwn(job, "logFile"), false);
  assert.equal(Object.hasOwn(job, "resultFile"), false);
  assert.equal(Object.hasOwn(job, "errorMessage"), false);
});

test("createJobRecord leaves paths null without a workspace root", () => {
  const job = createJobRecord({ kind: "review", cwd: "/tmp/repo", command: "claude", args: [] });

  assert.equal(job.logPath, null);
  assert.equal(job.resultPath, null);
});

test("createJobRecord validates job kind before creating an id", () => {
  for (const kind of ["plan", "review", "adversarial-review", "rescue"]) {
    assert.equal(createJobRecord({ kind, cwd: "/tmp/repo", command: "claude", args: [] }).kind, kind);
  }

  for (const kind of ["", "status", "../plan", "plan/review", "review\\plan"]) {
    assert.throws(
      () => createJobRecord({ kind, cwd: "/tmp/repo", command: "claude", args: [] }),
      /Invalid job kind/
    );
  }
});

test("completeJobRecord stores result and updates endedAt and error", () => {
  const job = startJobRecord(createJobRecord({
    kind: "review",
    cwd: "/tmp/repo",
    workspaceRoot: "/tmp/repo",
    command: "claude",
    args: ["--print"]
  }), 12345);
  const done = completeJobRecord(job, { status: "failed", summary: "failed", rendered: "bad", error: "Claude exited 1" });

  assert.equal(done.status, "failed");
  assert.equal(done.phase, "failed");
  assert.equal(done.pid, null);
  assert.match(done.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(done.endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(done.error, "Claude exited 1");
  assert.equal(done.result.rendered, "bad");
});

test("job records round trip through state storage", () => {
  const stateRoot = makeTempDir("job-state-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateRoot };
  const workspaceRoot = makeTempDir("job-workspace-");
  const job = completeJobRecord(createJobRecord({
    kind: "rescue",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "claude",
    args: ["--print", "fix"],
    write: true,
    env
  }), { status: "completed", summary: "done", rendered: "ok" });

  writeJobFile(workspaceRoot, job.id, job, env);

  assert.deepEqual(readJobFile(workspaceRoot, job.id, env), job);
});

test("summarizeStatus includes running and latest finished jobs", () => {
  const queued = { id: "queued", kind: "plan", status: "queued", createdAt: "2026-06-02T01:00:00.000Z" };
  const running = { id: "running", kind: "review", status: "running", createdAt: "2026-06-02T02:00:00.000Z" };
  const failed = { id: "failed", kind: "review", status: "failed", createdAt: "2026-06-02T03:00:00.000Z" };
  const completed = { id: "completed", kind: "plan", status: "completed", createdAt: "2026-06-02T04:00:00.000Z" };
  const summary = summarizeStatus([failed, queued, completed, running]);

  assert.deepEqual(summary.running.map((job) => job.id), ["running", "queued"]);
  assert.equal(summary.latestFinished.id, "completed");
  assert.deepEqual(summary.recent.map((job) => job.id), ["failed", "running", "queued"]);
});

test("summarizeStatus orders finished jobs by endedAt before createdAt", () => {
  const earlyFinished = {
    id: "early-finished",
    kind: "review",
    status: "failed",
    createdAt: "2026-06-02T05:00:00.000Z",
    endedAt: "2026-06-02T05:01:00.000Z"
  };
  const lateFinished = {
    id: "late-finished",
    kind: "plan",
    status: "completed",
    createdAt: "2026-06-02T04:00:00.000Z",
    endedAt: "2026-06-02T05:02:00.000Z"
  };
  const queued = {
    id: "queued-after-finish",
    kind: "plan",
    status: "queued",
    createdAt: "2026-06-02T05:03:00.000Z",
    endedAt: null
  };
  const summary = summarizeStatus([earlyFinished, lateFinished, queued]);

  assert.equal(summary.latestFinished.id, "late-finished");
  assert.deepEqual(summary.recent.map((job) => job.id), ["queued-after-finish", "early-finished"]);
});
