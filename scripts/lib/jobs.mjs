import { resolveJobLogFile, resolveJobResultFile } from "./state.mjs";

const ALLOWED_JOB_KINDS = new Set(["plan", "review", "adversarial-review", "rescue"]);

export function validateJobKind(kind) {
  if (typeof kind !== "string" || !ALLOWED_JOB_KINDS.has(kind)) {
    throw new Error(`Invalid job kind: ${kind}`);
  }
  return kind;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createJobRecord({
  kind,
  cwd,
  workspaceRoot,
  command = null,
  args = [],
  write,
  summary = "",
  env = process.env
}) {
  const safeKind = validateJobKind(kind);
  const id = `${safeKind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const logPath = workspaceRoot ? resolveJobLogFile(workspaceRoot, id, env) : null;
  const resultPath = workspaceRoot ? resolveJobResultFile(workspaceRoot, id, env) : null;
  return {
    id,
    kind: safeKind,
    status: "queued",
    cwd,
    createdAt: nowIso(),
    startedAt: null,
    endedAt: null,
    pid: null,
    command,
    args: [...args],
    logPath,
    resultPath,
    error: null,
    phase: "queued",
    workspaceRoot: workspaceRoot ?? null,
    summary,
    sessionId: null,
    claudeSessionId: null,
    write: Boolean(write),
    touchedFiles: []
  };
}

export function startJobRecord(job, pid) {
  return { ...job, status: "running", phase: "starting", pid, startedAt: nowIso() };
}

export function completeJobRecord(job, result) {
  const status = result.status;
  return {
    ...job,
    status,
    phase: result.phase ?? (status === "completed" ? "done" : status),
    pid: null,
    endedAt: nowIso(),
    summary: result.summary ?? job.summary,
    touchedFiles: result.touchedFiles ?? job.touchedFiles,
    error: result.error ?? result.errorMessage ?? null,
    result
  };
}

export function summarizeStatus(jobs) {
  const sorted = [...jobs].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const running = sorted.filter((job) => job.status === "queued" || job.status === "running");
  const latestFinished = sorted.find((job) => job.status !== "queued" && job.status !== "running") ?? null;
  return { running, latestFinished, recent: sorted.filter((job) => job.id !== latestFinished?.id).slice(0, 8) };
}
