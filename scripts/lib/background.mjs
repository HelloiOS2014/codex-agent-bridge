import { spawn } from "node:child_process";
import path from "node:path";
import {
  completeJobRecord,
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
  return [...jobs].sort((left, right) => {
    const leftTime = left.endedAt ?? left.createdAt ?? "";
    const rightTime = right.endedAt ?? right.createdAt ?? "";
    return String(rightTime).localeCompare(String(leftTime));
  });
}

function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
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
  const running = startJobRecord(job, child.pid);
  upsertJob(jobRoot(running), running, env);
  appendJobLog(jobRoot(running), running.id, `spawned worker pid ${child.pid}`, env);
  child.unref();
  return running;
}

export function listJobs(workspaceRoot, env = process.env) {
  const state = readState(workspaceRoot, env);
  const jobs = [];
  for (const entry of state.jobs) {
    if (!entry?.id) {
      continue;
    }
    try {
      jobs.push(readJobFile(workspaceRoot, entry.id, env));
    } catch {
      jobs.push(entry);
    }
  }
  return jobs;
}

export function statusSnapshot(workspaceRoot, options = {}) {
  const env = options.env ?? process.env;
  const jobs = listJobs(workspaceRoot, env);
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
  if (job.status === "cancelled") {
    appendJobLog(root, job.id, "worker skipped cancelled job", env);
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
