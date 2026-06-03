import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempDir } from "./helpers.mjs";
import {
  resolveJobFile,
  resolveJobLogFile,
  resolveJobResultFile,
  resolveStateDir,
  resolveStateRoot,
  writeJobFile,
  readJobFile,
  appendJobLog
} from "../plugins/claude-companion/scripts/lib/state.mjs";

test("resolveStateRoot respects environment priority", () => {
  const companionRoot = makeTempDir("companion-state-");
  const codexRoot = makeTempDir("codex-state-");
  const claudeRoot = makeTempDir("claude-state-");

  assert.equal(resolveStateRoot({
    CLAUDE_COMPANION_STATE_DIR: companionRoot,
    CODEX_PLUGIN_DATA: codexRoot,
    CLAUDE_PLUGIN_DATA: claudeRoot
  }), companionRoot);

  assert.equal(resolveStateRoot({
    CODEX_PLUGIN_DATA: codexRoot,
    CLAUDE_PLUGIN_DATA: claudeRoot
  }), codexRoot);

  assert.equal(resolveStateRoot({
    CLAUDE_PLUGIN_DATA: claudeRoot
  }), claudeRoot);

  assert.equal(resolveStateRoot({}), path.join(os.tmpdir(), "claude-companion"));
});

test("resolveStateDir uses env root and workspace hash", () => {
  const root = makeTempDir("state-root-");
  const left = resolveStateDir("/tmp/workspace-a", { CLAUDE_COMPANION_STATE_DIR: root });
  const right = resolveStateDir("/tmp/workspace-b", { CLAUDE_COMPANION_STATE_DIR: root });
  assert.notEqual(left, right);
  assert.equal(path.dirname(left), root);
});

test("writeJobFile and readJobFile round trip", () => {
  const root = makeTempDir("state-root-");
  const env = { CLAUDE_COMPANION_STATE_DIR: root };
  const file = writeJobFile("/tmp/workspace-a", "job-1", { id: "job-1", status: "running" }, env);
  assert.ok(fs.existsSync(file));
  assert.deepEqual(readJobFile("/tmp/workspace-a", "job-1", env), { id: "job-1", status: "running" });
});

test("appendJobLog appends timestamped lines", () => {
  const root = makeTempDir("state-root-");
  const env = { CLAUDE_COMPANION_STATE_DIR: root };
  const logFile = appendJobLog("/tmp/workspace-a", "job-1", "started", env);
  const body = fs.readFileSync(logFile, "utf8");
  assert.match(body, /started/);
});

test("resolveJobResultFile returns a stable result path", () => {
  const root = makeTempDir("state-root-");
  const env = { CLAUDE_COMPANION_STATE_DIR: root };
  const first = resolveJobResultFile("/tmp/workspace-a", "job-1", env);
  const second = resolveJobResultFile("/tmp/workspace-a", "job-1", env);

  assert.equal(first, second);
  assert.equal(path.basename(first), "job-1.result.json");
  assert.equal(path.dirname(first), path.dirname(appendJobLog("/tmp/workspace-a", "job-1", "started", env)));
});

test("job path helpers reject unsafe job identifiers", () => {
  const root = makeTempDir("state-root-");
  const env = { CLAUDE_COMPANION_STATE_DIR: root };
  const workspaceRoot = "/tmp/workspace-a";
  const unsafeJobIds = ["", "..", "../escape", "job/escape", "job\\escape", "job id", "job:1"];

  for (const jobId of unsafeJobIds) {
    assert.throws(() => resolveJobFile(workspaceRoot, jobId, env), /Invalid job id/);
    assert.throws(() => resolveJobLogFile(workspaceRoot, jobId, env), /Invalid job id/);
    assert.throws(() => resolveJobResultFile(workspaceRoot, jobId, env), /Invalid job id/);
  }
});
