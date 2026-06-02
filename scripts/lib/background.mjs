import { spawn } from "node:child_process";
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

function failStaleActiveJob(job, workspaceRoot, env) {
  validateJobId(job.id);
  const root = jobRoot(job, workspaceRoot);
  const message = staleActiveJobMessage(job);
  const result = failedResult(job, new Error(message));
  writeJobResultFile(root, job.id, result, env);
  const failed = completeJobRecord(job, result);
  upsertJob(root, failed, env);
  appendJobLog(root, failed.id, `reconciled stale active job: ${message}`, env);
  return failed;
}

function reconcileActiveJob(job, workspaceRoot, env) {
  if (job?.status !== "running") {
    return job;
  }
  if (processPidIsLive(job.pid)) {
    return job;
  }
  return failStaleActiveJob(job, workspaceRoot, env);
}

function reconcileActiveJobs(workspaceRoot, jobs, env) {
  return jobs.map((job) => reconcileActiveJob(job, workspaceRoot, env));
}

export function createQueuedJob(parsed, runtime = {}) {
  const env = runtime.env ?? process.env;
  const workspaceRoot = jobWorkspace(parsed, runtime);
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
  if (!cliPath) {
    throw new Error("Internal error: missing CLI path for background worker.");
  }
  const child = spawn(process.execPath, [cliPath, "run-job", job.id], {
    cwd: job.cwd,
    env,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  const root = jobRoot(job);
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
  const running = startJobRecord(current, child.pid);
  upsertJob(jobRoot(running), running, env);
  appendJobLog(jobRoot(running), running.id, `spawned worker pid ${child.pid}`, env);
  return running;
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
  const jobs = reconcileActiveJobs(workspaceRoot, listJobs(workspaceRoot, env), env);
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
  const jobs = sortedJobs(listJobs(workspaceRoot, env));
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

  try {
    writeJobResultFile(root, job.id, result, env);
  } catch (error) {
    result = failedResult(job, error);
    writeJobResultFile(root, job.id, result, env);
  }

  const completed = completeJobRecord(job, result);
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
