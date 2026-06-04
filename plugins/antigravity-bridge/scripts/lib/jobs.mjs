import { resolveJobLogFile, resolveJobResultFile, validateJobId } from "./state.mjs";

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
    agySessionId: null,
    write: Boolean(write),
    touchedFiles: []
  };
}

export function startJobRecord(job, pid) {
  return { ...job, status: "running", phase: "running", pid, startedAt: nowIso() };
}

export function completeJobRecord(job, result) {
  const status = result.status;
  const sessionId = result.sessionId ?? result.agySessionId ?? job.sessionId ?? null;
  return {
    ...job,
    status,
    phase: result.phase ?? (status === "completed" ? "done" : status),
    pid: null,
    endedAt: nowIso(),
    summary: result.summary ?? job.summary,
    sessionId,
    agySessionId: sessionId,
    touchedFiles: result.touchedFiles ?? job.touchedFiles,
    error: result.error ?? result.errorMessage ?? null,
    result
  };
}

export function isActiveJob(job) {
  return job?.status === "queued" || job?.status === "running";
}

export function findJob(jobs, reference) {
  const safeReference = validateJobId(reference);
  const exact = jobs.find((job) => job?.id === safeReference);
  if (exact) {
    return exact;
  }
  const matches = jobs.filter((job) => typeof job?.id === "string" && job.id.startsWith(safeReference));
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new Error(`Job reference "${safeReference}" is ambiguous.`);
  }
  throw new Error(`No job found for "${safeReference}".`);
}

export function compareJobsByLatestActivity(left, right) {
  const leftTime = left?.endedAt ?? left?.createdAt ?? "";
  const rightTime = right?.endedAt ?? right?.createdAt ?? "";
  const timeOrder = String(rightTime).localeCompare(String(leftTime));
  if (timeOrder !== 0) {
    return timeOrder;
  }
  return String(right?.id ?? "").localeCompare(String(left?.id ?? ""));
}

export function summarizeStatus(jobs) {
  const sorted = [...jobs].sort(compareJobsByLatestActivity);
  const running = sorted.filter(isActiveJob);
  const latestFinished = sorted.find((job) => !isActiveJob(job)) ?? null;
  return { running, latestFinished, recent: sorted.filter((job) => job.id !== latestFinished?.id).slice(0, 8) };
}
