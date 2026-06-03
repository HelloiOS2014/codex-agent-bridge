import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  completeJobRecord,
  compareJobsByLatestActivity,
  createJobRecord,
  findJob,
  isActiveJob,
  startJobRecord,
  summarizeStatus
} from "./jobs.mjs";
import { terminateProcessTree } from "./process.mjs";
import { normalizeCompanionResult } from "./render.mjs";
import {
  appendJobLog,
  listJobFileIds,
  readJobFile,
  readJobResultFile,
  readState,
  upsertJob,
  validateJobId,
  writeJobResultFile
} from "./state.mjs";

const WORKER_OMITTED_OPTIONS = new Set(["background", "wait", "json", "cwd"]);
const DEFAULT_QUEUED_STALE_MS = 30_000;

function jobWorkspace(parsed, runtime = {}) {
  const baseCwd = runtime.cwd ?? process.cwd();
  return parsed.options.cwd ? path.resolve(baseCwd, parsed.options.cwd) : baseCwd;
}

function workerArgsFromParsed(parsed) {
  const args = [];
  for (const [name, value] of Object.entries(parsed.options ?? {})) {
    if (WORKER_OMITTED_OPTIONS.has(name) || value === false || value === undefined) {
      continue;
    }
    args.push(`--${name}`);
    if (value !== true) {
      args.push(String(value));
    }
  }
  args.push(...(parsed.positionals ?? []));
  return args;
}

function jobRoot(job, fallbackRoot) {
  return job.workspaceRoot ?? fallbackRoot ?? job.cwd;
}

function sortedJobs(jobs) {
  return [...jobs].sort(compareJobsByLatestActivity);
}

function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}

function safeProcessPid(value) {
  return Number.isInteger(value) && value > 1 ? value : null;
}

