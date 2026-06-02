import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./process.mjs";

export const DEFAULT_MAX_DIFF_BYTES = 256 * 1024;
export const DEFAULT_MAX_UNTRACKED_FILE_BYTES = 32 * 1024;
const BINARY_SAMPLE_BYTES = 8192;

function cleanLines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function byteLimit(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

async function git(cwd, args) {
  return runCommand("git", args, { cwd });
}

async function gitStdout(cwd, args) {
  const result = await git(cwd, args);
  if (result.status !== 0 || result.error) {
    return null;
  }
  return result.stdout.trimEnd();
}

async function gitLines(cwd, args) {
  const stdout = await gitStdout(cwd, args);
  return stdout ? cleanLines(stdout) : [];
}

async function getRepoRoot(cwd) {
  const stdout = await gitStdout(cwd, ["rev-parse", "--show-toplevel"]);
  return stdout ? path.resolve(stdout) : null;
}

async function resolveCommit(cwd, ref) {
  const stdout = await gitStdout(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return stdout || null;
}

function emptyBaseline(source = "none") {
  return {
    ref: null,
    commit: null,
    source,
    available: false
  };
}

export async function resolveBaselineRef(cwd, options = {}) {
  const repoRoot = await getRepoRoot(path.resolve(cwd));
  if (!repoRoot) {
    return emptyBaseline("non-git");
  }

  const explicitRef = options.against ?? options.base ?? null;
  if (explicitRef) {
    const commit = await resolveCommit(repoRoot, explicitRef);
    return {
      ref: explicitRef,
      commit,
      source: "explicit",
      available: Boolean(commit)
    };
  }

  const mergeBase = await gitStdout(repoRoot, ["merge-base", "HEAD", "origin/main"]);
  if (mergeBase) {
    return {
      ref: "origin/main",
      commit: mergeBase,
      source: "origin-main-merge-base",
      available: true
    };
  }

  const headParent = await resolveCommit(repoRoot, "HEAD~1");
  if (headParent) {
    return {
      ref: "HEAD~1",
      commit: headParent,
      source: "head-parent",
      available: true
    };
  }

  return emptyBaseline();
}

export async function isGitRepository(cwd) {
  return Boolean(await getRepoRoot(path.resolve(cwd)));
}

async function getCurrentBranch(repoRoot) {
  const branch = await gitStdout(repoRoot, ["branch", "--show-current"]);
  if (branch) {
    return branch;
  }
  const head = await gitStdout(repoRoot, ["rev-parse", "--short", "HEAD"]);
  return head ? `HEAD detached at ${head}` : null;
}

function detail(source, filePath, status = null) {
  return { path: filePath, source, status };
}

async function getChangedFileDetails(repoRoot, baseline) {
  const baselineFiles = baseline.available
    ? await gitLines(repoRoot, ["diff", "--name-only", `${baseline.commit}..HEAD`])
    : [];
  const stagedFiles = await gitLines(repoRoot, ["diff", "--cached", "--name-only"]);
  const unstagedFiles = await gitLines(repoRoot, ["diff", "--name-only"]);
  const untrackedFiles = await gitLines(repoRoot, ["ls-files", "--others", "--exclude-standard"]);

  return [
    ...baselineFiles.map((file) => detail("baseline", file)),
    ...stagedFiles.map((file) => detail("staged", file)),
    ...unstagedFiles.map((file) => detail("unstaged", file)),
    ...untrackedFiles.map((file) => detail("untracked", file))
  ];
}

async function getDiffParts(repoRoot, baseline) {
  const parts = [];

  if (baseline.available) {
    const baselineSummary = await gitStdout(repoRoot, ["diff", "--shortstat", `${baseline.commit}..HEAD`]);
    const baselineDiff = await gitStdout(repoRoot, [
      "diff",
      "--no-ext-diff",
      "--submodule=diff",
      `${baseline.commit}..HEAD`
    ]);
    if (baselineSummary || baselineDiff) {
      parts.push({
        title: `Baseline Diff (${baseline.ref})`,
        summary: baselineSummary || "",
        diff: baselineDiff || ""
      });
    }
  }

  const stagedSummary = await gitStdout(repoRoot, ["diff", "--cached", "--shortstat"]);
  const stagedDiff = await gitStdout(repoRoot, ["diff", "--cached", "--no-ext-diff", "--submodule=diff"]);
  if (stagedSummary || stagedDiff) {
    parts.push({
      title: "Staged Diff",
      summary: stagedSummary || "",
      diff: stagedDiff || ""
    });
  }

  const unstagedSummary = await gitStdout(repoRoot, ["diff", "--shortstat"]);
  const unstagedDiff = await gitStdout(repoRoot, ["diff", "--no-ext-diff", "--submodule=diff"]);
  if (unstagedSummary || unstagedDiff) {
    parts.push({
      title: "Unstaged Diff",
      summary: unstagedSummary || "",
      diff: unstagedDiff || ""
    });
  }

  return parts;
}

function formatDiffSummary(parts) {
  return parts
    .filter((part) => part.summary)
    .map((part) => `${part.title}: ${part.summary}`)
    .join("\n");
}

function formatFullDiff(parts) {
  return parts
    .map((part) => {
      const body = part.diff || "(none)";
      return [`## ${part.title}`, body].join("\n");
    })
    .join("\n\n");
}

function truncateByBytes(value, maxBytes) {
  const limit = byteLimit(maxBytes, DEFAULT_MAX_DIFF_BYTES);
  const buffer = Buffer.from(value, "utf8");
  const originalBytes = buffer.byteLength;
  if (originalBytes <= limit) {
    return {
      value,
      truncated: false,
      originalBytes,
      omittedBytes: 0
    };
  }

  let truncated = buffer.subarray(0, limit).toString("utf8");
  while (Buffer.byteLength(truncated, "utf8") > limit) {
    truncated = truncated.slice(0, -1);
  }
  return {
    value: truncated,
    truncated: true,
    originalBytes,
    omittedBytes: originalBytes - Buffer.byteLength(truncated, "utf8")
  };
}

function emptyUntrackedFileMetadata(maxFileBytes) {
  return {
    maxFileBytes,
    included: [],
    skipped: []
  };
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveRepoFilePath(repoRoot, relativePath) {
  if (path.isAbsolute(relativePath)) {
    return null;
  }

  const absolutePath = path.resolve(repoRoot, relativePath);
  return isPathInside(repoRoot, absolutePath) ? absolutePath : null;
}

async function readFilePrefix(filePath, maxBytes) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isLikelyBinary(buffer) {
  if (buffer.includes(0)) {
    return true;
  }

  let suspiciousBytes = 0;
  for (const byte of buffer) {
    const isAllowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (byte < 0x20 && !isAllowedControl) {
      suspiciousBytes += 1;
    }
  }

  return buffer.length > 0 && suspiciousBytes / buffer.length > 0.3;
}

function skipReasonText(reason) {
  switch (reason) {
    case "directory":
      return "directory";
    case "likely-binary":
      return "likely binary";
    case "outside-repo":
      return "outside repo";
    case "symlink":
      return "symlink";
    case "not-regular-file":
      return "not a regular file";
    case "unreadable":
      return "unreadable";
    default:
      return reason;
  }
}

function skippedUntrackedEntry(filePath, reason, bytes = null) {
  const byteText = typeof bytes === "number" ? `; ${bytes} bytes` : "";
  return [`### ${filePath}`, `(skipped: ${skipReasonText(reason)}${byteText})`].join("\n");
}

function includedUntrackedEntry(filePath, content, maxFileBytes, truncated, omittedBytes) {
  const lines = [`### ${filePath}`, content || "(empty)"];
  if (truncated) {
    lines.push(`(truncated at ${maxFileBytes} bytes; omitted ${omittedBytes} bytes)`);
  }
  return lines.join("\n");
}

async function getUntrackedFileContext(repoRoot, changedFileDetails, options = {}) {
  const maxFileBytes = byteLimit(options.maxUntrackedFileBytes, DEFAULT_MAX_UNTRACKED_FILE_BYTES);
  const metadata = emptyUntrackedFileMetadata(maxFileBytes);
  const entries = [];
  const untrackedPaths = unique(
    changedFileDetails
      .filter((file) => file.source === "untracked")
      .map((file) => file.path)
  ).sort();

  for (const filePath of untrackedPaths) {
    const absolutePath = resolveRepoFilePath(repoRoot, filePath);
    if (!absolutePath) {
      metadata.skipped.push({ path: filePath, reason: "outside-repo" });
      entries.push(skippedUntrackedEntry(filePath, "outside-repo"));
      continue;
    }

    let stats;
    try {
      stats = await fs.lstat(absolutePath);
    } catch {
      metadata.skipped.push({ path: filePath, reason: "unreadable" });
      entries.push(skippedUntrackedEntry(filePath, "unreadable"));
      continue;
    }

    if (stats.isDirectory()) {
      metadata.skipped.push({ path: filePath, reason: "directory", bytes: stats.size });
      entries.push(skippedUntrackedEntry(filePath, "directory", stats.size));
      continue;
    }

    if (stats.isSymbolicLink()) {
      metadata.skipped.push({ path: filePath, reason: "symlink", bytes: stats.size });
      entries.push(skippedUntrackedEntry(filePath, "symlink", stats.size));
      continue;
    }

    if (!stats.isFile()) {
      metadata.skipped.push({ path: filePath, reason: "not-regular-file", bytes: stats.size });
      entries.push(skippedUntrackedEntry(filePath, "not-regular-file", stats.size));
      continue;
    }

    const sampleBytes = Math.min(stats.size, Math.max(maxFileBytes, BINARY_SAMPLE_BYTES));
    const sample = sampleBytes > 0 ? await readFilePrefix(absolutePath, sampleBytes) : Buffer.alloc(0);
    if (isLikelyBinary(sample)) {
      metadata.skipped.push({ path: filePath, reason: "likely-binary", bytes: stats.size });
      entries.push(skippedUntrackedEntry(filePath, "likely-binary", stats.size));
      continue;
    }

    const contentBytes = Math.min(sample.length, maxFileBytes);
    const contentBuffer = sample.subarray(0, contentBytes);
    const truncatedContent = truncateByBytes(contentBuffer.toString("utf8"), maxFileBytes);
    const includedBytes = Buffer.byteLength(truncatedContent.value, "utf8");
    const omittedBytes = Math.max(0, stats.size - includedBytes);
    const truncated = omittedBytes > 0;

    metadata.included.push({
      path: filePath,
      bytes: stats.size,
      truncated,
      omittedBytes
    });
    entries.push(includedUntrackedEntry(filePath, truncatedContent.value, maxFileBytes, truncated, omittedBytes));
  }

  const part = entries.length > 0
    ? {
        title: "Untracked Files",
        summary: `${metadata.included.length + metadata.skipped.length} untracked file(s): ${metadata.included.length} included, ${metadata.skipped.length} skipped; per-file cap ${maxFileBytes} bytes`,
        diff: entries.join("\n\n")
      }
    : null;

  return { part, metadata };
}

function formatContent(context) {
  if (!context.isGitRepository) {
    return [
      "## Git Context",
      `CWD: ${context.cwd}`,
      "",
      "This directory is not a git repository."
    ].join("\n");
  }

  return [
    "## Git Context",
    `CWD: ${context.cwd}`,
    `Repo Root: ${context.repoRoot}`,
    "",
    "## Current Branch",
    context.currentBranch || "(unknown)",
    "",
    "## Baseline",
    context.baseline.ref
      ? `${context.baseline.ref} (${context.baseline.source}${context.baseline.available ? "" : ", unavailable"})`
      : "(none)",
    "",
    "## Worktree Status",
    context.worktreeStatus || "(clean)",
    "",
    "## Changed Files",
    context.changedFiles.length > 0 ? context.changedFiles.join("\n") : "(none)",
    "",
    "## Diff Summary",
    context.diffSummary || "(none)",
    "",
    "## Full Diff",
    context.fullDiff || "(none)",
    context.diffTruncated
      ? `\n(diff truncated at ${context.metadata.maxDiffBytes} bytes; omitted ${context.metadata.omittedDiffBytes} bytes)`
      : ""
  ].join("\n");
}

export async function collectReviewContext(cwd, options = {}) {
  const absoluteCwd = path.resolve(cwd);
  const repoRoot = await getRepoRoot(absoluteCwd);
  const maxDiffBytes = options.maxDiffBytes ?? options.maxDiffChars ?? DEFAULT_MAX_DIFF_BYTES;
  const maxUntrackedFileBytes = byteLimit(options.maxUntrackedFileBytes, DEFAULT_MAX_UNTRACKED_FILE_BYTES);

  if (!repoRoot) {
    const context = {
      cwd: absoluteCwd,
      repoRoot: null,
      isGitRepository: false,
      currentBranch: null,
      baseline: emptyBaseline("non-git"),
      worktreeStatus: "",
      changedFiles: [],
      changedFileDetails: [],
      diffSummary: "",
      fullDiff: "",
      diffTruncated: false,
      truncated: false,
      metadata: {
        maxDiffBytes,
        originalDiffBytes: 0,
        omittedDiffBytes: 0,
        untrackedFiles: emptyUntrackedFileMetadata(maxUntrackedFileBytes)
      }
    };
    return { ...context, content: formatContent(context) };
  }

  const baseline = await resolveBaselineRef(repoRoot, options);
  const currentBranch = await getCurrentBranch(repoRoot);
  const worktreeStatus = await gitStdout(repoRoot, ["status", "--short", "--untracked-files=all"]);
  const changedFileDetails = await getChangedFileDetails(repoRoot, baseline);
  const changedFiles = unique(changedFileDetails.map((file) => file.path)).sort();
  const diffParts = await getDiffParts(repoRoot, baseline);
  const untrackedContext = await getUntrackedFileContext(repoRoot, changedFileDetails, {
    maxUntrackedFileBytes
  });
  if (untrackedContext.part) {
    diffParts.push(untrackedContext.part);
  }
  const fullDiffRaw = formatFullDiff(diffParts);
  const truncatedDiff = truncateByBytes(fullDiffRaw, maxDiffBytes);

  const context = {
    cwd: absoluteCwd,
    repoRoot,
    isGitRepository: true,
    currentBranch,
    baseline,
    worktreeStatus: worktreeStatus || "",
    changedFiles,
    changedFileDetails,
    diffSummary: formatDiffSummary(diffParts),
    fullDiff: truncatedDiff.value,
    diffTruncated: truncatedDiff.truncated,
    truncated: truncatedDiff.truncated,
    metadata: {
      maxDiffBytes,
      originalDiffBytes: truncatedDiff.originalBytes,
      omittedDiffBytes: truncatedDiff.omittedBytes,
      untrackedFiles: untrackedContext.metadata
    }
  };

  return { ...context, content: formatContent(context) };
}

export async function resolveReviewTarget(cwd, options = {}) {
  const baseline = await resolveBaselineRef(cwd, options);
  return {
    mode: baseline.available ? "branch" : "working-tree",
    baseline,
    baseRef: baseline.ref,
    label: baseline.ref ? `diff against ${baseline.ref}` : "working tree diff"
  };
}
