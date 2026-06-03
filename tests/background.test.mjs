import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { completeJobRecord, createJobRecord, startJobRecord } from "../plugins/claude-code-bridge/scripts/lib/jobs.mjs";
import { runStoredJob, spawnBackgroundJob } from "../plugins/claude-code-bridge/scripts/lib/background.mjs";
import {
  appendJobLog,
  listJobFileIds,
  readJobFile,
  readJobResultFile,
  resolveJobFile,
  resolveStateDir,
  writeJobFile,
  writeJobResultFile
} from "../plugins/claude-code-bridge/scripts/lib/state.mjs";
import { cliPath, makeTempDir, repoRoot, runCli } from "./helpers.mjs";

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

async function waitForJobWhere(jobId, predicate, options = {}) {
  let lastResult = null;
  for (let index = 0; index < (options.attempts ?? 60); index += 1) {
    lastResult = await runCli(["status", jobId, "--json"], options);
    if (lastResult.status === 0) {
      const snapshot = JSON.parse(lastResult.stdout);
      const job = extractJob(snapshot, jobId);
      if (job && predicate(job)) {
        return job;
      }
    }
    await sleep(options.intervalMs ?? 100);
  }
  throw new Error(`Timed out waiting for ${jobId}; last output: ${lastResult?.stdout || lastResult?.stderr}`);
}

function pidIsLive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForPidExit(pid, options = {}) {
  for (let index = 0; index < (options.attempts ?? 40); index += 1) {
    if (!pidIsLive(pid)) {
      return true;
    }
    await sleep(options.intervalMs ?? 50);
  }
  return false;
}

function persistManualJob(workspaceRoot, job, env) {
  const stateDir = resolveStateDir(workspaceRoot, env);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "state.json"), `${JSON.stringify({ version: 1, jobs: [job] }, null, 2)}\n`, "utf8");
  writeJobFile(workspaceRoot, job.id, job, env);
}

function persistJobFileWithoutStateEntry(workspaceRoot, job, env) {
  const stateDir = resolveStateDir(workspaceRoot, env);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "state.json"), `${JSON.stringify({ version: 1, jobs: [] }, null, 2)}\n`, "utf8");
  writeJobFile(workspaceRoot, job.id, job, env);
}

async function makeDeadPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  assert.ok(Number.isInteger(pid) && pid > 1);
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return pid;
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

