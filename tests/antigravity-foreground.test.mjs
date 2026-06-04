import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir, makeTempGitRepo, repoRoot } from "./helpers.mjs";
import { runCommand } from "../plugins/antigravity-bridge/scripts/lib/process.mjs";
import { runForegroundCommand } from "../plugins/antigravity-bridge/scripts/lib/foreground.mjs";

const antigravityPluginRoot = path.join(repoRoot, "plugins", "antigravity-bridge");
const antigravityCliPath = path.join(antigravityPluginRoot, "scripts", "antigravity-companion.mjs");
const fakeAgyPath = path.join(repoRoot, "tests", "fake-agy-fixture.mjs");

function runAntigravityCli(args, options = {}) {
  return runCommand(process.execPath, [antigravityCliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ANTIGRAVITY_COMPANION_AGY_BIN: fakeAgyPath,
      ANTIGRAVITY_COMPANION_STATE_DIR: options.stateDir ?? makeTempDir("antigravity-companion-state-"),
      ...(options.env ?? {})
    }
  });
}

test("setup json reports Antigravity readiness from fake agy", async () => {
  const result = await runAntigravityCli(["setup", "--json"]);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.antigravity.ready, true);
  assert.equal(payload.antigravity.agyBin, fakeAgyPath);
  assert.match(payload.antigravity.version.stdout, /1\.0\.4/);
});

test("setup reports missing agy without asking users to edit PATH", async () => {
  const result = await runAntigravityCli(["setup"], {
    env: {
      ANTIGRAVITY_COMPANION_AGY_BIN: "__missing_agy_for_setup_message__"
    }
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Antigravity Bridge setup: not ready/);
  assert.match(result.stdout, /Antigravity: not found/);
  assert.match(result.stdout, /common local install locations/);
  assert.doesNotMatch(result.stdout, /PATH/);
});

test("plan uses agy print mode with sandbox and renders Antigravity output", async () => {
  const result = await runAntigravityCli(["plan", "--json", "plan", "this"]);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "plan");
  assert.equal(payload.status, "completed");
  assert.match(payload.rendered, /Antigravity Plan/);
  assert.match(payload.text, /Fake Agy response:/);
  assert.match(payload.text, /plan this/);
  assert.match(payload.text, /"--print"/);
  assert.match(payload.text, /"--sandbox"/);
  assert.match(payload.text, /"--"/);
});

test("foreground deferred rejection explains dispatch-owned background handling", async () => {
  await assert.rejects(
    () => runForegroundCommand({
      command: "plan",
      options: { background: true },
      positionals: ["deferred", "plan"]
    }, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ANTIGRAVITY_COMPANION_AGY_BIN: fakeAgyPath
      }
    }),
    /Deferred foreground execution is handled by companion dispatch/
  );
});

test("review includes git context and uses sandboxed agy print", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "review-me.txt"), "review me\n", "utf8");

  const result = await runAntigravityCli(["review", "--scope", "working-tree"], { cwd });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Antigravity Review/);
  assert.match(result.stdout, /working tree diff/);
  assert.match(result.stdout, /review-me\.txt/);
  assert.match(result.stdout, /"--sandbox"/);
});

test("write-enabled rescue omits sandbox while dry-run rescue keeps it", async () => {
  const dryRun = await runAntigravityCli(["rescue", "--json", "diagnose", "failure"]);
  const write = await runAntigravityCli(["rescue", "--write", "--json", "fix", "failure"]);

  assert.equal(dryRun.status, 0);
  assert.match(JSON.parse(dryRun.stdout).text, /"--sandbox"/);

  assert.equal(write.status, 0);
  assert.doesNotMatch(JSON.parse(write.stdout).text, /"--sandbox"/);
});

test("rescue --resume passes agy continue mode while --fresh does not", async () => {
  const resume = await runAntigravityCli(["rescue", "--resume", "--json"]);
  const fresh = await runAntigravityCli(["rescue", "--fresh", "--json", "fresh", "diagnosis"]);

  assert.equal(resume.status, 0);
  assert.match(JSON.parse(resume.stdout).text, /"--continue"/);

  assert.equal(fresh.status, 0);
  assert.doesNotMatch(JSON.parse(fresh.stdout).text, /"--continue"/);
});
