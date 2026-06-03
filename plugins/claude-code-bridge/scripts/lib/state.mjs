import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStoragePolicy } from "./storage-policy.mjs";

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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function byteLength(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function jsonFileByteLength(payload) {
  return byteLength(`${JSON.stringify(payload, null, 2)}\n`);
}

function utf8Prefix(value, maxBytes) {
  if (maxBytes <= 0) {
    return "";
  }
  const chars = Array.from(String(value));
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (byteLength(chars.slice(0, mid).join("")) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return chars.slice(0, low).join("");
}

function utf8Suffix(value, maxBytes) {
  if (maxBytes <= 0) {
    return "";
  }
  const chars = Array.from(String(value));
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (byteLength(chars.slice(chars.length - mid).join("")) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return chars.slice(chars.length - low).join("");
}

function truncateUtf8Tail(value, maxBytes, marker) {
  const text = String(value);
  const originalBytes = byteLength(text);
  if (originalBytes <= maxBytes) {
    return { value: text, omittedBytes: 0 };
  }
  const markerBytes = byteLength(marker);
  if (markerBytes >= maxBytes) {
    return {
      value: utf8Suffix(marker, maxBytes),
      omittedBytes: originalBytes
    };
  }
  const tail = utf8Suffix(text, maxBytes - markerBytes);
  return {
    value: `${marker}${tail}`,
    omittedBytes: originalBytes - byteLength(tail)
  };
}

function truncateUtf8Middle(value, maxBytes) {
  const text = String(value);
  const originalBytes = byteLength(text);
  if (originalBytes <= maxBytes) {
    return { value: text, omittedBytes: 0 };
  }

  let omittedBytes = originalBytes - maxBytes;
  let marker = "";
  let contentBudget = 0;
  let head = "";
  let tail = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    marker = `\n\n[storage] output truncated; omitted ${omittedBytes} bytes\n\n`;
    const markerBytes = byteLength(marker);
    if (markerBytes >= maxBytes) {
      return {
        value: utf8Suffix(marker, maxBytes),
        omittedBytes: originalBytes
      };
    }
    contentBudget = maxBytes - markerBytes;
    const headBudget = Math.floor(contentBudget / 2);
    const tailBudget = contentBudget - headBudget;
    head = utf8Prefix(text, headBudget);
    tail = utf8Suffix(text, tailBudget);
    const nextOmittedBytes = originalBytes - byteLength(head) - byteLength(tail);
    if (nextOmittedBytes === omittedBytes) {
      break;
    }
    omittedBytes = nextOmittedBytes;
  }

  return {
    value: `${head}${marker}${tail}`,
    omittedBytes
  };
}

function storageMetadata(payload, updates) {
  const metadata = isPlainObject(payload.metadata) ? cloneJson(payload.metadata) : {};
  metadata.storage = {
    ...(isPlainObject(metadata.storage) ? metadata.storage : {}),
    ...updates
  };
  return metadata;
}

function resultStatus(value) {
  const status = typeof value === "string" && value ? value : "failed";
  return ["completed", "failed", "cancelled", "running", "queued"].includes(status) ? status : "failed";
}

function compactString(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value).trim() || fallback;
}

function minimalStorageFallbackResult(payload, policy, omittedBytes) {
  const source = isPlainObject(payload) ? payload : {};
  const kind = compactString(source.kind, "plan");
  const status = resultStatus(source.status);
  const summary = utf8Prefix(compactString(source.summary, "Stored result exceeded storage limits."), 160);
  const metadata = storageMetadata(source, {
    truncated: true,
    fallback: true,
    omittedBytes,
    maxResultBytes: policy.maxResultBytes,
    maxResultTextBytes: policy.maxResultTextBytes
  });
  const result = {
    kind,
    status,
    summary,
    rawOutput: "",
    rendered: [
      `# ${kind}`,
      "",
      `Status: ${status}`,
      summary ? `Summary: ${summary}` : "",
      "",
      `[storage] Full result exceeded ${policy.maxResultBytes} bytes; stored compact fallback.`
    ].filter(Boolean).join("\n"),
    findings: [],
    actions: [],
    touchedFiles: [],
    sessionId: source.sessionId ?? source.claudeSessionId ?? null,
    error: source.error ?? null,
    metadata
  };

  if (jsonFileByteLength(result) <= policy.maxResultBytes) {
    return result;
  }
  result.rendered = utf8Prefix(result.rendered, Math.max(0, Math.floor(policy.maxResultBytes / 3)));
  result.summary = utf8Prefix(result.summary, 80);
  return result;
}

function truncateResultPayload(payload, policy) {
  const result = isPlainObject(payload) ? cloneJson(payload) : { rawOutput: String(payload ?? "") };
  const truncatedFields = [];
  let omittedBytes = 0;
  for (const field of ["rawOutput", "rendered", "text"]) {
    if (typeof result[field] !== "string") {
      continue;
    }
    const truncated = truncateUtf8Middle(result[field], policy.maxResultTextBytes);
    if (truncated.omittedBytes > 0) {
      result[field] = truncated.value;
      truncatedFields.push(field);
      omittedBytes += truncated.omittedBytes;
    }
  }

  if (truncatedFields.length) {
    result.metadata = storageMetadata(result, {
      truncated: true,
      truncatedFields,
      omittedBytes,
      maxResultBytes: policy.maxResultBytes,
      maxResultTextBytes: policy.maxResultTextBytes
    });
  }

  const bytesAfterKnownFieldTruncation = jsonFileByteLength(result);
  if (bytesAfterKnownFieldTruncation <= policy.maxResultBytes) {
    return result;
  }

  return minimalStorageFallbackResult(result, policy, bytesAfterKnownFieldTruncation - policy.maxResultBytes);
}

function truncateJobPayload(payload, policy) {
  if (!isPlainObject(payload) || !isPlainObject(payload.result)) {
    return payload;
  }
  return {
    ...cloneJson(payload),
    result: truncateResultPayload(payload.result, policy)
  };
}

function rotateLogFile(file, policy) {
  if (!fs.existsSync(file)) {
    return;
  }
  const size = fs.statSync(file).size;
  if (size <= policy.maxLogBytes) {
    return;
  }
  const body = fs.readFileSync(file, "utf8");
  const marker = "[storage] previous log output truncated\n";
  const truncated = truncateUtf8Tail(body, policy.maxLogBytes, marker);
  fs.writeFileSync(file, truncated.value, "utf8");
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
  return writeJsonFileAtomic(
    resolveJobFile(workspaceRoot, jobId, env),
    truncateJobPayload(payload, readStoragePolicy(env))
  );
}

export function readJobFile(workspaceRoot, jobId, env = process.env) {
  return JSON.parse(fs.readFileSync(resolveJobFile(workspaceRoot, jobId, env), "utf8"));
}

export function writeJobResultFile(workspaceRoot, jobId, payload, env = process.env) {
  return writeJsonFileAtomic(
    resolveJobResultFile(workspaceRoot, jobId, env),
    truncateResultPayload(payload, readStoragePolicy(env))
  );
}

export function readJobResultFile(workspaceRoot, jobId, env = process.env) {
  return JSON.parse(fs.readFileSync(resolveJobResultFile(workspaceRoot, jobId, env), "utf8"));
}

export function listJobFileIds(workspaceRoot, env = process.env) {
  const dir = resolveJobsDir(workspaceRoot, env);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".result.json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter((jobId) => {
      try {
        validateJobId(jobId);
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

export function upsertJob(workspaceRoot, job, env = process.env) {
  const policy = readStoragePolicy(env);
  const storedJob = truncateJobPayload(job, policy);
  writeJobFile(workspaceRoot, job.id, storedJob, env);
  const state = readState(workspaceRoot, env);
  const jobs = [
    storedJob,
    ...state.jobs.filter((entry) => entry?.id !== job.id)
  ].slice(0, policy.maxJobs);
  writeState(workspaceRoot, { jobs }, env);
  return job;
}

export function appendJobLog(workspaceRoot, jobId, message, env = process.env) {
  const file = resolveJobLogFile(workspaceRoot, jobId, env);
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  rotateLogFile(file, readStoragePolicy(env));
  return file;
}
