import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.mjs";
import {
  buildAgyArgs,
  getAgyStatus,
  resolveAgyBin,
  runAgyPrint
} from "../plugins/antigravity-bridge/scripts/lib/agy.mjs";

function writeAgyFixture(name, source) {
  const dir = makeTempDir("antigravity-companion-agy-fixture-");
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, { encoding: "utf8", mode: 0o755 });
  return file;
}

function writeCapturingAgyFixture() {
  return writeAgyFixture("agy-capture.mjs", `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("1.0.4");
  process.exit(0);
}
const terminatorIndex = args.indexOf("--");
const prompt = terminatorIndex >= 0 ? args.slice(terminatorIndex + 1).join(" ") : "";
console.log(JSON.stringify({
  type: "result",
  session_id: "fake-agy-session",
  result: JSON.stringify({ args, prompt, cwd: process.cwd() })
}));
`);
}

test("resolveAgyBin uses option, env, then default", (t) => {
  const original = process.env.ANTIGRAVITY_COMPANION_AGY_BIN;
  t.after(() => {
    if (original === undefined) {
      delete process.env.ANTIGRAVITY_COMPANION_AGY_BIN;
    } else {
      process.env.ANTIGRAVITY_COMPANION_AGY_BIN = original;
    }
  });
  delete process.env.ANTIGRAVITY_COMPANION_AGY_BIN;

  assert.equal(resolveAgyBin({ agyBin: "/tmp/custom-agy" }), "/tmp/custom-agy");

  process.env.ANTIGRAVITY_COMPANION_AGY_BIN = "/tmp/env-agy";
  assert.equal(resolveAgyBin(), "/tmp/env-agy");

  delete process.env.ANTIGRAVITY_COMPANION_AGY_BIN;
  assert.equal(resolveAgyBin({ env: { HOME: makeTempDir("antigravity-empty-home-") } }), "agy");
});

test("buildAgyArgs uses print mode, sandbox, timeout, add-dir, and a prompt terminator", () => {
  assert.deepEqual(buildAgyArgs({
    prompt: "inspect this",
    sandbox: true,
    printTimeout: "30s",
    addDirs: ["/tmp/extra"]
  }), [
    "--print",
    "--sandbox",
    "--print-timeout",
    "30s",
    "--add-dir",
    "/tmp/extra",
    "--",
    "inspect this"
  ]);
});

test("buildAgyArgs rejects dangerous and interactive extra args", () => {
  assert.throws(
    () => buildAgyArgs({ prompt: "hello", extraArgs: ["--dangerously-skip-permissions"] }),
    /Dangerous Antigravity flag/
  );
  assert.throws(
    () => buildAgyArgs({ prompt: "hello", extraArgs: ["--prompt-interactive"] }),
    /Unsupported Antigravity extra arg/
  );
  assert.throws(
    () => buildAgyArgs({ prompt: "hello", extraArgs: ["--plugin", "install"] }),
    /Unsupported Antigravity extra arg/
  );
});

test("getAgyStatus reports an available agy binary", async () => {
  const agyBin = writeCapturingAgyFixture();
  const status = await getAgyStatus({ agyBin });

  assert.equal(status.available, true);
  assert.equal(status.ready, true);
  assert.match(status.version.stdout, /1\.0\.4/);
  assert.equal(status.auth.checked, false);
});

test("runAgyPrint passes prompt after -- and parses result envelopes", async () => {
  const agyBin = writeCapturingAgyFixture();
  const cwd = makeTempDir("antigravity-companion-cwd-");
  const result = await runAgyPrint({
    agyBin,
    cwd,
    prompt: "--dangerously-skip-permissions should stay prompt text",
    sandbox: true,
    printTimeout: "20s"
  });

  assert.equal(result.status, 0);
  assert.equal(result.sessionId, "fake-agy-session");
  const payload = JSON.parse(result.output);
  assert.equal(payload.prompt, "--dangerously-skip-permissions should stay prompt text");
  assert.equal(payload.cwd, fs.realpathSync.native(cwd));
  assert.deepEqual(payload.args.slice(0, 4), ["--print", "--sandbox", "--print-timeout", "20s"]);
  assert.equal(payload.args.at(-2), "--");
  assert.equal(payload.args.at(-1), "--dangerously-skip-permissions should stay prompt text");
});