test("--wait --cwd jobs can be managed with status result and cancel --cwd", async () => {
  const stateDir = makeTempDir("background-wait-cwd-state-");
  const workspaceRoot = makeTempDir("background-wait-cwd-workspace-");
  const waited = await runCli(["plan", "--wait", "--json", "--cwd", workspaceRoot, "wait", "cwd"], {
    stateDir
  });

  assert.equal(waited.status, 0);
  assert.equal(waited.stderr, "");
  const waitedResult = JSON.parse(waited.stdout);
  assert.equal(waitedResult.status, "completed");
  assert.match(waitedResult.rendered, /wait cwd/);

  const status = await runCli(["status", "--cwd", workspaceRoot, "--json"], { stateDir });
  assert.equal(status.status, 0);
  const snapshot = JSON.parse(status.stdout);
  assert.equal(snapshot.latestFinished.status, "completed");
  assert.equal(snapshot.latestFinished.cwd, workspaceRoot);

  const result = await runCli(["result", snapshot.latestFinished.id, "--cwd", workspaceRoot, "--json"], { stateDir });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, "completed");

  const cancel = await runCli(["cancel", snapshot.latestFinished.id, "--cwd", workspaceRoot, "--json"], { stateDir });
  assert.equal(cancel.status, 0);
  const payload = JSON.parse(cancel.stdout);
  assert.equal(payload.status, "unchanged");
  assert.equal(payload.job.status, "completed");
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

test("status reconciles active jobs with dead pids as failed", async () => {
  const stateDir = makeTempDir("background-stale-state-");
  const workspaceRoot = makeTempDir("background-stale-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const deadPid = await makeDeadPid();
  const job = startJobRecord(createJobRecord({
    kind: "plan",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "plan",
    args: ["stale", "pid"],
    env
  }), deadPid);
  persistManualJob(workspaceRoot, job, env);

  const status = await runCli(["status", job.id, "--json"], { cwd: workspaceRoot, stateDir });

  assert.equal(status.status, 0);
  assert.equal(status.stderr, "");
  const snapshot = JSON.parse(status.stdout);
  assert.equal(snapshot.job.status, "failed");
  assert.equal(snapshot.job.pid, null);
  assert.match(snapshot.job.endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(snapshot.job.error, /no safe live process id/i);

  const stored = readJobFile(workspaceRoot, job.id, env);
  assert.equal(stored.status, "failed");
  assert.equal(stored.pid, null);
  const result = readJobResultFile(workspaceRoot, job.id, env);
  assert.equal(result.status, "failed");
  assert.match(result.error, /no safe live process id/i);
  assert.match(fs.readFileSync(stored.logPath, "utf8"), /reconciled stale active job/i);
});

test("status keeps queued jobs valid while reconciling stale running jobs", async () => {
  const stateDir = makeTempDir("background-queued-state-");
  const workspaceRoot = makeTempDir("background-queued-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const job = createJobRecord({
    kind: "plan",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "plan",
    args: ["queued"],
    env
  });
  persistManualJob(workspaceRoot, job, env);

  const status = await runCli(["status", job.id, "--json"], { cwd: workspaceRoot, stateDir });

  assert.equal(status.status, 0);
  assert.equal(status.stderr, "");
  const snapshot = JSON.parse(status.stdout);
  assert.equal(snapshot.job.status, "queued");
  assert.equal(snapshot.job.pid, null);
  assert.equal(snapshot.latestFinished, null);

  const stored = readJobFile(workspaceRoot, job.id, env);
  assert.equal(stored.status, "queued");
  assert.equal(fs.existsSync(job.resultPath), false);
});

test("status json includes bounded recent activity for active jobs", async () => {
  const stateDir = makeTempDir("background-activity-state-");
  const workspaceRoot = makeTempDir("background-activity-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const active = {
    ...startJobRecord(createJobRecord({
      kind: "plan",
      cwd: workspaceRoot,
      workspaceRoot,
      command: "plan",
      args: ["activity"],
      env
    }), process.pid),
    phase: "starting"
  };
  persistManualJob(workspaceRoot, active, env);
  appendJobLog(workspaceRoot, active.id, "queued plan activity", env);
  appendJobLog(workspaceRoot, active.id, "spawned worker pid 99", env);
  appendJobLog(workspaceRoot, active.id, "worker started pid 123", env);
  appendJobLog(workspaceRoot, active.id, "claude running", env);

  const status = await runCli(["status", active.id, "--cwd", workspaceRoot, "--json"], { stateDir });

  assert.equal(status.status, 0);
  assert.equal(status.stderr, "");
  const snapshot = JSON.parse(status.stdout);
  const job = snapshot.job;
  assert.equal(job.status, "running");
  assert.equal(job.phase, "running");
  assert.match(job.lastActivityAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Number.isInteger(job.runtimeMs));
  assert.ok(Number.isInteger(job.idleMs));
  assert.ok(job.runtimeMs >= 0);
  assert.ok(job.idleMs >= 0);
  assert.deepEqual(job.recentLog.map((entry) => entry.message), [
    "spawned worker pid 99",
    "worker started pid 123",
    "claude running"
  ]);
});

test("result on a running job reports unavailable result without failing", async () => {
  const stateDir = makeTempDir("background-running-result-state-");
  const launch = await runCli(["plan", "--background", "--json", "running", "result"], {
    stateDir,
    env: { FAKE_CLAUDE_SLEEP_MS: "120000" }
  });
  assert.equal(launch.status, 0);
  const jobId = JSON.parse(launch.stdout).job.id;
  await waitForJobWhere(
    jobId,
    (job) => job.status === "running" && Number.isInteger(job.claudePid),
    { stateDir }
  );

  const result = await runCli(["result", jobId, "--json"], { stateDir });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "plan");
  assert.equal(payload.status, "running");
  assert.equal(payload.metadata.resultAvailable, false);
  assert.match(payload.summary, /still running/i);
  assert.doesNotMatch(payload.rendered, /Status: failed/);

  const cancel = await runCli(["cancel", jobId, "--json"], { stateDir });
  assert.equal(cancel.status, 0);
});

test("runStoredJob returns terminal jobs without re-executing them", async () => {
  const stateDir = makeTempDir("background-terminal-state-");
  const workspaceRoot = makeTempDir("background-terminal-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  let executed = 0;

  for (const terminalStatus of ["completed", "failed", "cancelled"]) {
    const job = createJobRecord({
      kind: "plan",
      cwd: workspaceRoot,
      workspaceRoot,
      command: "plan",
      args: [terminalStatus],
      env
    });
    const result = {
      kind: "plan",
      status: terminalStatus,
      summary: `${terminalStatus} before worker`,
      rendered: `${terminalStatus} before worker`,
      metadata: { jobId: job.id }
    };
    const terminalJob = completeJobRecord(job, result);
    persistManualJob(workspaceRoot, terminalJob, env);

    const returned = await runStoredJob(job.id, {
      workspaceRoot,
      env,
      execute: async () => {
        executed += 1;
        return {
          kind: "plan",
          status: "completed",
          summary: "reran",
          rendered: "reran"
        };
      }
    });

    assert.equal(returned.status, terminalStatus);
    assert.equal(returned.result.summary, `${terminalStatus} before worker`);
    assert.deepEqual(readJobFile(workspaceRoot, job.id, env), terminalJob);
  }

  assert.equal(executed, 0);
});

test("runStoredJob preserves terminal cancellation written while execution is in flight", async () => {
  const stateDir = makeTempDir("background-cancel-race-state-");
  const workspaceRoot = makeTempDir("background-cancel-race-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const job = createJobRecord({
    kind: "plan",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "plan",
    args: ["cancel", "race"],
    env
  });
  persistManualJob(workspaceRoot, job, env);

  const returned = await runStoredJob(job.id, {
    workspaceRoot,
    env,
    execute: async (runningJob) => {
      const cancelledResult = {
        kind: "plan",
        status: "cancelled",
        summary: "cancelled while worker was running",
        rendered: "cancelled while worker was running",
        metadata: { jobId: runningJob.id }
      };
      const cancelled = completeJobRecord(runningJob, cancelledResult);
      persistManualJob(workspaceRoot, cancelled, env);
      writeJobResultFile(workspaceRoot, runningJob.id, cancelledResult, env);

      return {
        kind: "plan",
        status: "completed",
        summary: "worker completed after cancellation",
        rendered: "worker completed after cancellation",
        metadata: { jobId: runningJob.id }
      };
    }
  });

  assert.equal(returned.status, "cancelled");
  assert.equal(readJobFile(workspaceRoot, job.id, env).status, "cancelled");
  assert.equal(readJobResultFile(workspaceRoot, job.id, env).status, "cancelled");
});

test("spawnBackgroundJob does not overwrite terminal state from a fast worker", () => {
  const stateDir = makeTempDir("background-fast-worker-state-");
  const workspaceRoot = makeTempDir("background-fast-worker-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const job = createJobRecord({
    kind: "plan",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "plan",
    args: ["fast", "worker"],
    env
  });
  persistManualJob(workspaceRoot, job, env);

  const result = {
    kind: "plan",
    status: "completed",
    summary: "fast worker completed",
    rendered: "fast worker completed",
    metadata: { jobId: job.id }
  };
  writeJobResultFile(workspaceRoot, job.id, result, env);
  const completed = completeJobRecord(job, result);
  persistManualJob(workspaceRoot, completed, env);

  const workerDir = makeTempDir("background-fast-worker-bin-");
  const workerPath = path.join(workerDir, "worker.mjs");
  fs.writeFileSync(workerPath, "process.exit(0);\n", "utf8");

  const returned = spawnBackgroundJob(job, {
    cliPath: workerPath,
    env
  });

  assert.equal(returned.status, "completed");
  const stored = readJobFile(workspaceRoot, job.id, env);
  assert.equal(stored.status, "completed");
  assert.equal(stored.pid, null);
  assert.equal(readJobResultFile(workspaceRoot, job.id, env).summary, "fast worker completed");
});

