import fs from "node:fs";
import path from "node:path";
import { readStoragePolicy } from "./storage-policy.mjs";
import {
  resolveStateDir,
  resolveStateRoot,
  validateJobId
} from "./state.mjs";

function isActiveStatus(status) {
  return status === "queued" || status === "running";
}

function safeJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function fileMtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function safeEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function stateDirs(stateRoot) {
  if (!fs.existsSync(stateRoot)) {
    return [];
  }
  return safeEntries(stateRoot)
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(stateRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "jobs")) || fs.existsSync(path.join(dir, "state.json")))
    .sort();
}

function jobIdFromArtifact(filename) {
  let jobId = null;
  if (filename.endsWith(".result.json")) {
    jobId = filename.slice(0, -".result.json".length);
  } else if (filename.endsWith(".json")) {
    jobId = filename.slice(0, -".json".length);
  } else if (filename.endsWith(".log")) {
    jobId = filename.slice(0, -".log".length);
  }
  if (!jobId) {
    return null;
  }
  try {
    return validateJobId(jobId);
  } catch {
    return null;
  }
}

function artifactKind(filename) {
  if (filename.endsWith(".result.json")) {
    return "result";
  }
  if (filename.endsWith(".json")) {
    return "job";
  }
  if (filename.endsWith(".log")) {
    return "log";
  }
  return "other";
}

function latestArtifactTime(files) {
  return files.reduce((latest, file) => Math.max(latest, file.mtimeMs), 0);
}

