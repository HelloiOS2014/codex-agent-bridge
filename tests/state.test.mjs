import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.mjs";
import { resolveStateDir, writeJobFile, readJobFile, appendJobLog } from "../scripts/lib/state.mjs";

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