test("spawnBackgroundJob leaves persistent running transition to run-job worker", () => {
  const stateDir = makeTempDir("background-parent-running-state-");
  const workspaceRoot = makeTempDir("background-parent-running-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const job = createJobRecord({
    kind: "plan",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "plan",
    args: ["parent", "spawn"],
    env
  });
  persistManualJob(workspaceRoot, job, env);

  const workerDir = makeTempDir("background-parent-running-bin-");
  const workerPath = path.join(workerDir, "worker.mjs");
  fs.writeFileSync(workerPath, "setTimeout(() => {}, 250);\n", "utf8");

  const returned = spawnBackgroundJob(job, {
    cliPath: workerPath,
    env
  });

  assert.equal(returned.status, "running");
  assert.ok(Number.isInteger(returned.pid));

  const stored = readJobFile(workspaceRoot, job.id, env);
  assert.equal(stored.status, "queued");
  assert.equal(stored.pid, null);
  assert.equal(stored.startedAt, null);
});

test("spawnBackgroundJob records failed state when worker cannot start", () => {
  const stateDir = makeTempDir("background-spawn-fail-state-");
  const workspaceRoot = makeTempDir("background-spawn-fail-workspace-");
  const missingCwd = path.join(workspaceRoot, "missing");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const job = createJobRecord({
    kind: "plan",
    cwd: missingCwd,
    workspaceRoot,
    command: "plan",
    args: ["spawn", "failure"],
    env
  });
  persistManualJob(workspaceRoot, job, env);

  const returned = spawnBackgroundJob(job, {
    cliPath,
    env
  });

  assert.equal(returned.status, "failed");
  assert.equal(readJobFile(workspaceRoot, job.id, env).status, "failed");
  assert.match(readJobResultFile(workspaceRoot, job.id, env).error, /worker cwd does not exist/i);
});

