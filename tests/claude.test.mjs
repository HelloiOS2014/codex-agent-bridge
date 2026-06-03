import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixtureClaudePath, makeTempDir } from "./helpers.mjs";
import {
  buildClaudeArgs,
  buildToolArgs,
  getClaudeStatus,
  resolveClaudeBin,
  runClaudePrint
} from "../plugins/claude-companion/scripts/lib/claude.mjs";

function writeFixture(name, source) {
  const dir = makeTempDir("claude-companion-claude-fixture-");
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, { encoding: "utf8", mode: 0o755 });
  return file;
}

test("resolveClaudeBin uses option, env, then default", (t) => {
  const original = process.env.CLAUDE_COMPANION_CLAUDE_BIN;
  t.after(() => {
    if (original === undefined) {
      delete process.env.CLAUDE_COMPANION_CLAUDE_BIN;
    } else {
      process.env.CLAUDE_COMPANION_CLAUDE_BIN = original;
    }
  });
  delete process.env.CLAUDE_COMPANION_CLAUDE_BIN;

  assert.equal(resolveClaudeBin({ claudeBin: "/tmp/custom-claude" }), "/tmp/custom-claude");

  process.env.CLAUDE_COMPANION_CLAUDE_BIN = "/tmp/env-claude";
  assert.equal(resolveClaudeBin(), "/tmp/env-claude");

  delete process.env.CLAUDE_COMPANION_CLAUDE_BIN;
  assert.equal(resolveClaudeBin(), "claude");
});

test("getClaudeStatus reports missing binary", async () => {
  const status = await getClaudeStatus({ claudeBin: "__missing_claude_companion_binary__" });

  assert.equal(status.available, false);
  assert.equal(status.ready, false);
  assert.equal(status.auth.checked, false);
  assert.match(status.version.error, /__missing_claude_companion_binary__/);
});

test("getClaudeStatus reads version and auth from available Claude", async () => {
  const status = await getClaudeStatus({ claudeBin: fixtureClaudePath });

  assert.equal(status.available, true);
  assert.equal(status.ready, true);
  assert.equal(status.auth.loggedIn, true);
  assert.equal(status.auth.checked, true);
  assert.match(status.version.stdout, /Claude Code/);
});

test("buildToolArgs maps safe profiles without bypass permissions", () => {
  assert.deepEqual(buildToolArgs("none"), ["--tools", ""]);
  assert.deepEqual(buildToolArgs("read"), ["--tools", "Read,Glob,Grep"]);
  assert.deepEqual(buildToolArgs("write"), ["--tools", "Read,Glob,Grep,Edit,MultiEdit,Write"]);

  for (const profile of ["none", "read"]) {
    assert.doesNotMatch(buildClaudeArgs({ prompt: "inspect", toolProfile: profile }).join(" "), /bypass|dangerously/i);
    assert.doesNotMatch(buildClaudeArgs({ prompt: "inspect", toolProfile: profile }).join(" "), /Bash|Edit|MultiEdit|Write/);
  }
});

test("buildClaudeArgs rejects unknown profiles and dangerous extra args", () => {
  assert.throws(
    () => buildClaudeArgs({ prompt: "hello", toolProfile: "admin" }),
    /Unknown Claude tool profile/
  );
  assert.throws(
    () => buildClaudeArgs({ prompt: "hello", extraArgs: ["--dangerously-skip-permissions"] }),
    /Dangerous Claude flag/
  );
  assert.throws(
    () => buildClaudeArgs({ prompt: "hello", permissionMode: "bypassPermissions" }),
    /Dangerous Claude permission mode/
  );
  assert.throws(
    () => buildClaudeArgs({ prompt: "hello", toolProfile: "read", extraArgs: ["--tools", "Edit"] }),
    /Claude tool flags must be selected with toolProfile/
  );
});

test("buildClaudeArgs rejects dangerous equals-form extra args", () => {
  for (const dangerousArg of [
    "--dangerously-skip-permissions=true",
    "--allow-dangerously-skip-permissions=1",
    "--dangerously-bypass-approvals-and-sandbox=yes",
    "--permission-mode=bypassPermissions"
  ]) {
    assert.throws(
      () => buildClaudeArgs({ prompt: "hello", extraArgs: [dangerousArg] }),
      /Dangerous Claude (flag|permission mode)/
    );
  }
});

test("buildClaudeArgs allows only safe extra args", () => {
  assert.deepEqual(
    buildClaudeArgs({
      prompt: "hello",
      extraArgs: ["--max-turns", "3", "--verbose"]
    }).slice(-3),
    ["--max-turns", "3", "--verbose"]
  );
  assert.deepEqual(
    buildClaudeArgs({
      prompt: "hello",
      extraArgs: ["--max-turns=2"]
    }).slice(-2),
    ["--max-turns", "2"]
  );
});

