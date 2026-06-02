export function nowIso() {
  return new Date().toISOString();
}

export function createJobRecord({ kind, cwd, workspaceRoot, write, summary = "" }) {
  const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    kind,
    status: "queued",
    phase: "queued",
    pid: null,
    cwd,
    workspaceRoot,
    createdAt: nowIso(),
    startedAt: null,
    completedAt: null,
    summary,
    sessionId: null,
    claudeSessionId: null,
    logFile: null,
    resultFile: null,
    write: Boolean(write),
    touchedFiles: [],
    errorMessage: null
  };
}

export function startJobRecord(job, pid) {
  return { ...job, status: "running", phase: "starting", pid, startedAt: nowIso() };
}

export function completeJobRecord(job, result) {
  return {
    ...job,
    status: result.status,
    phase: result.status === "completed" ? "done" : "failed",
    pid: null,
    completedAt: nowIso(),
    summary: result.summary ?? job.summary,
    touchedFiles: result.touchedFiles ?? job.touchedFiles,
    errorMessage: result.errorMessage ?? null,
    result
  };
}

export function summarizeStatus(jobs) {
  const sorted = [...jobs].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const running = sorted.filter((job) => job.status === "queued" || job.status === "running");
  const latestFinished = sorted.find((job) => job.status !== "queued" && job.status !== "running") ?? null;
  return { running, latestFinished, recent: sorted.filter((job) => job.id !== latestFinished?.id).slice(0, 8) };
}
