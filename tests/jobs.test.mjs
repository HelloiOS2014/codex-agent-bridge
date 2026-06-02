import test from "node:test";
import assert from "node:assert/strict";
import { createJobRecord, completeJobRecord, summarizeStatus } from "../scripts/lib/jobs.mjs";

test("createJobRecord creates a running job shape", () => {
  const job = createJobRecord({ kind: "plan", cwd: "/tmp/repo", workspaceRoot: "/tmp/repo", write: false });
  assert.match(job.id, /^plan-/);
  assert.equal(job.status, "queued");
  assert.equal(job.write, false);
});

test("completeJobRecord stores result and clears pid", () => {
  const job = createJobRecord({ kind: "review", cwd: "/tmp/repo", workspaceRoot: "/tmp/repo", write: false });
  const done = completeJobRecord(job, { status: "completed", summary: "done", rendered: "ok" });
  assert.equal(done.status, "completed");
  assert.equal(done.pid, null);
  assert.equal(done.result.rendered, "ok");
});

test("summarizeStatus includes running and latest finished jobs", () => {
  const running = createJobRecord({ kind: "plan", cwd: "/tmp/repo", workspaceRoot: "/tmp/repo", write: false });
  running.status = "running";
  const finished = completeJobRecord(
    createJobRecord({ kind: "review", cwd: "/tmp/repo", workspaceRoot: "/tmp/repo", write: false }),
    { status: "completed", summary: "review done", rendered: "ok" }
  );
  const summary = summarizeStatus([finished, running]);
  assert.equal(summary.running.length, 1);
  assert.equal(summary.latestFinished.id, finished.id);
});
