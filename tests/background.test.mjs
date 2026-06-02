import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createJobRecord } from "../scripts/lib/jobs.mjs";
import {
  readJobFile,
  resolveStateDir,
  writeJobFile
} from "../scripts/lib/state.mjs";
import { makeTempDir, repoRoot, runCli } from "./helpers.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractJob(snapshot, jobId) {
  const jobs = [
    ...(snapshot.running ?? []),
    snapshot.latestFinished,
    ...(snapshot.recent ?? []),
    snapshot.job
  ].filter(Boolean);
  return jobs.find((job) => job.id === jobId) ?? null;
}

async function waitForJobStatus(jobId, expectedStatuses, options = {}) {
  const expected = new Set(Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses]);
  let lastResult = null;
  for (let index = 0; index < (options.attempts ?? 60); index += 1) {
    lastResult = await runCli(["status", jobId, "--json"], options);
    if (lastResult.status === 0) {
      const snapshot = JSON.parse(lastResult.stdout);
      const job = extractJob(snapshot, jobId);
      if (job && expected.has(job.status)) {
        return job;
      }
    }
    await sleep(options.intervalMs ?? 100);
  }
  throw new Error(`Timed out waiting for ${jobId}; last output: ${lastResult?.stdout || lastResult?.stderr}`);
}

function persistManualJob(workspaceRoot, job, env) {
  const stateDir = resolveStateDir(workspaceRoot, env);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "state.json"), `${JSON.stringify({ version: 1, jobs: [job] }, null, 2)}\n`, "utf8");
  writeJobFile(workspaceRoot, job.id, job, env);
}

test("background plan creates a running job and result can be read in human and json modes", async () => {
  const stateDir = makeTempDir("background-state-");
  const launch = await runCli(["plan", "--background", "--json", "background", "plan"], { stateDir });

  assert.equal(launch.status, 0);
  assert.equal(launch.stderr, "");
  const started = JSON.parse(launch.stdout);
  assert.equal(started.status, "running");
  assert.match(started.job.id, /^plan-[a-z0-9-]+/);
  assert.equal(started.job.cwd, repoRoot);
  assert.equal(started.job.command, "plan");
  assert.deepEqual(started.job.args, ["background", "plan"]);
  assert.match(started.job.logPath, new RegExp(`${started.job.id}\\.log$`));
  assert.match(started.job.resultPath, new RegExp(`${started.job.id}\\.result\\.json$`));
  assert.match(started.job.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(started.job.endedAt, null);
  assert.ok(Number.isInteger(started.job.pid));

  const completed = await waitForJobStatus(started.job.id, "completed", { stateDir });
  assert.equal(completed.status, "completed");
  assert.equal(completed.pid, null);
  assert.match(completed.endedAt, /^\d{4}-\d{2}-\d{2}T/);

  const result = await runCli(["result", started.job.id], { stateDir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Claude Plan/);
  assert.match(result.stdout, /background plan/);

  const jsonResult = await runCli(["result", started.job.id, "--json"], { stateDir });
  assert.equal(jsonResult.status, 0);
  const payload = JSON.parse(jsonResult.stdout);
  assert.equal(payload.kind, "plan");
  assert.equal(payload.status, "completed");
  assert.match(payload.rendered, /Claude Plan/);
});

test("--wait runs through the job path, returns the final result, and records latest result", async () => {
  const stateDir = makeTempDir("background-wait-state-");
  const waited = await runCli(["rescue", "--wait", "waited", "rescue"], { stateDir });

  assert.equal(waited.status, 0);
  assert.equal(waited.stderr, "");
  assert.match(waited.stdout, /Claude Rescue/);
  assert.match(waited.stdout, /waited rescue/);

  const status = await runCli(["status", "--json"], { stateDir });
  assert.equal(status.status, 0);
  const snapshot = JSON.parse(status.stdout);
  assert.equal(snapshot.latestFinished.kind, "rescue");
  assert.equal(snapshot.latestFinished.status, "completed");

  const latest = await runCli(["result"], { stateDir });
  assert.equal(latest.status, 0);
  assert.match(latest.stdout, /Claude Rescue/);
  assert.match(latest.stdout, /waited rescue/);
});

test("result defaults to latest finished job and explicit ids read older finished jobs", async () => {
  const stateDir = makeTempDir("background-latest-state-");
  const firstLaunch = await runCli(["plan", "--background", "first", "plan"], { stateDir });
  const firstId = firstLaunch.stdout.match(/(plan-[a-z0-9-]+)/)?.[1];
  assert.ok(firstId);
  await waitForJobStatus(firstId, "completed", { stateDir });

  await sleep(10);
  const secondLaunch = await runCli(["plan", "--background", "second", "plan"], { stateDir });
  const secondId = secondLaunch.stdout.match(/(plan-[a-z0-9-]+)/)?.[1];
  assert.ok(secondId);
  await waitForJobStatus(secondId, "completed", { stateDir });

  const explicit = await runCli(["result", firstId], { stateDir });
  assert.equal(explicit.status, 0);
  assert.match(explicit.stdout, /first plan/);

  const latest = await runCli(["result"], { stateDir });
  assert.equal(latest.status, 0);
  assert.match(latest.stdout, /second plan/);
});

test("run-job executes a stored job and exits nonzero when stored work fails", async () => {
  const stateDir = makeTempDir("background-run-job-state-");
  const workspaceRoot = makeTempDir("background-run-job-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const job = createJobRecord({
    kind: "plan",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "plan",
    args: ["manual", "run"],
    env
  });
  persistManualJob(workspaceRoot, job, env);

  const run = await runCli(["run-job", job.id], { cwd: workspaceRoot, stateDir });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "");
  const stored = readJobFile(workspaceRoot, job.id, env);
  assert.equal(stored.status, "completed");
  assert.match(stored.result.rendered, /manual run/);
  assert.ok(fs.existsSync(stored.resultPath));

  const failingJob = createJobRecord({
    kind: "plan",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "plan",
    args: ["manual", "failure"],
    env
  });
  persistManualJob(workspaceRoot, failingJob, env);

  const failed = await runCli(["run-job", failingJob.id], {
    cwd: workspaceRoot,
    stateDir,
    env: { FAKE_CLAUDE_FAIL: "1" }
  });
  assert.equal(failed.status, 1);
  const storedFailure = readJobFile(workspaceRoot, failingJob.id, env);
  assert.equal(storedFailure.status, "failed");
  assert.match(storedFailure.result.rendered, /fake claude failure/);
});

