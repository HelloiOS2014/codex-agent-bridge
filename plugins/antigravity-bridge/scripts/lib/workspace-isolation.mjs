import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./process.mjs";

const DEFAULT_COPY_EXCLUDES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".build",
  "build",
  "dist",
  "coverage"
]);

function normalizePath(value) {
  return path.resolve(value);
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function git(cwd, args, options = {}) {
  return runCommand("git", ["--no-optional-locks", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      ...(options.env ?? {})
    },
    timeoutMs: options.timeoutMs,
    stdin: options.stdin
  });
}

async function gitStdout(cwd, args, options = {}) {
  const result = await git(cwd, args, options);
  if (result.status !== 0 || result.error) {
    return null;
  }
  return result.stdout.trimEnd();
}

async function getRepoRoot(cwd, options = {}) {
  const stdout = await gitStdout(cwd, ["rev-parse", "--show-toplevel"], options);
  return stdout ? normalizePath(stdout) : null;
}

async function hasHead(repoRoot, options = {}) {
  const stdout = await gitStdout(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"], options);
  return Boolean(stdout);
}

function nulSeparatedPaths(value) {
  return value ? value.split("\0").filter(Boolean) : [];
}

async function gitRawStdout(cwd, args, options = {}) {
  const result = await git(cwd, args, options);
  if (result.status !== 0 || result.error) {
    return null;
  }
  return result.stdout;
}

async function copyUntrackedFiles(repoRoot, snapshotRoot, options = {}) {
  const stdout = await gitRawStdout(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], options);
  for (const relativePath of nulSeparatedPaths(stdout ?? "")) {
    const source = path.resolve(repoRoot, relativePath);
    const destination = path.resolve(snapshotRoot, relativePath);
    if (!isPathInside(repoRoot, source) || !isPathInside(snapshotRoot, destination)) {
      continue;
    }

    let stat;
    try {
      stat = await fs.lstat(source);
    } catch {
      continue;
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(source);
      await fs.symlink(target, destination).catch(async (error) => {
        if (error?.code !== "EEXIST") {
          throw error;
        }
      });
    } else if (stat.isDirectory()) {
      await fs.cp(source, destination, {
        recursive: true,
        dereference: false,
        filter: copyFilter
      });
    } else if (stat.isFile()) {
      await fs.copyFile(source, destination);
    }
  }
}

function copyFilter(source) {
  const basename = path.basename(source);
  return !DEFAULT_COPY_EXCLUDES.has(basename);
}

async function copyDirectorySnapshot(cwd, snapshotRoot) {
  await fs.cp(cwd, snapshotRoot, {
    recursive: true,
    dereference: false,
    filter: copyFilter
  });
}

async function applyTrackedDiff(repoRoot, snapshotRoot, options = {}) {
  const diff = await gitRawStdout(repoRoot, ["diff", "--binary", "HEAD"], options);
  if (!diff) {
    return;
  }

  const result = await git(snapshotRoot, ["apply", "--whitespace=nowarn", "--index", "-"], {
    ...options,
    stdin: diff
  });
  if (result.status !== 0 || result.error) {
    const fallback = await git(snapshotRoot, ["apply", "--whitespace=nowarn", "-"], {
      ...options,
      stdin: diff
    });
    if (fallback.status !== 0 || fallback.error) {
      throw new Error(`Failed to apply working tree diff to Antigravity isolated workspace: ${fallback.stderr || fallback.error?.message || "git apply failed"}`);
    }
  }
}

