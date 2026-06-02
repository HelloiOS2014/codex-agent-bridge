import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, assertNoDangerousArgs, readPromptFromParsedInput } from "../scripts/lib/args.mjs";

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
});

test("prompt is joined from positionals", () => {
  const prompt = readPromptFromParsedInput({ options: {}, positionals: ["hello", "world"] });
  assert.equal(prompt, "hello world");
});
