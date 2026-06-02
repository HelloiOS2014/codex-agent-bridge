import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function slug(value) {
  return String(value || "workspace").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

export function resolveStateRoot(env = process.env) {
  return env.CLAUDE_COMPANION_STATE_DIR || env.CODEX_PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "claude-companion");
}

export function resolveStateDir(workspaceRoot, env = process.env) {
  const real = fs.existsSync(workspaceRoot) ? fs.realpathSync.native(workspaceRoot) : workspaceRoot;
  const hash = crypto.createHash("sha256").update(real).digest("hex").slice(0, 16);
  return path.join(resolveStateRoot(env), `${slug(path.basename(workspaceRoot))}-${hash}`);
}

export function resolveJobsDir(workspaceRoot, env = process.env) {
  return path.join(resolveStateDir(workspaceRoot, env), "jobs");
}

export function ensureJobsDir(workspaceRoot, env = process.env) {
  const dir = resolveJobsDir(workspaceRoot, env);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveJobFile(workspaceRoot, jobId, env = process.env) {
  return path.join(ensureJobsDir(workspaceRoot, env), `${jobId}.json`);
}

export function resolveJobLogFile(workspaceRoot, jobId, env = process.env) {
  return path.join(ensureJobsDir(workspaceRoot, env), `${jobId}.log`);
}

export function writeJobFile(workspaceRoot, jobId, payload, env = process.env) {
  const file = resolveJobFile(workspaceRoot, jobId, env);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

export function readJobFile(workspaceRoot, jobId, env = process.env) {
  return JSON.parse(fs.readFileSync(resolveJobFile(workspaceRoot, jobId, env), "utf8"));
}

export function appendJobLog(workspaceRoot, jobId, message, env = process.env) {
  const file = resolveJobLogFile(workspaceRoot, jobId, env);
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  return file;
}
