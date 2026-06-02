import path from "node:path";
import { runCommand } from "./process.mjs";

export const DEFAULT_MAX_DIFF_BYTES = 256 * 1024;

function cleanLines(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
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
  const limit = Number.isFinite(maxBytes) && maxBytes >= 0 ? Math.floor(maxBytes) : DEFAULT_MAX_DIFF_BYTES;
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
        maxDiffBytes: options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
        originalDiffBytes: 0,
        omittedDiffBytes: 0
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
  const fullDiffRaw = formatFullDiff(diffParts);
  const maxDiffBytes = options.maxDiffBytes ?? options.maxDiffChars ?? DEFAULT_MAX_DIFF_BYTES;
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
      omittedDiffBytes: truncatedDiff.omittedBytes
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
