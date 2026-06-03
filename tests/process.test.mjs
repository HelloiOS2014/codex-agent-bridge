import test from "node:test";
import assert from "node:assert/strict";
import { runCommand, binaryAvailable, terminateProcessTree } from "../plugins/agent-bridge/scripts/lib/process.mjs";

test("runCommand captures stdout and exit status", async () => {
  const result = await runCommand(process.execPath, ["-e", "console.log('ok')"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "ok");
  assert.equal(result.stderr, "");
});

test("runCommand captures non-zero status", async () => {
  const result = await runCommand(process.execPath, ["-e", "process.stderr.write('bad'); process.exit(7)"]);
  assert.equal(result.status, 7);
  assert.equal(result.stderr, "bad");
});

test("runCommand captures spawn errors with null status and signal", async () => {
  const result = await runCommand("__missing_claude_companion_binary__", []);
  assert.equal(result.status, null);
  assert.equal(result.signal, null);
  assert.ok(result.error);
});

test("binaryAvailable returns true for node", async () => {
  const result = await binaryAvailable(process.execPath, ["--version"]);
  assert.equal(result.available, true);
  assert.match(result.stdout, /^v/);
});

test("terminateProcessTree returns false for invalid pids", () => {
  assert.equal(terminateProcessTree(0), false);
  assert.equal(terminateProcessTree(-1), false);
  assert.equal(terminateProcessTree(1.5), false);
});

test("terminateProcessTree rejects pid 1 before signaling", (t) => {
  const calls = [];
  t.mock.method(process, "kill", (pid, signal) => {
    calls.push([pid, signal]);
    return true;
  });

  assert.equal(terminateProcessTree(1), false);
  assert.deepEqual(calls, []);
});

test("terminateProcessTree does not fallback to bare pid by default", (t) => {
  const calls = [];
  t.mock.method(process, "kill", (pid, signal) => {
    calls.push([pid, signal]);
    if (pid < 0) {
      throw new Error("missing process group");
    }
    return true;
  });

  assert.equal(terminateProcessTree(12345, "SIGTERM"), false);
  assert.deepEqual(calls, [[-12345, "SIGTERM"]]);
});

test("terminateProcessTree allows explicit pid fallback", (t) => {
  const calls = [];
  t.mock.method(process, "kill", (pid, signal) => {
    calls.push([pid, signal]);
    if (pid < 0) {
      throw new Error("missing process group");
    }
    return true;
  });

  assert.equal(terminateProcessTree(12345, "SIGTERM", { allowPidFallback: true }), true);
  assert.deepEqual(calls, [[-12345, "SIGTERM"], [12345, "SIGTERM"]]);
});
