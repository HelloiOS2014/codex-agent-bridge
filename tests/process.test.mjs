import test from "node:test";
import assert from "node:assert/strict";
import { runCommand, binaryAvailable } from "../scripts/lib/process.mjs";

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