function jobTime(job, files) {
  const parsed = Date.parse(job?.endedAt ?? job?.createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : latestArtifactTime(files);
}

function readWorkspaceState(stateDir) {
  const file = path.join(stateDir, "state.json");
  if (!fs.existsSync(file)) {
    return { version: 1, jobs: [] };
  }
  const parsed = safeJson(file);
  return {
    version: 1,
    jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : []
  };
}

function collectWorkspaceState(stateDir) {
  const jobsDir = path.join(stateDir, "jobs");
  const byId = new Map();
  const addFile = (jobId, file) => {
    if (!byId.has(jobId)) {
      byId.set(jobId, {
        id: jobId,
        files: [],
        bytes: 0,
        job: null,
        status: "completed",
        active: false,
        workspaceRoot: null,
        timeMs: 0
      });
    }
    const entry = byId.get(jobId);
    entry.files.push(file);
    entry.bytes += file.bytes;
  };

  for (const entry of safeEntries(jobsDir)) {
    if (!entry.isFile()) {
      continue;
    }
    const jobId = jobIdFromArtifact(entry.name);
    if (!jobId) {
      continue;
    }
    const file = path.join(jobsDir, entry.name);
    addFile(jobId, {
      path: file,
      kind: artifactKind(entry.name),
      bytes: fileSize(file),
      mtimeMs: fileMtimeMs(file)
    });
  }

  const state = readWorkspaceState(stateDir);
  for (const job of state.jobs) {
    if (!job?.id) {
      continue;
    }
    try {
      validateJobId(job.id);
    } catch {
      continue;
    }
    if (!byId.has(job.id)) {
      byId.set(job.id, {
        id: job.id,
        files: [],
        bytes: 0,
        job,
        status: job.status ?? "completed",
        active: isActiveStatus(job.status),
        workspaceRoot: job.workspaceRoot ?? job.cwd ?? null,
        timeMs: jobTime(job, [])
      });
    } else {
      byId.get(job.id).job = job;
    }
  }

  for (const group of byId.values()) {
    const jobFile = group.files.find((file) => file.kind === "job")?.path;
    const job = jobFile ? safeJson(jobFile) : group.job;
    group.job = job ?? group.job;
    group.status = group.job?.status ?? group.status ?? "completed";
    group.active = isActiveStatus(group.status);
    group.workspaceRoot = group.job?.workspaceRoot ?? group.job?.cwd ?? group.workspaceRoot;
    group.timeMs = jobTime(group.job, group.files);
  }

  const jobs = [...byId.values()].sort((left, right) => {
    const timeDelta = left.timeMs - right.timeMs;
    return timeDelta !== 0 ? timeDelta : left.id.localeCompare(right.id);
  });
  return {
    stateDir,
    workspaceRoot: jobs.find((job) => job.workspaceRoot)?.workspaceRoot ?? null,
    bytes: jobs.reduce((total, job) => total + job.bytes, 0),
    jobs
  };
}

export function collectStorageUsage(stateRoot, env = process.env) {
  const root = stateRoot || resolveStateRoot(env);
  const workspaces = stateDirs(root).map(collectWorkspaceState);
  return {
    stateRoot: root,
    totalBytes: workspaces.reduce((total, workspace) => total + workspace.bytes, 0),
    workspaces
  };
}

function sortedNewestTerminalJobs(jobs) {
  return jobs
    .filter((job) => !job.active)
    .sort((left, right) => {
      const timeDelta = right.timeMs - left.timeMs;
      return timeDelta !== 0 ? timeDelta : right.id.localeCompare(left.id);
    });
}

function workspaceRemovalCandidates(workspace, policy, protectedJobIds) {
  const now = Date.now();
  const candidates = new Map();
  const protectedSelectedJobs = new Set();
  const addCandidate = (job) => {
    if (job.active) {
      return;
    }
    if (protectedJobIds.has(job.id)) {
      protectedSelectedJobs.add(job.id);
      return;
    }
    candidates.set(job.id, job);
  };

  for (const job of workspace.jobs) {
    if (!job.active && job.timeMs > 0 && now - job.timeMs > policy.maxJobAgeMs) {
      addCandidate(job);
    }
  }

  const terminalNewest = sortedNewestTerminalJobs(workspace.jobs);
  for (const job of terminalNewest.slice(policy.maxJobs)) {
    addCandidate(job);
  }

  for (const job of workspace.jobs) {
    if (!job.active && protectedJobIds.has(job.id)) {
      protectedSelectedJobs.add(job.id);
    }
  }

  return {
    candidates: [...candidates.values()].sort((left, right) => {
      const timeDelta = left.timeMs - right.timeMs;
      return timeDelta !== 0 ? timeDelta : left.id.localeCompare(right.id);
    }),
    protectedSelectedJobs: [...protectedSelectedJobs].sort()
  };
}

function removeJobArtifacts(workspace, jobs, dryRun) {
  const removedFiles = [];
  let removedBytes = 0;
  for (const job of jobs) {
    for (const file of job.files) {
      removedFiles.push(file.path);
      removedBytes += file.bytes;
      if (!dryRun) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // Concurrent cleanup can remove the file first; report intent and continue.
        }
      }
    }
  }
  if (!dryRun && jobs.length) {
    const removedIds = new Set(jobs.map((job) => job.id));
    const state = readWorkspaceState(workspace.stateDir);
    const remainingJobs = state.jobs.filter((job) => !removedIds.has(job?.id));
    writeStateFileByStateDir(workspace.stateDir, { version: 1, jobs: remainingJobs });
  }
  return { removedFiles, removedBytes };
}