async function runCheckedGit(cwd, args, options = {}) {
  const result = await git(cwd, args, options);
  if (result.status === 0 && !result.error) {
    return result;
  }
  throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message || "unknown error"}`);
}

export function assertIsolatedSnapshotRoot(snapshotRoot, originalRepoRoot) {
  if (!originalRepoRoot) {
    return;
  }
  if (normalizePath(snapshotRoot) === normalizePath(originalRepoRoot)) {
    throw new Error("Antigravity isolated snapshot root must not equal original repository root.");
  }
}

async function commitIsolationBaseline(snapshotRoot, options = {}) {
  assertIsolatedSnapshotRoot(snapshotRoot, options.originalRepoRoot);
  await runCheckedGit(snapshotRoot, ["config", "user.email", "antigravity-bridge@example.invalid"], options);
  await runCheckedGit(snapshotRoot, ["config", "user.name", "Antigravity Bridge"], options);
  await runCheckedGit(snapshotRoot, ["add", "-A", "-f"], options);
  await runCheckedGit(snapshotRoot, ["commit", "--allow-empty", "-m", "antigravity bridge isolated baseline"], options);
}

async function prepareGitSnapshot(originalCwd, repoRoot, tempRoot, options = {}) {
  const snapshotRoot = path.join(tempRoot, "workspace");
  await runCheckedGit(path.dirname(snapshotRoot), ["clone", "--quiet", "--no-local", repoRoot, snapshotRoot], options);
  await applyTrackedDiff(repoRoot, snapshotRoot, options);
  await copyUntrackedFiles(repoRoot, snapshotRoot, options);
  await commitIsolationBaseline(snapshotRoot, { ...options, originalRepoRoot: repoRoot });

  const relativeCwd = path.relative(repoRoot, originalCwd);
  const isolatedCwd = relativeCwd ? path.resolve(snapshotRoot, relativeCwd) : snapshotRoot;
  await fs.mkdir(isolatedCwd, { recursive: true });

  return {
    kind: "git-snapshot",
    originalCwd,
    originalRepoRoot: repoRoot,
    snapshotRoot,
    isolatedCwd,
    relativeCwd
  };
}

async function prepareDirectorySnapshot(originalCwd, tempRoot) {
  const snapshotRoot = path.join(tempRoot, "workspace");
  await fs.mkdir(snapshotRoot, { recursive: true });
  await copyDirectorySnapshot(originalCwd, snapshotRoot);
  await runCheckedGit(snapshotRoot, ["init", "-q"]);
  await commitIsolationBaseline(snapshotRoot);
  return {
    kind: "directory-snapshot",
    originalCwd,
    originalRepoRoot: null,
    snapshotRoot,
    isolatedCwd: snapshotRoot,
    relativeCwd: ""
  };
}

async function prepareScratchWorkspace(originalCwd, tempRoot) {
  const snapshotRoot = path.join(tempRoot, "scratch");
  await fs.mkdir(snapshotRoot, { recursive: true });
  await runCheckedGit(snapshotRoot, ["init", "-q"]);
  await commitIsolationBaseline(snapshotRoot);
  return {
    kind: "scratch",
    originalCwd,
    originalRepoRoot: null,
    snapshotRoot,
    isolatedCwd: snapshotRoot,
    relativeCwd: ""
  };
}

function parseStatusPath(line) {
  const body = line.slice(3).trim();
  if (!body) {
    return "";
  }
  const renameArrow = " -> ";
  if (body.includes(renameArrow)) {
    return body.slice(body.lastIndexOf(renameArrow) + renameArrow.length).trim();
  }
  return body.replace(/^"|"$/g, "");
}

export async function collectGitTouchedFiles(cwd, options = {}) {
  const repoRoot = await getRepoRoot(cwd, options);
  if (!repoRoot) {
    return [];
  }
  const statusArgs = ["status", "--short", "--untracked-files=all"];
  if (options.includeIgnored) {
    statusArgs.push("--ignored");
  }
  const status = await gitStdout(repoRoot, statusArgs, options);
  if (!status) {
    return [];
  }
  return [...new Set(status.split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseStatusPath)
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export async function prepareIsolatedWorkspace(cwd, options = {}) {
  const originalCwd = normalizePath(cwd);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-companion-readonly-"));
  const includeWorkspace = options.includeWorkspace !== false;

  try {
    if (!includeWorkspace) {
      return await prepareScratchWorkspace(originalCwd, tempRoot);
    }

    const repoRoot = await getRepoRoot(originalCwd, options);
    if (repoRoot && await hasHead(repoRoot, options)) {
      return await prepareGitSnapshot(originalCwd, repoRoot, tempRoot, options);
    }

    return await prepareDirectorySnapshot(originalCwd, tempRoot);
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function removeIsolatedWorkspace(isolation) {
  if (!isolation?.snapshotRoot) {
    return;
  }
  const tempRoot = path.dirname(isolation.snapshotRoot);
  await fs.rm(tempRoot, { recursive: true, force: true });
}

export function isolationMetadata(isolation, audit = {}) {
  return {
    antigravityIsolation: {
      kind: isolation.kind,
      originalCwd: isolation.originalCwd,
      originalRepoRoot: isolation.originalRepoRoot,
      isolatedCwd: isolation.isolatedCwd,
      snapshotRoot: isolation.snapshotRoot,
      readOnlyViolation: Boolean(audit.readOnlyViolation),
      touchedFiles: audit.touchedFiles ?? []
    }
  };
}
