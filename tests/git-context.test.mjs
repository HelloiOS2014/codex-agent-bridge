import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir, makeTempGitRepo } from "./helpers.mjs";
import { collectReviewContext, resolveBaselineRef } from "../scripts/lib/git-context.mjs";

async function git(cwd, args) {
  const { runCommand } = await import("../scripts/lib/process.mjs");
  const result = await runCommand("git", args, { cwd });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trimEnd();
}

async function commitFile(cwd, relativePath, content, message) {
  fs.writeFileSync(path.join(cwd, relativePath), content, "utf8");
  await git(cwd, ["add", relativePath]);
  await git(cwd, ["commit", "-m", message]);
}

test("resolveBaselineRef prefers explicit against ref", async () => {
  const cwd = await makeTempGitRepo();
  await commitFile(cwd, "README.md", "initial\nsecond\n", "second");

  const baseline = await resolveBaselineRef(cwd, { against: "HEAD~1" });

  assert.equal(baseline.ref, "HEAD~1");
  assert.equal(baseline.source, "explicit");
  assert.match(baseline.commit, /^[0-9a-f]{40}$/);
});

test("collectReviewContext includes explicit baseline diff and branch", async () => {
  const cwd = await makeTempGitRepo();
  await commitFile(cwd, "README.md", "initial\nsecond\n", "second");

  const context = await collectReviewContext(cwd, { against: "HEAD~1" });

  assert.equal(context.isGitRepository, true);
  assert.equal(context.baseline.ref, "HEAD~1");
  assert.ok(context.currentBranch);
  assert.deepEqual(context.changedFiles, ["README.md"]);
  assert.match(context.diffSummary, /1 file changed/);
  assert.match(context.fullDiff, /\+second/);
  assert.match(context.content, /## Current Branch/);
});

test("collectReviewContext includes staged and unstaged worktree changes", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "staged.txt"), "staged\n", "utf8");
  await git(cwd, ["add", "staged.txt"]);
  fs.writeFileSync(path.join(cwd, "README.md"), "initial\nunstaged\n", "utf8");

  const context = await collectReviewContext(cwd, {});

  assert.match(context.worktreeStatus, /^ M README\.md$/m);
  assert.match(context.worktreeStatus, /^A  staged\.txt$/m);
  assert.deepEqual(new Set(context.changedFiles), new Set(["README.md", "staged.txt"]));
  assert.match(context.fullDiff, /Staged Diff/);
  assert.match(context.fullDiff, /Unstaged Diff/);
  assert.match(context.fullDiff, /\+staged/);
  assert.match(context.fullDiff, /\+unstaged/);
});

test("resolveBaselineRef falls back to HEAD~1 without origin main", async () => {
  const cwd = await makeTempGitRepo();
  await commitFile(cwd, "README.md", "initial\nsecond\n", "second");

  const baseline = await resolveBaselineRef(cwd, {});

  assert.equal(baseline.ref, "HEAD~1");
  assert.equal(baseline.source, "head-parent");
  assert.match(baseline.commit, /^[0-9a-f]{40}$/);
});

test("resolveBaselineRef prefers origin main merge-base before HEAD parent", async () => {
  const cwd = await makeTempGitRepo();
  const originMain = await git(cwd, ["rev-parse", "HEAD"]);
  await git(cwd, ["update-ref", "refs/remotes/origin/main", originMain]);
  await commitFile(cwd, "README.md", "initial\nsecond\n", "second");

  const baseline = await resolveBaselineRef(cwd, {});

  assert.equal(baseline.ref, "origin/main");
  assert.equal(baseline.source, "origin-main-merge-base");
  assert.equal(baseline.commit, originMain);
});

test("collectReviewContext handles non-git directories gracefully", async () => {
  const cwd = makeTempDir("claude-companion-non-git-");

  const context = await collectReviewContext(cwd, {});

  assert.equal(context.isGitRepository, false);
  assert.equal(context.repoRoot, null);
  assert.equal(context.baseline.ref, null);
  assert.deepEqual(context.changedFiles, []);
  assert.match(context.content, /not a git repository/i);
});

