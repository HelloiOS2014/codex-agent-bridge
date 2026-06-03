import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, assertNoDangerousArgs, readPromptFromParsedInput } from "../plugins/agent-bridge/scripts/lib/args.mjs";

test("parseArgs handles booleans, values, and positionals", () => {
  const parsed = parseArgs(["rescue", "--write", "--model", "sonnet", "fix", "it"], {
    booleanOptions: ["write"],
    valueOptions: ["model"]
  });
  assert.equal(parsed.command, "rescue");
  assert.deepEqual(parsed.options, { write: true, model: "sonnet" });
  assert.deepEqual(parsed.positionals, ["fix", "it"]);
});

test("parseArgs rejects missing option value", () => {
  assert.throws(
    () => parseArgs(["plan", "--model"], { valueOptions: ["model"] }),
    /Missing value for --model/
  );
});

test("dangerous flags are rejected", () => {
  assert.throws(
    () => assertNoDangerousArgs(["--dangerously-skip-permissions"]),
    /Dangerous Claude flag/
  );
  assert.throws(
    () => assertNoDangerousArgs(["--permission-mode", "bypassPermissions"]),
    /Dangerous Claude permission mode/
  );
  assert.throws(
    () => assertNoDangerousArgs(["--permission-mode=bypassPermissions"]),
    /Dangerous Claude permission mode/
  );
  assert.throws(
    () => assertNoDangerousArgs(["--dangerously-load-development-channels"]),
    /Dangerous Claude flag/
  );
  assert.throws(
    () => assertNoDangerousArgs(["--allow-dangerously-skip-permissions=true"]),
    /Dangerous Claude flag/
  );
});

test("parseArgs rejects plan background and wait together", () => {
  assert.throws(
    () => parseArgs(["plan", "--background", "--wait", "hello"], {
      booleanOptions: ["background", "wait"],
      exclusiveGroups: [["background", "wait"]]
    }),
    /Options are mutually exclusive: --background, --wait/
  );
});

test("parseArgs rejects rescue resume and fresh together", () => {
  assert.throws(
    () => parseArgs(["rescue", "--resume", "--fresh", "fix"], {
      booleanOptions: ["resume", "fresh"],
      exclusiveGroups: [["resume", "fresh"]]
    }),
    /Options are mutually exclusive: --resume, --fresh/
  );
});

test("prompt is joined from positionals", () => {
  const prompt = readPromptFromParsedInput({ options: {}, positionals: ["hello", "world"] });
  assert.equal(prompt, "hello world");
});

test("prompt-file is read relative to cwd", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "claude-companion-args-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, "prompt.txt"), "from file\n", "utf8");

  const prompt = readPromptFromParsedInput({
    options: { "prompt-file": "prompt.txt" },
    positionals: []
  }, { cwd });

  assert.equal(prompt, "from file\n");
});

test("prompt-file wins over positionals", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "claude-companion-args-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, "prompt.txt"), "from file", "utf8");

  const prompt = readPromptFromParsedInput({
    options: { "prompt-file": "prompt.txt" },
    positionals: ["ignored", "prompt"]
  }, { cwd });

  assert.equal(prompt, "from file");
});

test("missing prompt-file throws", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "claude-companion-args-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  assert.throws(
    () => readPromptFromParsedInput({
      options: { "prompt-file": "missing.txt" },
      positionals: []
    }, { cwd }),
    /ENOENT|no such file/i
  );
});
