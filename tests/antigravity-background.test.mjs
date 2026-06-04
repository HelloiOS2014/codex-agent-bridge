import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir, makeTempGitRepo, repoRoot } from "./helpers.mjs";
import { runCommand } from "../plugins/antigravity-bridge/scripts/lib/process.mjs";

const antigravityPluginRoot = path.join(repoRoot, "plugins", "antigravity-bridge");
const antigravityCliPath = path.join(antigravityPluginRoot, "scripts", "antigravity-companion.mjs");
const fakeAgyPath = path.join(repoRoot, "tests", "fake-agy-fixture.mjs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runAntigravityCli(args, options = {}) {
  return runCommand(process.execPath, [antigravityCliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ANTIGRAVITY_COMPANION_AGY_BIN: fakeAgyPath,
      ANTIGRAVITY_COMPANION_STATE_DIR: options.stateDir ?? makeTempDir("antigravity-companion-state-"),
      ...(options.env ?? {})
    }
  });
}

function extractJob(snapshot, jobId) {
  const jobs = [
    ...(snapshot.running ?? []),
    snapshot.latestFinished,
    ...(snapshot.recent ?? []),
    snapshot.job
  ].filter(Boolean);
  return jobs.find((job) => job.id === jobId) ?? null;
}

async function waitForJobStatus(jobId, expectedStatus, options = {}) {
  let lastResult = null;
  for (let index = 0; index < 60; index += 1) {
    lastResult = await runAntigravityCli(["status", jobId, "--json"], options);
    if (lastResult.status === 0) {
      const snapshot = JSON.parse(lastResult.stdout);
      const job = extractJob(snapshot, jobId);
      if (job?.status === expectedStatus) {
        return job;
      }
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${jobId}; last output: ${lastResult?.stdout || lastResult?.stderr}`);
}

async function waitForJobWhere(jobId, predicate, options = {}) {
  let lastResult = null;
  for (let index = 0; index < 60; index += 1) {
    lastResult = await runAntigravityCli(["status", jobId, "--json"], options);
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

async function waitForPidExit(pid, options = {}) {
  for (let index = 0; index < (options.attempts ?? 60); index += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await sleep(options.intervalMs ?? 50);
  }
  return false;
}

test("background plan records agy process fields and returns stored result", async () => {
  const stateDir = makeTempDir("antigravity-background-state-");
  const launch = await runAntigravityCli(["plan", "--background", "--json", "background", "plan"], { stateDir });

  assert.equal(launch.status, 0);
  const started = JSON.parse(launch.stdout);
  assert.equal(started.status, "running");
  assert.match(started.job.id, /^plan-[a-z0-9-]+/);

  const completed = await waitForJobStatus(started.job.id, "completed", { stateDir });
  assert.equal(completed.status, "completed");
  assert.equal(completed.pid, null);
  assert.match(completed.phase, /done|agy_output|agy_spawned/);
  assert.match(JSON.stringify(completed.agyArgv), /--print/);

  const result = await runAntigravityCli(["result", started.job.id, "--json"], { stateDir });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "plan");
  assert.equal(payload.status, "completed");
  assert.match(payload.rendered, /Antigravity Plan/);
  assert.match(payload.text, /background plan/);
});

test("--wait adversarial-review runs through the job path and latest result is readable with --cwd", async () => {
  const stateDir = makeTempDir("antigravity-wait-state-");
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "risk.txt"), "risk\n", "utf8");

  const waited = await runAntigravityCli([
    "adversarial-review",
    "--wait",
    "--json",
    "--cwd",
    cwd,
    "--scope",
    "working-tree",
    "focus",
    "on",
    "risk"
  ], { stateDir });

  assert.equal(waited.status, 0);
  assert.equal(waited.stderr, "");
  const payload = JSON.parse(waited.stdout);
  assert.equal(payload.kind, "adversarial-review");
  assert.equal(payload.status, "completed");
  assert.match(payload.rendered, /Antigravity Adversarial Review/);
  assert.match(payload.text, /focus on risk/);
  assert.match(payload.text, /risk\.txt/);

  const latest = await runAntigravityCli(["result", "--cwd", cwd, "--json"], { stateDir });
  assert.equal(latest.status, 0);
  const latestPayload = JSON.parse(latest.stdout);
  assert.equal(latestPayload.kind, "adversarial-review");
  assert.match(latestPayload.text, /risk\.txt/);
});

test("storage and cleanup commands report Antigravity usage with scoped and all json modes", async () => {
  const stateDir = makeTempDir("antigravity-storage-command-state-");
  const workspaceRoot = makeTempDir("antigravity-storage-command-workspace-");
  const launch = await runAntigravityCli(["plan", "--wait", "--json", "storage", "root"], { stateDir });
  assert.equal(launch.status, 0);
  const cwdLaunch = await runAntigravityCli(["plan", "--wait", "--json", "--cwd", workspaceRoot, "storage", "cwd"], { stateDir });
  assert.equal(cwdLaunch.status, 0);

  const storage = await runAntigravityCli(["storage", "--json"], { stateDir });
  assert.equal(storage.status, 0);
  const storagePayload = JSON.parse(storage.stdout);
  assert.equal(storagePayload.stateRoot, stateDir);
  assert.ok(storagePayload.totalBytes > 0);

  const cwdStorage = await runAntigravityCli(["storage", "--cwd", workspaceRoot, "--json"], { stateDir });
  assert.equal(cwdStorage.status, 0);
  const cwdStoragePayload = JSON.parse(cwdStorage.stdout);
  assert.equal(cwdStoragePayload.workspaces.length, 1);
  assert.equal(cwdStoragePayload.workspaces[0].workspaceRoot, workspaceRoot);

  const dryRun = await runAntigravityCli(["cleanup", "--dry-run", "--json"], { stateDir });
  assert.equal(dryRun.status, 0);
  const cleanupPayload = JSON.parse(dryRun.stdout);
  assert.equal(cleanupPayload.dryRun, true);
  assert.ok(Number.isInteger(cleanupPayload.beforeBytes));

  const allStorage = await runAntigravityCli(["storage", "--all", "--json"], { stateDir });
  assert.equal(allStorage.status, 0);
  assert.equal(JSON.parse(allStorage.stdout).stateRoot, stateDir);
});

test("cancel terminates running Antigravity background jobs and stores a cancelled result", async () => {
  const stateDir = makeTempDir("antigravity-cancel-state-");
  const launch = await runAntigravityCli(["rescue", "--background", "--json", "cancel", "slow"], {
    stateDir,
    env: { FAKE_AGY_SLEEP_MS: "30000" }
  });
  assert.equal(launch.status, 0);
  const jobId = JSON.parse(launch.stdout).job.id;
  const active = await waitForJobWhere(
    jobId,
    (job) => job.status === "running" && Number.isInteger(job.agyPid) && Array.isArray(job.agyArgv),
    { stateDir }
  );
  assert.ok(active.agyArgv.includes("--print"));

  const cancel = await runAntigravityCli(["cancel", jobId, "--json"], { stateDir });
  assert.equal(cancel.status, 0);
  const cancelled = JSON.parse(cancel.stdout);
  assert.equal(cancelled.job.status, "cancelled");
  assert.equal(cancelled.job.pid, null);
  assert.equal(cancelled.signalled, true);
  assert.equal(cancelled.processExited, true);
  assert.equal(cancelled.workerPid, active.pid);
  assert.equal(cancelled.agyPid, active.agyPid);
  assert.equal(await waitForPidExit(active.pid), true);
  assert.equal(await waitForPidExit(active.agyPid), true);

  const result = await runAntigravityCli(["result", jobId, "--json"], { stateDir });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, "cancelled");
});