test("status reconciles stale queued jobs as failed", async () => {
  const stateDir = makeTempDir("background-stale-queued-state-");
  const workspaceRoot = makeTempDir("background-stale-queued-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const job = {
    ...createJobRecord({
      kind: "plan",
      cwd: workspaceRoot,
      workspaceRoot,
      command: "plan",
      args: ["stale", "queued"],
      env
    }),
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
  };
  persistManualJob(workspaceRoot, job, env);

  const status = await runCli(["status", job.id, "--json"], { cwd: workspaceRoot, stateDir });

  assert.equal(status.status, 0);
  const snapshot = JSON.parse(status.stdout);
  assert.equal(snapshot.job.status, "failed");
  assert.match(snapshot.job.error, /active status queued/i);
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

test("status --brief omits embedded stored result payloads", async () => {
  const stateDir = makeTempDir("background-status-brief-state-");
  const workspaceRoot = makeTempDir("background-status-brief-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const result = {
    kind: "plan",
    status: "completed",
    summary: "large result",
    rawOutput: "brief-test-large-output",
    rendered: "brief-test-large-rendered",
    metadata: { jobId: "placeholder" }
  };
  const job = completeJobRecord(createJobRecord({
    kind: "plan",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "plan",
    args: ["--prompt", "brief-test-large-prompt"],
    env
  }), result);
  job.stdoutTail = "brief-test-large-stdout-tail";
  job.stderrTail = "brief-test-large-stderr-tail";
  persistManualJob(workspaceRoot, job, env);
  writeJobResultFile(workspaceRoot, job.id, { ...result, metadata: { jobId: job.id } }, env);

  const full = await runCli(["status", "--all", "--json"], { cwd: workspaceRoot, stateDir });
  assert.equal(full.status, 0);
  assert.match(full.stdout, /brief-test-large-output/);

  const brief = await runCli(["status", "--all", "--brief", "--json"], { cwd: workspaceRoot, stateDir });

  assert.equal(brief.status, 0);
  assert.doesNotMatch(brief.stdout, /brief-test-large-output/);
  assert.doesNotMatch(brief.stdout, /brief-test-large-rendered/);
  assert.doesNotMatch(brief.stdout, /brief-test-large-prompt/);
  assert.doesNotMatch(brief.stdout, /brief-test-large-stdout-tail/);
  assert.doesNotMatch(brief.stdout, /brief-test-large-stderr-tail/);
  const payload = JSON.parse(brief.stdout);
  const briefJob = extractJob(payload, job.id);
  assert.ok(briefJob);
  assert.equal(Object.hasOwn(briefJob, "result"), false);
  assert.equal(Object.hasOwn(briefJob, "args"), false);
  assert.equal(Object.hasOwn(briefJob, "stdoutTail"), false);
  assert.equal(Object.hasOwn(briefJob, "stderrTail"), false);
});

test("background jobs launched with --cwd can be managed with status result and cancel --cwd", async () => {
  const stateDir = makeTempDir("background-cwd-state-");
  const workspaceRoot = makeTempDir("background-cwd-workspace-");

  const launch = await runCli(["plan", "--background", "--json", "--cwd", workspaceRoot, "cwd", "managed"], {
    stateDir
  });
  assert.equal(launch.status, 0);
  const jobId = JSON.parse(launch.stdout).job.id;

  let completed = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await runCli(["status", jobId, "--cwd", workspaceRoot, "--json"], { stateDir });
    if (status.status === 0) {
      const job = JSON.parse(status.stdout).job;
      if (job?.status === "completed") {
        completed = job;
        break;
      }
    }
    await sleep(100);
  }
  assert.ok(completed);

  const result = await runCli(["result", jobId, "--cwd", workspaceRoot, "--json"], { stateDir });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, "completed");

  const slowLaunch = await runCli(["rescue", "--background", "--json", "--cwd", workspaceRoot, "slow", "cwd"], {
    stateDir,
    env: { FAKE_CLAUDE_SLEEP_MS: "10000" }
  });
  assert.equal(slowLaunch.status, 0);
  const slowJobId = JSON.parse(slowLaunch.stdout).job.id;
  await waitForJobStatus(slowJobId, "running", { cwd: workspaceRoot, stateDir });

  const cancel = await runCli(["cancel", slowJobId, "--cwd", workspaceRoot, "--json"], { stateDir });
  assert.equal(cancel.status, 0);
  assert.equal(JSON.parse(cancel.stdout).job.status, "cancelled");
});