function processPidIsLive(value) {
  const pid = safeProcessPid(value);
  if (pid === null) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function failedResult(job, error) {
  const message = messageFromError(error);
  return normalizeCompanionResult({
    kind: job.kind,
    status: "failed",
    summary: message,
    rawOutput: "",
    text: "",
    error: message,
    metadata: { jobId: job.id }
  }, { kind: job.kind });
}

function cancelledResult(job, message) {
  return normalizeCompanionResult({
    kind: job.kind,
    status: "cancelled",
    summary: message,
    rawOutput: "",
    text: "",
    error: message,
    metadata: { jobId: job.id }
  }, { kind: job.kind });
}

function staleActiveJobMessage(job) {
  const pid = job.pid === null || job.pid === undefined ? "none" : String(job.pid);
  return `Job ${job.id} marked failed because active status ${job.status} has no safe live process id (pid ${pid}).`;
}

function failActiveJob(job, workspaceRoot, env, message = staleActiveJobMessage(job), logPrefix = "reconciled stale active job") {
  validateJobId(job.id);
  const root = jobRoot(job, workspaceRoot);
  const result = failedResult(job, new Error(message));
  writeJobResultFile(root, job.id, result, env);
  const failed = completeJobRecord(job, result);
  upsertJob(root, failed, env);
  appendJobLog(root, failed.id, `${logPrefix}: ${message}`, env);
  return failed;
}

function failStaleActiveJob(job, workspaceRoot, env) {
  return failActiveJob(job, workspaceRoot, env);
}

function queuedJobIsStale(job, staleMs = DEFAULT_QUEUED_STALE_MS) {
  const createdAtMs = Date.parse(job?.createdAt ?? "");
  if (!Number.isFinite(createdAtMs)) {
    return true;
  }
  return Date.now() - createdAtMs > staleMs;
}

function reconcileActiveJob(job, workspaceRoot, env, options = {}) {
  if (!isActiveJob(job)) {
    return job;
  }
  if (job.status === "queued") {
    if (!queuedJobIsStale(job, options.queuedStaleMs ?? DEFAULT_QUEUED_STALE_MS)) {
      return job;
    }
    return failStaleActiveJob(job, workspaceRoot, env);
  }
  if (processPidIsLive(job.pid)) {
    return job;
  }
  return failStaleActiveJob(job, workspaceRoot, env);
}

function reconcileActiveJobs(workspaceRoot, jobs, env, options = {}) {
  return jobs.map((job) => reconcileActiveJob(job, workspaceRoot, env, options));
}

function ensureDirectory(directory, label) {
  let stat;
  try {
    stat = fs.statSync(directory);
  } catch (error) {
    throw new Error(`${label} does not exist: ${directory}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directory}`);
  }
  return directory;
}

function readCurrentJobOr(job, root, env) {
  try {
    return readJobFile(root, job.id, env);
  } catch {
    return job;
  }
}

function failQueuedWorkerLaunch(job, root, env, message) {
  const current = readCurrentJobOr(job, root, env);
  if (!isActiveJob(current) || current.status !== "queued") {
    return current;
  }
  return failActiveJob(current, root, env, message, "worker launch failed");
}

export function createQueuedJob(parsed, runtime = {}) {
  const env = runtime.env ?? process.env;
  const workspaceRoot = jobWorkspace(parsed, runtime);
  ensureDirectory(workspaceRoot, "Worker cwd");
  const job = createJobRecord({
    kind: parsed.command,
    cwd: workspaceRoot,
    workspaceRoot,
    command: parsed.command,
    args: workerArgsFromParsed(parsed),
    write: parsed.options.write,
    summary: `${parsed.command} queued`,
    env
  });
  upsertJob(workspaceRoot, job, env);
  appendJobLog(workspaceRoot, job.id, `queued ${job.command} ${job.args.join(" ")}`.trim(), env);
  return job;
}

export function spawnBackgroundJob(job, options = {}) {
  const env = options.env ?? process.env;
  const cliPath = options.cliPath;
  const root = jobRoot(job);
  if (!cliPath) {
    throw new Error("Internal error: missing CLI path for background worker.");
  }
  try {
    ensureDirectory(job.cwd, "Worker cwd");
  } catch (error) {
    return failQueuedWorkerLaunch(job, root, env, messageFromError(error));
  }

  let child;
  try {
    child = spawn(process.execPath, [cliPath, "run-job", job.id], {
      cwd: job.cwd,
      env,
      detached: true,
      stdio: "ignore"
    });
  } catch (error) {
    return failQueuedWorkerLaunch(job, root, env, `Worker process could not be spawned: ${messageFromError(error)}`);
  }

  child.once("error", (error) => {
    failQueuedWorkerLaunch(job, root, env, `Worker process failed to start: ${messageFromError(error)}`);
  });
  child.once("close", (status, signal) => {
    const current = readCurrentJobOr(job, root, env);
    if (current.status === "queued") {
      const statusLabel = status === null ? `signal ${signal ?? "unknown"}` : `status ${status}`;
      failQueuedWorkerLaunch(job, root, env, `Worker process exited before starting job with ${statusLabel}.`);
    }
  });

  child.unref();
  appendJobLog(root, job.id, `spawned worker pid ${child.pid}`, env);

  let current = job;
  try {
    current = readJobFile(root, job.id, env);
  } catch {
    current = job;
  }
  if (!isActiveJob(current)) {
    appendJobLog(root, current.id, `worker reached ${current.status} before parent recorded pid ${child.pid}`, env);
    return current;
  }

  // The run-job worker is the only process allowed to persist the running
  // transition. Returning a transient running view preserves launch feedback
  // without creating a parent-after-worker overwrite window.
  return startJobRecord(current, child.pid);
}

export function listJobs(workspaceRoot, env = process.env) {
  const state = readState(workspaceRoot, env);
  const jobsById = new Map();
  const orderedIds = [];
  const addJob = (job) => {
    if (!job?.id) {
      return;
    }
    if (!jobsById.has(job.id)) {
      orderedIds.push(job.id);
    }
    jobsById.set(job.id, job);
  };

  for (const entry of state.jobs) {
    if (!entry?.id) {
      continue;
    }
    try {
      addJob(readJobFile(workspaceRoot, entry.id, env));
    } catch {
      addJob(entry);
    }
  }
  for (const jobId of listJobFileIds(workspaceRoot, env)) {
    try {
      addJob(readJobFile(workspaceRoot, jobId, env));
    } catch {
      // Ignore malformed or concurrently replaced job files; state entries above remain available as a cache.
    }
  }
  return orderedIds.map((jobId) => jobsById.get(jobId));
}

export function statusSnapshot(workspaceRoot, options = {}) {
  const env = options.env ?? process.env;
  const jobs = reconcileActiveJobs(workspaceRoot, listJobs(workspaceRoot, env), env, options);
  if (options.jobId) {
    const job = findJob(jobs, options.jobId);
    return {
      running: isActiveJob(job) ? [job] : [],
      latestFinished: isActiveJob(job) ? null : job,
      recent: [],
      job
    };
  }

  const snapshot = summarizeStatus(jobs);
  if (options.all) {
    const allRecent = sortedJobs(jobs).filter((job) => job.id !== snapshot.latestFinished?.id);
    return { ...snapshot, recent: allRecent, all: true };
  }
  return snapshot;
}

export function readSelectedResult(workspaceRoot, options = {}) {
  const env = options.env ?? process.env;
  const jobs = sortedJobs(reconcileActiveJobs(workspaceRoot, listJobs(workspaceRoot, env), env, options));
  const job = options.jobId
    ? findJob(jobs, options.jobId)
    : jobs.find((entry) => !isActiveJob(entry));

  if (!job) {
    throw new Error("No finished Claude companion job found.");
  }

  let result = null;
  try {
    result = readJobResultFile(jobRoot(job, workspaceRoot), job.id, env);
  } catch {
    result = job.result ?? null;
  }

  if (!result) {
    throw new Error(`No result available for "${job.id}" while job status is ${job.status}.`);
  }

  return { job, result };
}

export async function runStoredJob(jobId, options = {}) {
  const safeJobId = validateJobId(jobId);
  const env = options.env ?? process.env;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const execute = options.execute;
  if (typeof execute !== "function") {
    throw new Error("Internal error: missing stored job executor.");
  }

  let job = readJobFile(workspaceRoot, safeJobId, env);
  const root = jobRoot(job, workspaceRoot);
  if (!isActiveJob(job)) {
    appendJobLog(root, job.id, `worker skipped ${job.status} job`, env);
    return job;
  }

  job = startJobRecord(job, process.pid);
  upsertJob(root, job, env);
  appendJobLog(root, job.id, `worker started pid ${process.pid}`, env);

  let result;
  try {
    result = await execute(job);
  } catch (error) {
    result = failedResult(job, error);
  }

  let current = readCurrentJobOr(job, root, env);
  if (!isActiveJob(current)) {
    appendJobLog(root, current.id, `worker preserved terminal ${current.status} state`, env);
    return current;
  }

  try {
    writeJobResultFile(root, current.id, result, env);
  } catch (error) {
    result = failedResult(current, error);
    current = readCurrentJobOr(current, root, env);
    if (!isActiveJob(current)) {
      appendJobLog(root, current.id, `worker preserved terminal ${current.status} state after result write failure`, env);
      return current;
    }
    writeJobResultFile(root, current.id, result, env);
  }

  current = readCurrentJobOr(current, root, env);
  if (!isActiveJob(current)) {
    if (current.result) {
      writeJobResultFile(root, current.id, current.result, env);
    }
    appendJobLog(root, current.id, `worker preserved terminal ${current.status} state after result write`, env);
    return current;
  }

  const completed = completeJobRecord(current, result);
  upsertJob(root, completed, env);
  appendJobLog(root, completed.id, `worker finished with status ${completed.status}`, env);
  return completed;
}

export function cancelJob(workspaceRoot, jobId, options = {}) {
  const env = options.env ?? process.env;
  const job = findJob(listJobs(workspaceRoot, env), jobId);
  const root = jobRoot(job, workspaceRoot);

  if (!isActiveJob(job)) {
    return {
      status: "unchanged",
      message: `Job ${job.id} is already ${job.status}.`,
      signalled: false,
      job
    };
  }

  const pid = Number(job.pid);
  const safePid = Number.isInteger(pid) && pid > 1;
  const signalled = safePid ? terminateProcessTree(pid, "SIGTERM") : false;
  const message = signalled
    ? "Cancellation requested."
    : "Job marked cancelled; no safe running process id was signalled.";
  const result = cancelledResult(job, message);

  writeJobResultFile(root, job.id, result, env);
  const cancelled = completeJobRecord(job, result);
  upsertJob(root, cancelled, env);
  appendJobLog(root, cancelled.id, `${message} previous pid ${job.pid ?? "none"}`, env);

  return {
    status: "cancelled",
    message,
    signalled,
    job: cancelled
  };
}
