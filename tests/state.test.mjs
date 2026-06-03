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
  writeJobResultFile,
  readJobFile,
  readJobResultFile,
  appendJobLog
} from "../plugins/claude-code-bridge/scripts/lib/state.mjs";
import { readStoragePolicy } from "../plugins/claude-code-bridge/scripts/lib/storage-policy.mjs";

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

test("readStoragePolicy applies defaults and validates positive integer overrides", () => {
  assert.deepEqual(readStoragePolicy({}), {
    maxJobs: 50,
    maxStateBytes: 536870912,
    maxLogBytes: 5242880,
    maxResultBytes: 2097152,
    maxResultTextBytes: 1048576,
    maxJobAgeMs: 604800000
  });

  assert.deepEqual(readStoragePolicy({
    CLAUDE_COMPANION_MAX_JOBS: "7",
    CLAUDE_COMPANION_MAX_STATE_BYTES: "1000",
    CLAUDE_COMPANION_MAX_LOG_BYTES: "200",
    CLAUDE_COMPANION_MAX_RESULT_BYTES: "300",
    CLAUDE_COMPANION_MAX_RESULT_TEXT_BYTES: "80",
    CLAUDE_COMPANION_MAX_JOB_AGE_DAYS: "2"
  }), {
    maxJobs: 7,
    maxStateBytes: 1000,
    maxLogBytes: 200,
    maxResultBytes: 300,
    maxResultTextBytes: 80,
    maxJobAgeMs: 172800000
  });

  assert.throws(
    () => readStoragePolicy({ CLAUDE_COMPANION_MAX_LOG_BYTES: "0" }),
    /CLAUDE_COMPANION_MAX_LOG_BYTES/
  );
});

test("appendJobLog rotates logs within the configured byte cap", () => {
  const root = makeTempDir("state-root-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: root,
    CLAUDE_COMPANION_MAX_LOG_BYTES: "200"
  };
  let logFile = null;

  for (let index = 0; index < 12; index += 1) {
    logFile = appendJobLog("/tmp/workspace-a", "job-1", `line-${index} ${"x".repeat(80)}`, env);
  }

  const body = fs.readFileSync(logFile, "utf8");
  assert.ok(fs.statSync(logFile).size <= 200);
  assert.match(body, /\[storage\] previous log output truncated/);
  assert.match(body, /line-11/);
});

test("writeJobResultFile truncates archived result fields and records storage metadata", () => {
  const root = makeTempDir("state-root-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: root,
    CLAUDE_COMPANION_MAX_RESULT_TEXT_BYTES: "80",
    CLAUDE_COMPANION_MAX_RESULT_BYTES: "900"
  };
  const payload = {
    kind: "plan",
    status: "completed",
    summary: "large result",
    text: "text ".repeat(80),
    rawOutput: "raw ".repeat(100),
    rendered: "rendered ".repeat(100),
    metadata: { jobId: "job-1" }
  };

  const file = writeJobResultFile("/tmp/workspace-a", "job-1", payload, env);
  const stored = readJobResultFile("/tmp/workspace-a", "job-1", env);

  assert.ok(fs.statSync(file).size <= 900);
  assert.equal(stored.metadata.storage.truncated, true);
  assert.deepEqual(stored.metadata.storage.truncatedFields.sort(), ["rawOutput", "rendered", "text"]);
  assert.ok(stored.metadata.storage.omittedBytes > 0);
  assert.match(stored.rendered, /\[storage\] output truncated/);
});

test("writeJobResultFile falls back to a compact schema-valid result when objects still exceed the cap", () => {
  const root = makeTempDir("state-root-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: root,
    CLAUDE_COMPANION_MAX_RESULT_TEXT_BYTES: "80",
    CLAUDE_COMPANION_MAX_RESULT_BYTES: "700"
  };
  const payload = {
    kind: "review",
    status: "completed",
    summary: "huge findings",
    rawOutput: "raw",
    rendered: "rendered",
    findings: Array.from({ length: 60 }, (_, index) => ({
      severity: "high",
      title: `finding ${index} ${"x".repeat(60)}`,
      detail: "detail ".repeat(30)
    })),
    metadata: { jobId: "job-1" }
  };

  const file = writeJobResultFile("/tmp/workspace-a", "job-1", payload, env);
  const stored = readJobResultFile("/tmp/workspace-a", "job-1", env);

  assert.ok(fs.statSync(file).size <= 700);
  assert.equal(stored.kind, "review");
  assert.equal(stored.status, "completed");
  assert.equal(typeof stored.summary, "string");
  assert.equal(typeof stored.rawOutput, "string");
  assert.equal(typeof stored.rendered, "string");
  assert.equal(stored.metadata.storage.fallback, true);
});

test("writeJobFile bounds embedded results so job records cannot grow unbounded", () => {
  const root = makeTempDir("state-root-");
  const env = {
    CLAUDE_COMPANION_STATE_DIR: root,
    CLAUDE_COMPANION_MAX_RESULT_TEXT_BYTES: "80",
    CLAUDE_COMPANION_MAX_RESULT_BYTES: "900"
  };
  const file = writeJobFile("/tmp/workspace-a", "job-1", {
    id: "job-1",
    status: "completed",
    result: {
      kind: "plan",
      status: "completed",
      summary: "embedded",
      rawOutput: "raw ".repeat(120),
      rendered: "rendered ".repeat(120),
      metadata: {}
    }
  }, env);
  const stored = readJobFile("/tmp/workspace-a", "job-1", env);

  assert.ok(fs.statSync(file).size <= 1400);
  assert.equal(stored.result.metadata.storage.truncated, true);
});