test("buildClaudeArgs rejects unsafe extra args in split and equals forms", () => {
  const unsafeCases = [
    ["--dangerously-load-development-channels"],
    ["--plugin-url", "https://example.invalid/plugin"],
    ["--plugin-url=https://example.invalid/plugin"],
    ["--add-dir", "/tmp/other"],
    ["--add-dir=/tmp/other"],
    ["--exec", "rm -rf nope"],
    ["--exec=rm -rf nope"],
    ["--settings", "/tmp/settings.json"],
    ["--settings=/tmp/settings.json"],
    ["--mcp-config", "/tmp/mcp.json"],
    ["--mcp-config=/tmp/mcp.json"],
    ["--tools", "Write"],
    ["--tools=Write"],
    ["--allowedTools", "Write"],
    ["--allowedTools=Write"],
    ["--disallowedTools", "Read"],
    ["--disallowedTools=Read"],
    ["--permission-mode", "acceptEdits"]
  ];

  for (const extraArgs of unsafeCases) {
    assert.throws(
      () => buildClaudeArgs({ prompt: "hello", extraArgs }),
      /Dangerous Claude flag|Claude tool flags|Unsupported Claude extra arg/
    );
  }

  for (const invalidExtraArgs of [
    ["--max-turns", "0"],
    ["--max-turns=0"],
    ["--max-turns", "abc"],
    ["--verbose=true"],
    ["positional"]
  ]) {
    assert.throws(
      () => buildClaudeArgs({ prompt: "hello", extraArgs: invalidExtraArgs }),
      /positive integer|does not accept a value|Unsupported Claude extra arg/
    );
  }
});

test("runClaudePrint sends prompt over stdin by default", async () => {
  const result = await runClaudePrint({
    claudeBin: fixtureClaudePath,
    cwd: process.cwd(),
    prompt: "hello",
    toolProfile: "none"
  });

  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.sessionId, "fake-claude-session");
  assert.match(result.output, /Fake Claude response: hello/);
  assert.equal(result.error, null);
});

test("runClaudePrint does not pass option-like prompt text in argv", async () => {
  const claudeBin = writeFixture("claude-capture-argv.mjs", `#!/usr/bin/env node
let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;
console.log(JSON.stringify({
  type: "result",
  session_id: "argv-capture-session",
  result: JSON.stringify({
    argv: process.argv.slice(2),
    stdin
  })
}));
`);
  const prompt = "--mcp-config=/tmp/evil.json --allowedTools=Write";

  const result = await runClaudePrint({
    claudeBin,
    cwd: process.cwd(),
    prompt,
    toolProfile: "none"
  });

  assert.equal(result.status, 0);
  assert.equal(result.sessionId, "argv-capture-session");
  const payload = JSON.parse(result.output);
  assert.equal(payload.stdin, prompt);
  assert.ok(!payload.argv.includes(prompt));
  assert.ok(!payload.argv.some((arg) => arg.startsWith("--mcp-config=")));
  assert.ok(!payload.argv.some((arg) => arg.startsWith("--allowedTools=")));
});

test("runClaudePrint can pass prompt over stdin and forwards cwd and env", async () => {
  const claudeBin = writeFixture("claude-stdin.mjs", `#!/usr/bin/env node
let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;
console.log(JSON.stringify({
  type: "result",
  session_id: "stdin-session",
  result: JSON.stringify({
    stdin,
    cwd: process.cwd(),
    env: process.env.CLAUDE_TEST_ENV
  })
}));
`);
  const cwd = makeTempDir("claude-companion-cwd-");

  const result = await runClaudePrint({
    claudeBin,
    cwd,
    env: { ...process.env, CLAUDE_TEST_ENV: "forwarded" },
    prompt: "from stdin",
    promptMode: "stdin",
    toolProfile: "none"
  });

  assert.equal(result.status, 0);
  assert.equal(result.sessionId, "stdin-session");
  const payload = JSON.parse(result.output);
  assert.equal(payload.stdin, "from stdin");
  assert.equal(payload.cwd, fs.realpathSync(cwd));
  assert.equal(payload.env, "forwarded");
});

test("runClaudePrint can read prompt from a prompt file", async () => {
  const cwd = makeTempDir("claude-companion-prompt-file-");
  fs.writeFileSync(path.join(cwd, "prompt.txt"), "from file", "utf8");

  const result = await runClaudePrint({
    claudeBin: fixtureClaudePath,
    cwd,
    promptFile: "prompt.txt",
    toolProfile: "none"
  });

  assert.equal(result.status, 0);
  assert.match(result.output, /Fake Claude response: from file/);
});

test("runClaudePrint returns nonzero status and stderr", async () => {
  const result = await runClaudePrint({
    claudeBin: fixtureClaudePath,
    env: { ...process.env, FAKE_CLAUDE_FAIL: "1" },
    prompt: "will fail",
    toolProfile: "none"
  });

  assert.equal(result.status, 42);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /fake claude failure/);
});

test("runClaudePrint returns timeout details", async () => {
  const result = await runClaudePrint({
    claudeBin: fixtureClaudePath,
    env: { ...process.env, FAKE_CLAUDE_SLEEP_MS: "1000" },
    prompt: "slow",
    toolProfile: "none",
    timeoutMs: 50
  });

  assert.equal(result.status, null);
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGTERM");
});
