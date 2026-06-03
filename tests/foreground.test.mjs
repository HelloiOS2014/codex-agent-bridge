import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir, makeTempGitRepo, runCli } from "./helpers.mjs";
import { runForegroundCommand } from "../plugins/claude-code-bridge/scripts/lib/foreground.mjs";

function writeCapturingClaudeFixture() {
  const dir = makeTempDir("claude-companion-foreground-fixture-");
  const file = path.join(dir, "claude-capture.mjs");
  fs.writeFileSync(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;
console.log(JSON.stringify({
  type: "result",
  session_id: "foreground-session",
  result: [
    "PROMPT:",
    stdin,
    "ARGS:",
    JSON.stringify(args)
  ].join("\\n")
}));
`, { encoding: "utf8", mode: 0o755 });
  return file;
}

test("plan prompt asks for a full read-only plan and uses read profile", async () => {
  const claudeBin = writeCapturingClaudeFixture();

  const result = await runForegroundCommand({
    command: "plan",
    options: { model: "sonnet", effort: "high" },
    positionals: ["design", "this"]
  }, {
    cwd: process.cwd(),
    env: { ...process.env, CLAUDE_COMPANION_CLAUDE_BIN: claudeBin }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.kind, "plan");
  assert.match(result.rendered, /Claude Plan/);
  assert.match(result.rendered, /full implementation or review plan/i);
  assert.match(result.rendered, /Do not edit files/i);
  assert.match(result.rendered, /design this/);
  assert.match(result.rendered, /"--permission-mode","plan"/);
  assert.match(result.rendered, /"--model","sonnet"/);
  assert.match(result.rendered, /"--tools","Read,Glob,Grep"/);
  assert.doesNotMatch(result.rendered, /Bash|Edit,MultiEdit,Write/);
});

test("foreground commands omit --model when the user did not specify one", async () => {
  const claudeBin = writeCapturingClaudeFixture();

  const result = await runForegroundCommand({
    command: "rescue",
    options: {},
    positionals: ["diagnose", "failure"]
  }, {
    cwd: process.cwd(),
    env: { ...process.env, CLAUDE_COMPANION_CLAUDE_BIN: claudeBin }
  });

  assert.equal(result.status, "completed");
  assert.doesNotMatch(result.rendered, /"--model"/);
});

test("review prompt includes git context and uses no Claude tools", async () => {
  const claudeBin = writeCapturingClaudeFixture();
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "review-me.txt"), "review me\n", "utf8");

  const result = await runForegroundCommand({
    command: "review",
    options: { scope: "working-tree" },
    positionals: []
  }, {
    cwd,
    env: { ...process.env, CLAUDE_COMPANION_CLAUDE_BIN: claudeBin }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.kind, "review");
  assert.match(result.rendered, /Claude Review/);
  assert.match(result.rendered, /Target: working tree diff/);
  assert.match(result.rendered, /## Git Context/);
  assert.match(result.rendered, /review-me\.txt/);
  assert.match(result.rendered, /"--tools",""/);
});

test("adversarial-review prompt takes an opposing stance and includes focus", async () => {
  const claudeBin = writeCapturingClaudeFixture();
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "risk.txt"), "risk\n", "utf8");

  const result = await runForegroundCommand({
    command: "adversarial-review",
    options: { scope: "working-tree", prompt: "challenge the rollback story" },
    positionals: []
  }, {
    cwd,
    env: { ...process.env, CLAUDE_COMPANION_CLAUDE_BIN: claudeBin }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.kind, "adversarial-review");
  assert.match(result.rendered, /Claude Adversarial Review/);
  assert.match(result.rendered, /opposing reviewer/i);
  assert.match(result.rendered, /hidden assumptions/i);
  assert.match(result.rendered, /challenge the rollback story/);
});

test("rescue defaults to dry-run read profile and --write enables write profile", async () => {
  const claudeBin = writeCapturingClaudeFixture();

  const dryRun = await runForegroundCommand({
    command: "rescue",
    options: {},
    positionals: ["diagnose", "failure"]
  }, {
    cwd: process.cwd(),
    env: { ...process.env, CLAUDE_COMPANION_CLAUDE_BIN: claudeBin }
  });
  const write = await runForegroundCommand({
    command: "rescue",
    options: { write: true },
    positionals: ["fix", "failure"]
  }, {
    cwd: process.cwd(),
    env: { ...process.env, CLAUDE_COMPANION_CLAUDE_BIN: claudeBin }
  });

  assert.equal(dryRun.status, "completed");
  assert.match(dryRun.rendered, /Mode: read-only \/ dry-run/);
  assert.match(dryRun.rendered, /read-only diagnosis/i);
  assert.match(dryRun.rendered, /"--tools","Read,Glob,Grep"/);
  assert.doesNotMatch(dryRun.rendered, /Bash|Edit,MultiEdit,Write/);

  assert.equal(write.status, "completed");
  assert.match(write.rendered, /Mode: write-enabled/);
  assert.match(write.rendered, /explicitly write-enabled rescue mode/i);
  assert.match(write.rendered, /"--tools","Read,Glob,Grep,Edit,MultiEdit,Write"/);
});

test("foreground command returns normalized JSON result for json mode", async () => {
  const result = await runCli(["plan", "--json", "--prompt", "plan from option"]);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "plan");
  assert.equal(payload.status, "completed");
  assert.match(payload.rendered, /Claude Plan/);
  assert.match(payload.text, /plan from option/);
});

test("Claude failures render a failed normalized result instead of throwing raw errors", async () => {
  const result = await runCli(["plan", "will", "fail"], {
    env: { FAKE_CLAUDE_FAIL: "1" }
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Claude Plan/);
  assert.match(result.stdout, /Status: failed/);
  assert.match(result.stdout, /fake claude failure/);
  assert.equal(result.stderr, "");
});

test("invalid review baseline is rejected clearly", async () => {
  const cwd = await makeTempGitRepo();

  const result = await runCli(["review", "--against", "bad-ref"], { cwd });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid git baseline ref "bad-ref"/);
});

test("CLI emits JSON error payload for invalid json requests", async () => {
  const timeout = await runCli(["plan", "--json", "--timeout-ms", "0", "check"]);

  assert.equal(timeout.status, 1);
  assert.equal(timeout.stderr, "");
  const timeoutPayload = JSON.parse(timeout.stdout);
  assert.equal(timeoutPayload.kind, "plan");
  assert.equal(timeoutPayload.status, "failed");
  assert.match(timeoutPayload.error, /Timeout must be a positive integer/);

  const deferred = await runCli(["rescue", "--json", "--background", "--wait", "later"]);

  assert.equal(deferred.status, 1);
  assert.equal(deferred.stderr, "");
  const deferredPayload = JSON.parse(deferred.stdout);
  assert.equal(deferredPayload.kind, "rescue");
  assert.equal(deferredPayload.status, "failed");
  assert.match(deferredPayload.error, /mutually exclusive/);
});

test("CLI emits JSON error payload for invalid review baseline", async () => {
  const cwd = await makeTempGitRepo();

  const result = await runCli(["review", "--json", "--against", "bad-ref"], { cwd });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "review");
  assert.equal(payload.status, "failed");
  assert.match(payload.error, /Invalid git baseline ref "bad-ref"/);
});

test("setup human output does not ask users to configure Claude binary paths", async () => {
  const result = await runCli(["setup"], {
    env: {
      CLAUDE_COMPANION_CLAUDE_BIN: "__missing_claude_for_setup_message__"
    }
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Claude Code Bridge setup: not ready/);
  assert.match(result.stdout, /Claude: not found/);
  assert.match(result.stdout, /common local install locations/);
  assert.doesNotMatch(result.stdout, /set CLAUDE_COMPANION_CLAUDE_BIN/i);
  assert.doesNotMatch(result.stdout, /PATH/);
  assert.doesNotMatch(result.stdout, /Install Claude Code/i);
});

test("prompt-file is read relative to command cwd", async () => {
  const cwd = makeTempDir("claude-companion-foreground-prompt-");
  fs.writeFileSync(path.join(cwd, "prompt.txt"), "from prompt file\n", "utf8");

  const result = await runCli(["rescue", "--prompt-file", "prompt.txt"], { cwd });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Claude Rescue/);
  assert.match(result.stdout, /from prompt file/);
});

test("CLI --cwd changes prompt-file resolution and command cwd", async () => {
  const cwd = makeTempDir("claude-companion-foreground-cwd-");
  fs.writeFileSync(path.join(cwd, "prompt.txt"), "from cwd option\n", "utf8");

  const result = await runCli(["rescue", "--cwd", cwd, "--prompt-file", "prompt.txt"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /from cwd option/);
});

test("foreground CLI dispatch still handles normal plan after background support exists", async () => {
  const result = await runCli(["plan", "later"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Claude Plan/);
  assert.match(result.stdout, /later/);
});

test("CLI dispatch smoke renders review output", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "smoke.txt"), "smoke\n", "utf8");

  const result = await runCli(["review", "--scope", "working-tree"], { cwd });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Claude Review/);
  assert.match(result.stdout, /working tree diff/);
});

test("review honors untracked context caps", async () => {
  const claudeBin = writeCapturingClaudeFixture();
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "large.txt"), "abcdefghijklmnop\n", "utf8");

  const result = await runForegroundCommand({
    command: "review",
    options: {
      scope: "working-tree",
      "max-diff-bytes": "1024",
      "max-untracked-file-bytes": "8"
    },
    positionals: []
  }, {
    cwd,
    env: { ...process.env, CLAUDE_COMPANION_CLAUDE_BIN: claudeBin }
  });

  assert.equal(result.status, "completed");
  assert.match(result.rendered, /truncated at 8 bytes; omitted 9 bytes/i);
  assert.doesNotMatch(result.rendered, /ijklmnop/);
});

test("CLI timeout option renders a cancelled normalized result", async () => {
  const result = await runCli(["rescue", "--timeout-ms", "50", "slow"], {
    env: { FAKE_CLAUDE_SLEEP_MS: "1000" }
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Claude Rescue/);
  assert.match(result.stdout, /Status: cancelled/);
  assert.match(result.stdout, /timed out/);
});