function writeStateFileByStateDir(stateDir, state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, "state.json");
  const tmp = path.join(stateDir, `.state.json.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({
    version: 1,
    jobs: Array.isArray(state.jobs) ? state.jobs : []
  }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function emptyPruneReport({ stateRoot, stateDir = null, workspaceRoot = null, dryRun = false }) {
  return {
    stateRoot,
    stateDir,
    workspaceRoot,
    dryRun,
    beforeBytes: 0,
    afterBytes: 0,
    removedBytes: 0,
    removedFiles: [],
    protectedActiveJobs: [],
    protectedSelectedJobs: [],
    truncated: false,
    warnings: []
  };
}

export function pruneWorkspaceState(workspaceRoot, options = {}) {
  const env = options.env ?? process.env;
  const policy = readStoragePolicy(env);
  const stateRoot = resolveStateRoot(env);
  const stateDir = options.stateDir ?? resolveStateDir(workspaceRoot, env);
  if (!fs.existsSync(stateDir)) {
    return emptyPruneReport({ stateRoot, stateDir, workspaceRoot, dryRun: Boolean(options.dryRun) });
  }

  const workspace = collectWorkspaceState(stateDir);
  workspace.workspaceRoot = workspace.workspaceRoot ?? workspaceRoot;
  const protectedJobIds = normalizeProtectedJobIds(options.protectedJobIds);
  const { candidates, protectedSelectedJobs } = workspaceRemovalCandidates(workspace, policy, protectedJobIds);
  const removed = removeJobArtifacts(workspace, candidates, Boolean(options.dryRun));
  return {
    stateRoot,
    stateDir,
    workspaceRoot: workspace.workspaceRoot,
    dryRun: Boolean(options.dryRun),
    beforeBytes: workspace.bytes,
    afterBytes: workspace.bytes - removed.removedBytes,
    removedBytes: removed.removedBytes,
    removedFiles: removed.removedFiles,
    protectedActiveJobs: workspace.jobs.filter((job) => job.active).map((job) => job.id).sort(),
    protectedSelectedJobs,
    truncated: false,
    warnings: []
  };
}

function normalizeProtectedJobIds(value) {
  if (!value) {
    return new Set();
  }
  if (value instanceof Set) {
    return new Set([...value].map((entry) => String(entry)));
  }
  if (Array.isArray(value)) {
    return new Set(value.map((entry) => String(entry)));
  }
  return new Set([String(value)]);
}

function quotaCandidates(usage, protectedJobIds) {
  const protectedSelectedJobs = new Set();
  const jobs = [];
  for (const workspace of usage.workspaces) {
    for (const job of workspace.jobs) {
      if (job.active) {
        continue;
      }
      if (protectedJobIds.has(job.id)) {
        protectedSelectedJobs.add(job.id);
        continue;
      }
      jobs.push({ ...job, stateDir: workspace.stateDir });
    }
  }
  jobs.sort((left, right) => {
    const timeDelta = left.timeMs - right.timeMs;
    return timeDelta !== 0 ? timeDelta : left.id.localeCompare(right.id);
  });
  return { jobs, protectedSelectedJobs: [...protectedSelectedJobs].sort() };
}

export function pruneStateRoot(options = {}) {
  const env = options.env ?? process.env;
  const policy = readStoragePolicy(env);
  const stateRoot = options.stateRoot ?? resolveStateRoot(env);
  const usage = collectStorageUsage(stateRoot, env);
  const protectedJobIds = normalizeProtectedJobIds(options.protectedJobIds);
  const { jobs, protectedSelectedJobs } = quotaCandidates(usage, protectedJobIds);
  const toRemove = [];
  let afterBytes = usage.totalBytes;
  for (const job of jobs) {
    if (afterBytes <= policy.maxStateBytes) {
      break;
    }
    toRemove.push(job);
    afterBytes -= job.bytes;
  }

  const workspacesByDir = new Map(usage.workspaces.map((workspace) => [workspace.stateDir, workspace]));
  const removedFiles = [];
  let removedBytes = 0;
  for (const job of toRemove) {
    const workspace = workspacesByDir.get(job.stateDir);
    if (!workspace) {
      continue;
    }
    const removed = removeJobArtifacts(workspace, [job], Boolean(options.dryRun));
    removedFiles.push(...removed.removedFiles);
    removedBytes += removed.removedBytes;
  }

  const activeJobs = usage.workspaces
    .flatMap((workspace) => workspace.jobs)
    .filter((job) => job.active)
    .map((job) => job.id)
    .sort();
  const warnings = [];
  if (usage.totalBytes - removedBytes > policy.maxStateBytes) {
    warnings.push("Storage quota remains exceeded because active or protected jobs could not be pruned.");
  }

  return {
    stateRoot,
    stateDir: null,
    workspaceRoot: null,
    dryRun: Boolean(options.dryRun),
    beforeBytes: usage.totalBytes,
    afterBytes: usage.totalBytes - removedBytes,
    removedBytes,
    removedFiles,
    protectedActiveJobs: activeJobs,
    protectedSelectedJobs,
    truncated: false,
    warnings
  };
}

export function formatStorageReport(report) {
  const lines = [
    `State root: ${report.stateRoot}`,
    `Before: ${report.beforeBytes} bytes`,
    `After: ${report.afterBytes} bytes`,
    `Removed: ${report.removedBytes} bytes in ${report.removedFiles.length} file(s)`,
    report.dryRun ? "Mode: dry-run" : ""
  ].filter(Boolean);
  if (report.warnings?.length) {
    lines.push("", "Warnings:", ...report.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}