test("status result and cancel discover jobs present only in job files", async () => {
  const stateDir = makeTempDir("background-job-file-state-");
  const workspaceRoot = makeTempDir("background-job-file-workspace-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const result = {
    kind: "review",
    status: "completed",
    summary: "completed outside state cache",
    rendered: "job file result",
    metadata: {}
  };
  const job = completeJobRecord(createJobRecord({
    kind: "review",
    cwd: workspaceRoot,
    workspaceRoot,
    command: "review",
    args: ["outside", "state"],
    env
  }), result);
  const storedResult = { ...result, metadata: { jobId: job.id } };
  const storedJob = { ...job, result: storedResult };
  persistJobFileWithoutStateEntry(workspaceRoot, storedJob, env);
  writeJobResultFile(workspaceRoot, job.id, storedResult, env);

  const status = await runCli(["status", job.id, "--json"], { cwd: workspaceRoot, stateDir });
  assert.equal(status.status, 0);
  assert.equal(JSON.parse(status.stdout).job.id, job.id);

  const selected = await runCli(["result", job.id, "--json"], { cwd: workspaceRoot, stateDir });
  assert.equal(selected.status, 0);
  assert.equal(JSON.parse(selected.stdout).summary, "completed outside state cache");

  const cancelled = await runCli(["cancel", job.id, "--json"], { cwd: workspaceRoot, stateDir });
  assert.equal(cancelled.status, 0);
  const payload = JSON.parse(cancelled.stdout);
  assert.equal(payload.status, "unchanged");
  assert.equal(payload.job.id, job.id);
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
  const active = await waitForJobWhere(
    jobId,
    (job) => job.status === "running" && Number.isInteger(job.claudePid) && Array.isArray(job.claudeArgv),
    { stateDir }
  );
  assert.ok(active.claudeArgv.includes("--tools"));

  const cancel = await runCli(["cancel", jobId, "--json"], { stateDir });
  assert.equal(cancel.status, 0);
  const cancelled = JSON.parse(cancel.stdout);
  assert.equal(cancelled.job.status, "cancelled");
  assert.equal(cancelled.job.pid, null);
  assert.equal(cancelled.signalled, true);
  assert.equal(cancelled.processExited, true);
  assert.equal(cancelled.workerPid, active.pid);
  assert.equal(cancelled.claudePid, active.claudePid);
  assert.equal(await waitForPidExit(active.pid), true);
  assert.equal(await waitForPidExit(active.claudePid), true);

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

test("background job creation fails before queueing when storage quota is exhausted by active jobs", async () => {
  const stateDir = makeTempDir("background-quota-state-");
  const env = { CLAUDE_COMPANION_STATE_DIR: stateDir };
  const active = startJobRecord(createJobRecord({
    kind: "plan",
    cwd: repoRoot,
    workspaceRoot: repoRoot,
    command: "plan",
    args: ["already", "running"],
    env
  }), process.pid);
  writeJobFile(repoRoot, active.id, active, env);
  appendJobLog(repoRoot, active.id, "active ".repeat(40), {
    ...env,
    CLAUDE_COMPANION_MAX_LOG_BYTES: "1000"
  });

  const launch = await runCli(["plan", "--background", "--json", "quota", "blocked"], {
    stateDir,
    env: { CLAUDE_COMPANION_MAX_STATE_BYTES: "120" }
  });

  assert.equal(launch.status, 1);
  assert.match(JSON.parse(launch.stdout).error, /storage quota/i);
  assert.deepEqual(listJobFileIds(repoRoot, env), [active.id]);
});

test("completed background jobs prune old terminal artifacts and keep latest result readable", async () => {
  const stateDir = makeTempDir("background-cleanup-state-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: stateDir,
    CLAUDE_COMPANION_MAX_JOBS: "1",
    CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "365"
  };
  const old = completeJobRecord(createJobRecord({
    kind: "plan",
    cwd: repoRoot,
    workspaceRoot: repoRoot,
    command: "plan",
    args: ["old"],
    env
  }), {
    kind: "plan",
    status: "completed",
    summary: "old",
    rawOutput: "old",
    rendered: "old",
    metadata: { jobId: "old" }
  });
  const oldTerminal = {
    ...old,
    id: "old-terminal",
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
  };
  writeJobFile(repoRoot, oldTerminal.id, oldTerminal, env);
  writeJobResultFile(repoRoot, oldTerminal.id, oldTerminal.result, env);

  const launch = await runCli(["plan", "--background", "--json", "new", "cleanup"], {
    stateDir,
    env: {
      CLAUDE_COMPANION_MAX_JOBS: "1",
      CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "365"
    }
  });
  assert.equal(launch.status, 0);
  const jobId = JSON.parse(launch.stdout).job.id;
  await waitForJobStatus(jobId, "completed", {
    stateDir,
    env: {
      CLAUDE_COMPANION_MAX_JOBS: "1",
      CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "365"
    }
  });

  assert.equal(fs.existsSync(resolveJobFile(repoRoot, oldTerminal.id, env)), false);
  const result = await runCli(["result", jobId, "--json"], {
    stateDir,
    env: {
      CLAUDE_COMPANION_MAX_JOBS: "1",
      CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "365"
    }
  });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, "completed");
});

test("storage and cleanup commands report usage and support dry-run json mode", async () => {
  const stateDir = makeTempDir("background-storage-command-state-");
  const workspaceRoot = makeTempDir("background-storage-command-workspace-");
  const launch = await runCli(["plan", "--wait", "--json", "storage", "command"], { stateDir });
  assert.equal(launch.status, 0);
  const cwdLaunch = await runCli(["plan", "--wait", "--json", "--cwd", workspaceRoot, "storage", "cwd"], { stateDir });
  assert.equal(cwdLaunch.status, 0);

  const storage = await runCli(["storage", "--json"], { stateDir });
  assert.equal(storage.status, 0);
  const storagePayload = JSON.parse(storage.stdout);
  assert.equal(storagePayload.stateRoot, stateDir);
  assert.ok(storagePayload.totalBytes > 0);

  const cwdStorage = await runCli(["storage", "--cwd", workspaceRoot, "--json"], { stateDir });
  assert.equal(cwdStorage.status, 0);
  const cwdStoragePayload = JSON.parse(cwdStorage.stdout);
  assert.equal(cwdStoragePayload.workspaces.length, 1);
  assert.equal(cwdStoragePayload.workspaces[0].workspaceRoot, workspaceRoot);

  const dryRun = await runCli(["cleanup", "--dry-run", "--json"], { stateDir });
  assert.equal(dryRun.status, 0);
  const cleanupPayload = JSON.parse(dryRun.stdout);
  assert.equal(cleanupPayload.dryRun, true);
  assert.ok(Number.isInteger(cleanupPayload.beforeBytes));

  const allStorage = await runCli(["storage", "--all", "--json"], { stateDir });
  assert.equal(allStorage.status, 0);
  assert.equal(JSON.parse(allStorage.stdout).stateRoot, stateDir);
});
