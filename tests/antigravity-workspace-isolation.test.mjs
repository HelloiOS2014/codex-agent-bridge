import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempGitRepo } from "./helpers.mjs";
import { runCommand } from "../plugins/antigravity-bridge/scripts/lib/process.mjs";
import {
  assertIsolatedSnapshotRoot,
  collectGitTouchedFiles
} from "../plugins/antigravity-bridge/scripts/lib/workspace-isolation.mjs";

async function runChecked(command, args, options) {
  const result = await runCommand(command, args, options);
  if (!result.error && result.status === 0) {
    return result;
  }
  throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.stderr || result.error?.message || result.stdout}`);
}

test("assertIsolatedSnapshotRoot rejects the original repository root", () => {
  assert.throws(
    () => assertIsolatedSnapshotRoot("/tmp/workspace", "/tmp/workspace"),
    /snapshot root must not equal original repository root/
  );
  assert.doesNotThrow(() => assertIsolatedSnapshotRoot("/tmp/workspace-copy", "/tmp/workspace"));
});

test("collectGitTouchedFiles reports rename destination paths", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "old.txt"), "old\n", "utf8");
  await runChecked("git", ["add", "old.txt"], { cwd });
  await runChecked("git", ["commit", "-m", "add old"], { cwd });

  await runChecked("git", ["mv", "old.txt", "new.txt"], { cwd });

  assert.deepEqual(await collectGitTouchedFiles(cwd), ["new.txt"]);
});