test("status supports explicit, all, and json modes", async () => {
  const stateDir = makeTempDir("background-status-state-");
  const launch = await runCli(["plan", "--background", "status", "plan"], { stateDir });
  const jobId = launch.stdout.match(/(plan-[a-z0-9-]+)/)?.[1];
  assert.ok(jobId);
  await waitForJobStatus(jobId, "completed", { stateDir });

  const explicit = await runCli(["status", jobId], { stateDir });
  assert.equal(explicit.status, 0);
  assert.match(explicit.stdout, new RegExp(jobId));
  assert.match(explicit.stdout, /completed/);

  const all = await runCli(["status", "--all", "--json"], { stateDir });
  assert.equal(all.status, 0);
  const snapshot = JSON.parse(all.stdout);
  assert.ok(extractJob(snapshot, jobId));
});

test("cancel reports missing jobs, rejects invalid ids, and cancels running jobs safely", async () => {
  const missing = await runCli(["cancel", "job-missing"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No job found/);

  const missingJson = await runCli(["cancel", "job-missing", "--json"]);
  assert.equal(missingJson.status, 1);
  assert.equal(missingJson.stderr, "");
  assert.match(JSON.parse(missingJson.stdout).error, /No job found/);

  const invalid = await runCli(["status", "../escape"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid job id/);

  const stateDir = makeTempDir("background-cancel-state-");
  const launch = await runCli(["rescue", "--background", "--json", "cancel", "slow"], {
    stateDir,
    env: { FAKE_CLAUDE_SLEEP_MS: "10000" }
  });
  assert.equal(launch.status, 0);
  const jobId = JSON.parse(launch.stdout).job.id;

  const cancel = await runCli(["cancel", jobId, "--json"], { stateDir });
  assert.equal(cancel.status, 0);
  const cancelled = JSON.parse(cancel.stdout);
  assert.equal(cancelled.job.status, "cancelled");
  assert.equal(cancelled.job.pid, null);

  const result = await runCli(["result", jobId, "--json"], { stateDir });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, "cancelled");
});

test("--wait propagates failed and cancelled foreground-like results", async () => {
  const failed = await runCli(["plan", "--wait", "will", "fail"], {
    stateDir: makeTempDir("background-wait-fail-state-"),
    env: { FAKE_CLAUDE_FAIL: "1" }
  });

  assert.equal(failed.status, 1);
  assert.equal(failed.stderr, "");
  assert.match(failed.stdout, /Status: failed/);
  assert.match(failed.stdout, /fake claude failure/);

  const cancelled = await runCli(["rescue", "--wait", "--timeout-ms", "50", "slow"], {
    stateDir: makeTempDir("background-wait-cancel-state-"),
    env: { FAKE_CLAUDE_SLEEP_MS: "1000" }
  });
  assert.equal(cancelled.status, 1);
  assert.match(cancelled.stdout, /Status: cancelled/);
});

test("json error handling stays valid for background command parse errors", async () => {
  const result = await runCli(["plan", "--background", "--wait", "--json", "bad"]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "plan");
  assert.equal(payload.status, "failed");
  assert.match(payload.error, /mutually exclusive/);
});
