import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function slug(value) {
  return String(value || "workspace").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

export function validateJobId(jobId) {
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new Error("Invalid job id: expected a non-empty safe filename identifier");
  }
  if (jobId === ".." || jobId.includes("/") || jobId.includes("\\") || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    throw new Error(`Invalid job id: ${jobId}`);
  }
  return jobId;
}

export function resolveStateRoot(env = process.env) {
  return env.CLAUDE_COMPANION_STATE_DIR || env.CODEX_PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "claude-companion");
}

export function resolveStateDir(workspaceRoot, env = process.env) {
  const real = fs.existsSync(workspaceRoot) ? fs.realpathSync.native(workspaceRoot) : workspaceRoot;
  const hash = crypto.createHash("sha256").update(real).digest("hex").slice(0, 16);
  return path.join(resolveStateRoot(env), `${slug(path.basename(workspaceRoot))}-${hash}`);
}

export function resolveStateFile(workspaceRoot, env = process.env) {
  const dir = resolveStateDir(workspaceRoot, env);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "state.json");
}

export function resolveJobsDir(workspaceRoot, env = process.env) {
  return path.join(resolveStateDir(workspaceRoot, env), "jobs");
}

export function ensureJobsDir(workspaceRoot, env = process.env) {
  const dir = resolveJobsDir(workspaceRoot, env);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveContainedJobPath(workspaceRoot, filename, env = process.env) {
  const jobsDir = path.resolve(ensureJobsDir(workspaceRoot, env));
  const file = path.resolve(jobsDir, filename);
  const relative = path.relative(jobsDir, file);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Resolved job path escapes jobs directory: ${filename}`);
  }
  return file;
}

export function resolveJobFile(workspaceRoot, jobId, env = process.env) {
  return resolveContainedJobPath(workspaceRoot, `${validateJobId(jobId)}.json`, env);
}

export function resolveJobLogFile(workspaceRoot, jobId, env = process.env) {
  return resolveContainedJobPath(workspaceRoot, `${validateJobId(jobId)}.log`, env);
}

export function resolveJobResultFile(workspaceRoot, jobId, env = process.env) {
  return resolveContainedJobPath(workspaceRoot, `${validateJobId(jobId)}.result.json`, env);
}

function writeJsonFileAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  return file;
}

export function readState(workspaceRoot, env = process.env) {
  const file = resolveStateFile(workspaceRoot, env);
  if (!fs.existsSync(file)) {
    return { version: 1, jobs: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    version: 1,
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
  };
}

export function writeState(workspaceRoot, state, env = process.env) {
  return writeJsonFileAtomic(resolveStateFile(workspaceRoot, env), {
    version: 1,
    jobs: Array.isArray(state.jobs) ? state.jobs : []
  });
}

export function writeJobFile(workspaceRoot, jobId, payload, env = process.env) {
  return writeJsonFileAtomic(resolveJobFile(workspaceRoot, jobId, env), payload);
}

export function readJobFile(workspaceRoot, jobId, env = process.env) {
  return JSON.parse(fs.readFileSync(resolveJobFile(workspaceRoot, jobId, env), "utf8"));
}

export function writeJobResultFile(workspaceRoot, jobId, payload, env = process.env) {
  return writeJsonFileAtomic(resolveJobResultFile(workspaceRoot, jobId, env), payload);
}

export function readJobResultFile(workspaceRoot, jobId, env = process.env) {
  return JSON.parse(fs.readFileSync(resolveJobResultFile(workspaceRoot, jobId, env), "utf8"));
}

export function upsertJob(workspaceRoot, job, env = process.env) {
  writeJobFile(workspaceRoot, job.id, job, env);
  const state = readState(workspaceRoot, env);
  const jobs = [
    job,
    ...state.jobs.filter((entry) => entry?.id !== job.id)
  ].slice(0, 50);
  writeState(workspaceRoot, { jobs }, env);
  return job;
}

export function appendJobLog(workspaceRoot, jobId, message, env = process.env) {
  const file = resolveJobLogFile(workspaceRoot, jobId, env);
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  return file;
}