test("collectReviewContext truncates full diff within configured cap", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "README.md"), `initial\n${"x".repeat(600)}\n`, "utf8");

  const context = await collectReviewContext(cwd, { maxDiffBytes: 120 });

  assert.equal(context.diffTruncated, true);
  assert.ok(Buffer.byteLength(context.fullDiff, "utf8") <= 120);
  assert.ok(context.metadata.omittedDiffBytes > 0);
  assert.match(context.content, /truncated/i);
});

test("collectReviewContext extracts committed, staged, unstaged, and untracked files", async () => {
  const cwd = await makeTempGitRepo();
  await commitFile(cwd, "committed.txt", "committed\n", "committed");
  fs.writeFileSync(path.join(cwd, "staged.txt"), "staged\n", "utf8");
  await git(cwd, ["add", "staged.txt"]);
  fs.writeFileSync(path.join(cwd, "README.md"), "initial\nunstaged\n", "utf8");
  fs.writeFileSync(path.join(cwd, "untracked.txt"), "untracked\n", "utf8");

  const context = await collectReviewContext(cwd, { against: "HEAD~1" });

  assert.deepEqual(
    new Set(context.changedFiles),
    new Set(["README.md", "committed.txt", "staged.txt", "untracked.txt"])
  );
  assert.deepEqual(
    context.changedFileDetails.map((file) => `${file.source}:${file.path}`).sort(),
    ["baseline:committed.txt", "staged:staged.txt", "unstaged:README.md", "untracked:untracked.txt"]
  );
});

test("collectReviewContext includes untracked text file content in full diff", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "untracked.txt"), "line one\nline two\n", "utf8");

  const context = await collectReviewContext(cwd, {});

  assert.match(context.fullDiff, /## Untracked Files/);
  assert.match(context.fullDiff, /### untracked\.txt/);
  assert.match(context.fullDiff, /line one\nline two/);
  assert.match(context.content, /line one\nline two/);
  assert.deepEqual(context.metadata.untrackedFiles.included, [
    {
      path: "untracked.txt",
      bytes: 18,
      truncated: false,
      omittedBytes: 0
    }
  ]);
});

test("collectReviewContext notes binary untracked files and truncates oversized text", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "binary.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
  fs.writeFileSync(path.join(cwd, "large.txt"), "abcdefghijklmnop\n", "utf8");

  const context = await collectReviewContext(cwd, {
    maxUntrackedFileBytes: 8,
    maxDiffBytes: 1024
  });

  assert.match(context.fullDiff, /### binary\.bin/);
  assert.match(context.fullDiff, /skipped: likely binary/i);
  assert.match(context.fullDiff, /### large\.txt/);
  assert.match(context.fullDiff, /abcdefgh/);
  assert.doesNotMatch(context.fullDiff, /ijklmnop/);
  assert.match(context.fullDiff, /truncated at 8 bytes; omitted 9 bytes/i);
  assert.deepEqual(context.metadata.untrackedFiles.skipped, [
    {
      path: "binary.bin",
      reason: "likely-binary",
      bytes: 4
    }
  ]);
  assert.deepEqual(context.metadata.untrackedFiles.included, [
    {
      path: "large.txt",
      bytes: 17,
      truncated: true,
      omittedBytes: 9
    }
  ]);
});

test("collectReviewContext applies full diff cap to untracked file context", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "large-untracked.txt"), `${"x".repeat(600)}\n`, "utf8");

  const context = await collectReviewContext(cwd, {
    maxUntrackedFileBytes: 600,
    maxDiffBytes: 120
  });

  assert.equal(context.diffTruncated, true);
  assert.ok(Buffer.byteLength(context.fullDiff, "utf8") <= 120);
  assert.ok(context.metadata.omittedDiffBytes > 0);
  assert.match(context.content, /diff truncated at 120 bytes/i);
});
