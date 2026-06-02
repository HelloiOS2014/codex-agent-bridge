# Claude Companion Codex Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Codex plugin that lets Codex call Claude Code for planning, review, adversarial review, and explicitly write-enabled rescue tasks.

**Architecture:** The plugin is skill-driven and does not use MCP. Codex skills invoke a Node companion CLI through the plugin root; the companion owns argument parsing, Claude invocation, git context collection, state, background jobs, rendering, and cancellation.

**Tech Stack:** Node.js 18+ ESM, built-in `node:test`, `node:assert`, `child_process.spawn`, local `claude` CLI, local `git`.

---

## File Structure

- `.codex-plugin/plugin.json`: Codex plugin manifest. Declares metadata and `skills`.
- `package.json`: Node package metadata and scripts.
- `README.md`: Install and command overview.
- `schemas/review-output.schema.json`: Structured shape for review-like rendered output metadata.
- `scripts/claude-companion.mjs`: CLI entrypoint and command dispatch.
- `scripts/lib/args.mjs`: argv normalization, option parsing, prompt input helpers, dangerous flag rejection.
- `scripts/lib/process.mjs`: `spawn` wrapper, binary checks, timeout handling, process-tree termination.
- `scripts/lib/state.mjs`: workspace-hashed state directory, state file, job file, log path helpers.
- `scripts/lib/jobs.mjs`: job records, status snapshots, background worker launch, cancellation rules.
- `scripts/lib/git.mjs`: git repository detection and review context collection.
- `scripts/lib/claude.mjs`: Claude CLI availability, auth status, tool profile argv construction, output parsing.
- `scripts/lib/render.mjs`: human-readable markdown and JSON result payload rendering.
- `skills/claude-plan/SKILL.md`: Codex behavior for planning delegation.
- `skills/claude-review/SKILL.md`: Codex behavior for normal and adversarial review delegation.
- `skills/claude-rescue/SKILL.md`: Codex behavior for investigation and write-enabled task delegation.
- `skills/claude-result-handling/SKILL.md`: Codex behavior for setup, status, result, and cancel.
- `tests/helpers.mjs`: temp directory, temp git repo, CLI runner, fake Claude path helpers.
- `tests/fake-claude-fixture.mjs`: deterministic fake Claude executable.
- `tests/*.test.mjs`: unit and CLI tests.

## Task 1: Plugin And Package Scaffold

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `package.json`
- Create: `README.md`
- Create: `schemas/review-output.schema.json`

- [ ] **Step 1: Write manifest and package validation test command**

Create `package.json`:

```json
{
  "name": "claude-companion-codex-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Use Claude Code from Codex for planning, review, and delegated rescue work.",
  "license": "MIT",
  "engines": {
    "node": ">=18.18.0"
  },
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "check:manifest": "node -e \"const fs=require('fs'); const p=JSON.parse(fs.readFileSync('.codex-plugin/plugin.json','utf8')); if(!p.name||!p.version||!p.skills||!p.interface) process.exit(1);\""
  }
}
```

- [ ] **Step 2: Create Codex plugin manifest**

Create `.codex-plugin/plugin.json`:

```json
{
  "name": "claude-companion",
  "version": "0.1.0",
  "description": "Use Claude Code from Codex for planning, review, and delegated rescue work.",
  "author": {
    "name": "JOYY"
  },
  "homepage": "https://github.com/",
  "repository": "https://github.com/",
  "license": "MIT",
  "keywords": [
    "claude-code",
    "codex",
    "planning",
    "review",
    "delegation"
  ],
  "skills": "./skills/",
  "interface": {
    "displayName": "Claude Companion",
    "shortDescription": "Delegate planning, review, and rescue work from Codex to Claude Code",
    "longDescription": "Claude Companion lets Codex invoke local Claude Code for architecture planning, code review, adversarial review, and explicitly write-enabled delegated tasks while keeping plan and review commands read-only.",
    "developerName": "JOYY",
    "category": "Coding",
    "capabilities": [
      "Interactive",
      "Read",
      "Write"
    ],
    "defaultPrompt": [
      "Ask Claude to plan this architecture",
      "Ask Claude to review my current changes",
      "Ask Claude to fix this issue"
    ],
    "brandColor": "#5B4DFF",
    "screenshots": []
  }
}
```

- [ ] **Step 3: Create review schema**

Create `schemas/review-output.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["status", "kind", "summary", "rawOutput", "rendered"],
  "properties": {
    "status": { "type": "string" },
    "kind": { "type": "string" },
    "summary": { "type": "string" },
    "rawOutput": { "type": "string" },
    "rendered": { "type": "string" },
    "reasoningSummary": {
      "type": "array",
      "items": { "type": "string" }
    },
    "touchedFiles": {
      "type": "array",
      "items": { "type": "string" }
    },
    "metadata": { "type": "object" }
  }
}
```

- [ ] **Step 4: Create README**

Create `README.md`:

```markdown
# Claude Companion Codex Plugin

Claude Companion lets Codex delegate planning, code review, adversarial review, and explicitly write-enabled rescue tasks to local Claude Code.

Core commands are routed through:

```bash
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs plan "plan this change"
node scripts/claude-companion.mjs review --scope working-tree
node scripts/claude-companion.mjs adversarial-review "challenge this caching design"
node scripts/claude-companion.mjs rescue --write "fix the failing test"
node scripts/claude-companion.mjs status
node scripts/claude-companion.mjs result
node scripts/claude-companion.mjs cancel <job-id>
```

`plan`, `review`, and `adversarial-review` are read-only. `rescue` can edit files only when `--write` is present.
```

- [ ] **Step 5: Run scaffold checks**

Run: `npm run check:manifest`

Expected: PASS with no output and exit code 0.

- [ ] **Step 6: Commit**

```bash
git add .codex-plugin/plugin.json package.json README.md schemas/review-output.schema.json
git commit -m "feat: add plugin scaffold"
```

## Task 2: Test Helpers, Fake Claude, And Process Utilities

**Files:**
- Create: `tests/helpers.mjs`
- Create: `tests/fake-claude-fixture.mjs`
- Create: `tests/process.test.mjs`
- Create: `scripts/lib/process.mjs`

- [ ] **Step 1: Write failing process tests**

Create `tests/process.test.mjs`:

```js
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

test("binaryAvailable returns true for node", async () => {
  const result = await binaryAvailable(process.execPath, ["--version"]);
  assert.equal(result.available, true);
  assert.match(result.stdout, /^v/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/process.test.mjs`

Expected: FAIL with module-not-found for `scripts/lib/process.mjs`.

- [ ] **Step 3: Implement process utilities**

Create `scripts/lib/process.mjs`:

```js
import { spawn } from "node:child_process";

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ status: null, stdout, stderr, error });
    });
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr, error: null });
    });
  });
}

export async function binaryAvailable(command, args = ["--version"], options = {}) {
  const result = await runCommand(command, args, options);
  return {
    available: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error ? result.error.message : null
  };
}

export function terminateProcessTree(pid, signal = "SIGTERM") {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Create helpers and fake Claude fixture**

Create `tests/helpers.mjs`:

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../scripts/lib/process.mjs";

export const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const fixtureClaudePath = path.join(repoRoot, "tests", "fake-claude-fixture.mjs");

export function makeTempDir(prefix = "claude-companion-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function makeTempGitRepo() {
  const cwd = makeTempDir("claude-companion-git-");
  await runCommand("git", ["init", "-q"], { cwd });
  await runCommand("git", ["config", "user.email", "test@example.com"], { cwd });
  await runCommand("git", ["config", "user.name", "Test User"], { cwd });
  fs.writeFileSync(path.join(cwd, "README.md"), "initial\n", "utf8");
  await runCommand("git", ["add", "README.md"], { cwd });
  await runCommand("git", ["commit", "-m", "initial"], { cwd });
  return cwd;
}

export async function runCli(args, options = {}) {
  return runCommand(process.execPath, [path.join(repoRoot, "scripts", "claude-companion.mjs"), ...args], {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      CLAUDE_COMPANION_CLAUDE_BIN: fixtureClaudePath,
      CLAUDE_COMPANION_STATE_DIR: options.stateDir ?? makeTempDir("claude-companion-state-"),
      ...(options.env ?? {})
    }
  });
}
```

Create `tests/fake-claude-fixture.mjs`:

```js
#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("2.1.160 (Claude Code)");
  process.exit(0);
}

if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "oauth_token", apiProvider: "firstParty" }));
  process.exit(0);
}

if (process.env.FAKE_CLAUDE_FAIL === "1") {
  console.error("fake claude failure");
  process.exit(42);
}

if (process.env.FAKE_CLAUDE_SLEEP_MS) {
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_CLAUDE_SLEEP_MS)));
}

const prompt = args[args.length - 1] ?? "";
const payload = {
  type: "result",
  session_id: "fake-claude-session",
  result: `Fake Claude response: ${prompt}`
};

console.log(JSON.stringify(payload));
```

- [ ] **Step 5: Run process tests**

Run: `node --test tests/process.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/process.mjs tests/helpers.mjs tests/fake-claude-fixture.mjs tests/process.test.mjs
git commit -m "test: add process utilities and fake claude"
```

## Task 3: Argument Parsing And CLI Dispatch

**Files:**
- Create: `tests/args.test.mjs`
- Create: `scripts/lib/args.mjs`
- Create: `scripts/claude-companion.mjs`

- [ ] **Step 1: Write failing args tests**

Create `tests/args.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/args.test.mjs`

Expected: FAIL with module-not-found for `scripts/lib/args.mjs`.

- [ ] **Step 3: Implement args module**

Create `scripts/lib/args.mjs`:

```js
import fs from "node:fs";
import path from "node:path";

const DANGEROUS_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox"
]);

const DANGEROUS_PERMISSION_MODES = new Set(["bypassPermissions"]);

export function assertNoDangerousArgs(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (DANGEROUS_FLAGS.has(arg)) {
      throw new Error(`Dangerous Claude flag is not allowed: ${arg}`);
    }
    if (arg === "--permission-mode" && DANGEROUS_PERMISSION_MODES.has(argv[index + 1])) {
      throw new Error(`Dangerous Claude permission mode is not allowed: ${argv[index + 1]}`);
    }
  }
}

export function parseArgs(argv, config = {}) {
  assertNoDangerousArgs(argv);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const valueOptions = new Set(config.valueOptions ?? []);
  const [command, ...rest] = argv;
  const options = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    if (booleanOptions.has(name)) {
      options[name] = true;
      continue;
    }
    if (valueOptions.has(name)) {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --${name}`);
      }
      options[name] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: --${name}`);
  }

  return { command: command ?? "help", options, positionals };
}

export function readPromptFromParsedInput(parsed, options = {}) {
  if (parsed.options["prompt-file"]) {
    return fs.readFileSync(path.resolve(options.cwd ?? process.cwd(), parsed.options["prompt-file"]), "utf8");
  }
  return parsed.positionals.join(" ").trim();
}
```

- [ ] **Step 4: Create minimal CLI dispatcher**

Create `scripts/claude-companion.mjs`:

```js
#!/usr/bin/env node

import { parseArgs } from "./lib/args.mjs";

const COMMAND_CONFIG = {
  setup: { booleanOptions: ["json"], valueOptions: [] },
  plan: { booleanOptions: ["background", "wait"], valueOptions: ["model", "effort", "prompt-file"] },
  review: { booleanOptions: ["background", "wait", "json"], valueOptions: ["base", "scope"] },
  "adversarial-review": { booleanOptions: ["background", "wait"], valueOptions: ["base", "scope", "prompt-file"] },
  rescue: { booleanOptions: ["background", "wait", "resume", "fresh", "write"], valueOptions: ["model", "effort", "prompt-file"] },
  status: { booleanOptions: ["all", "json"], valueOptions: [] },
  result: { booleanOptions: ["json"], valueOptions: [] },
  cancel: { booleanOptions: ["json"], valueOptions: [] },
  "run-job": { booleanOptions: [], valueOptions: [] }
};

function usage() {
  return [
    "Usage:",
    "  claude-companion setup [--json]",
    "  claude-companion plan [--background|--wait] [prompt...]",
    "  claude-companion review [--background|--wait] [--base <ref>] [--scope auto|working-tree|branch]",
    "  claude-companion adversarial-review [--background|--wait] [focus...]",
    "  claude-companion rescue [--background|--wait] [--resume|--fresh] [--write] [prompt...]",
    "  claude-companion status [job-id] [--all] [--json]",
    "  claude-companion result [job-id] [--json]",
    "  claude-companion cancel [job-id] [--json]"
  ].join("\n");
}

async function main(argv) {
  const command = argv[0] ?? "help";
  if (command === "help" || command === "--help") {
    console.log(usage());
    return;
  }
  const config = COMMAND_CONFIG[command];
  if (!config) {
    throw new Error(`Unknown command: ${command}`);
  }
  const parsed = parseArgs(argv, config);
  console.log(JSON.stringify({ command: parsed.command, options: parsed.options, positionals: parsed.positionals }));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
```

- [ ] **Step 5: Run args tests**

Run: `node --test tests/args.test.mjs`

Expected: PASS.

- [ ] **Step 6: Run CLI smoke**

Run: `node scripts/claude-companion.mjs rescue --write fix it`

Expected stdout contains:

```json
{"command":"rescue","options":{"write":true},"positionals":["fix","it"]}
```

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/args.mjs scripts/claude-companion.mjs tests/args.test.mjs
git commit -m "feat: add companion argument parsing"
```

## Task 4: State And Job Storage

**Files:**
- Create: `tests/state.test.mjs`
- Create: `tests/jobs.test.mjs`
- Create: `scripts/lib/state.mjs`
- Create: `scripts/lib/jobs.mjs`

- [ ] **Step 1: Write failing state tests**

Create `tests/state.test.mjs`:

```js
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
```

- [ ] **Step 2: Write failing job tests**

Create `tests/jobs.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createJobRecord, completeJobRecord, summarizeStatus } from "../scripts/lib/jobs.mjs";

test("createJobRecord creates a running job shape", () => {
  const job = createJobRecord({ kind: "plan", cwd: "/tmp/repo", workspaceRoot: "/tmp/repo", write: false });
  assert.match(job.id, /^plan-/);
  assert.equal(job.status, "queued");
  assert.equal(job.write, false);
});

test("completeJobRecord stores result and clears pid", () => {
  const job = createJobRecord({ kind: "review", cwd: "/tmp/repo", workspaceRoot: "/tmp/repo", write: false });
  const done = completeJobRecord(job, { status: "completed", summary: "done", rendered: "ok" });
  assert.equal(done.status, "completed");
  assert.equal(done.pid, null);
  assert.equal(done.result.rendered, "ok");
});

test("summarizeStatus includes running and latest finished jobs", () => {
  const running = createJobRecord({ kind: "plan", cwd: "/tmp/repo", workspaceRoot: "/tmp/repo", write: false });
  running.status = "running";
  const finished = completeJobRecord(
    createJobRecord({ kind: "review", cwd: "/tmp/repo", workspaceRoot: "/tmp/repo", write: false }),
    { status: "completed", summary: "review done", rendered: "ok" }
  );
  const summary = summarizeStatus([finished, running]);
  assert.equal(summary.running.length, 1);
  assert.equal(summary.latestFinished.id, finished.id);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/state.test.mjs tests/jobs.test.mjs`

Expected: FAIL with module-not-found for `state.mjs` and `jobs.mjs`.

- [ ] **Step 4: Implement state module**

Create `scripts/lib/state.mjs`:

```js
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function slug(value) {
  return String(value || "workspace").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

export function resolveStateRoot(env = process.env) {
  return env.CLAUDE_COMPANION_STATE_DIR || env.CODEX_PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "claude-companion");
}

export function resolveStateDir(workspaceRoot, env = process.env) {
  const real = fs.existsSync(workspaceRoot) ? fs.realpathSync.native(workspaceRoot) : workspaceRoot;
  const hash = crypto.createHash("sha256").update(real).digest("hex").slice(0, 16);
  return path.join(resolveStateRoot(env), `${slug(path.basename(workspaceRoot))}-${hash}`);
}

export function resolveJobsDir(workspaceRoot, env = process.env) {
  return path.join(resolveStateDir(workspaceRoot, env), "jobs");
}

export function ensureJobsDir(workspaceRoot, env = process.env) {
  const dir = resolveJobsDir(workspaceRoot, env);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveJobFile(workspaceRoot, jobId, env = process.env) {
  return path.join(ensureJobsDir(workspaceRoot, env), `${jobId}.json`);
}

export function resolveJobLogFile(workspaceRoot, jobId, env = process.env) {
  return path.join(ensureJobsDir(workspaceRoot, env), `${jobId}.log`);
}

export function writeJobFile(workspaceRoot, jobId, payload, env = process.env) {
  const file = resolveJobFile(workspaceRoot, jobId, env);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

export function readJobFile(workspaceRoot, jobId, env = process.env) {
  return JSON.parse(fs.readFileSync(resolveJobFile(workspaceRoot, jobId, env), "utf8"));
}

export function appendJobLog(workspaceRoot, jobId, message, env = process.env) {
  const file = resolveJobLogFile(workspaceRoot, jobId, env);
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  return file;
}
```

- [ ] **Step 5: Implement jobs module**

Create `scripts/lib/jobs.mjs`:

```js
export function nowIso() {
  return new Date().toISOString();
}

export function createJobRecord({ kind, cwd, workspaceRoot, write, summary = "" }) {
  const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    kind,
    status: "queued",
    phase: "queued",
    pid: null,
    cwd,
    workspaceRoot,
    createdAt: nowIso(),
    startedAt: null,
    completedAt: null,
    summary,
    sessionId: null,
    claudeSessionId: null,
    logFile: null,
    resultFile: null,
    write: Boolean(write),
    touchedFiles: [],
    errorMessage: null
  };
}

export function startJobRecord(job, pid) {
  return { ...job, status: "running", phase: "starting", pid, startedAt: nowIso() };
}

export function completeJobRecord(job, result) {
  return {
    ...job,
    status: result.status,
    phase: result.status === "completed" ? "done" : "failed",
    pid: null,
    completedAt: nowIso(),
    summary: result.summary ?? job.summary,
    touchedFiles: result.touchedFiles ?? job.touchedFiles,
    errorMessage: result.errorMessage ?? null,
    result
  };
}

export function summarizeStatus(jobs) {
  const sorted = [...jobs].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const running = sorted.filter((job) => job.status === "queued" || job.status === "running");
  const latestFinished = sorted.find((job) => job.status !== "queued" && job.status !== "running") ?? null;
  return { running, latestFinished, recent: sorted.filter((job) => job.id !== latestFinished?.id).slice(0, 8) };
}
```

- [ ] **Step 6: Run state and job tests**

Run: `node --test tests/state.test.mjs tests/jobs.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/state.mjs scripts/lib/jobs.mjs tests/state.test.mjs tests/jobs.test.mjs
git commit -m "feat: add companion state and job records"
```

## Task 5: Git Review Context Collection

**Files:**
- Create: `tests/git.test.mjs`
- Create: `scripts/lib/git.mjs`

- [ ] **Step 1: Write failing git tests**

Create `tests/git.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempGitRepo } from "./helpers.mjs";
import { collectReviewContext, resolveReviewTarget } from "../scripts/lib/git.mjs";

test("resolveReviewTarget chooses working tree when dirty", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "changed.txt"), "hello\n", "utf8");
  const target = await resolveReviewTarget(cwd, { scope: "auto" });
  assert.equal(target.mode, "working-tree");
});

test("collectReviewContext includes status and untracked text", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "changed.txt"), "hello\n", "utf8");
  const context = await collectReviewContext(cwd, { scope: "working-tree" });
  assert.equal(context.target.mode, "working-tree");
  assert.match(context.content, /Git Status/);
  assert.match(context.content, /changed.txt/);
  assert.equal(context.truncated, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/git.test.mjs`

Expected: FAIL with module-not-found for `scripts/lib/git.mjs`.

- [ ] **Step 3: Implement git module**

Create `scripts/lib/git.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./process.mjs";

const MAX_UNTRACKED_BYTES = 24 * 1024;

async function git(cwd, args) {
  const result = await runCommand("git", args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trimEnd();
}

export async function getRepoRoot(cwd) {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function getWorkingTreeState(cwd) {
  const staged = (await git(cwd, ["diff", "--cached", "--name-only"])).split("\n").filter(Boolean);
  const unstaged = (await git(cwd, ["diff", "--name-only"])).split("\n").filter(Boolean);
  const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean);
  return { staged, unstaged, untracked, isDirty: staged.length + unstaged.length + untracked.length > 0 };
}

export async function resolveReviewTarget(cwd, options = {}) {
  if (options.base) {
    return { mode: "branch", baseRef: options.base, label: `branch diff against ${options.base}` };
  }
  if (options.scope === "working-tree") {
    return { mode: "working-tree", label: "working tree diff" };
  }
  const state = await getWorkingTreeState(cwd);
  if (options.scope === "auto" || !options.scope) {
    if (state.isDirty) {
      return { mode: "working-tree", label: "working tree diff" };
    }
    return { mode: "branch", baseRef: "main", label: "branch diff against main" };
  }
  if (options.scope === "branch") {
    return { mode: "branch", baseRef: "main", label: "branch diff against main" };
  }
  throw new Error(`Unsupported review scope: ${options.scope}`);
}

function isProbablyText(buffer) {
  return !buffer.includes(0);
}

function formatUntrackedFile(cwd, relativePath) {
  const absolute = path.join(cwd, relativePath);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    return `### ${relativePath}\n(skipped: directory)`;
  }
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES})`;
  }
  const buffer = fs.readFileSync(absolute);
  if (!isProbablyText(buffer)) {
    return `### ${relativePath}\n(skipped: binary file)`;
  }
  return `### ${relativePath}\n\`\`\`\n${buffer.toString("utf8").trimEnd()}\n\`\`\``;
}

export async function collectReviewContext(cwd, options = {}) {
  const repoRoot = await getRepoRoot(cwd);
  const target = await resolveReviewTarget(cwd, options);
  const status = await git(repoRoot, ["status", "--short", "--untracked-files=all"]);
  const shortstat = await git(repoRoot, ["diff", "--shortstat"]);
  const diff = target.mode === "working-tree"
    ? await git(repoRoot, ["diff", "--no-ext-diff", "--submodule=diff"])
    : await git(repoRoot, ["diff", "--no-ext-diff", "--submodule=diff", `${target.baseRef}...HEAD`]);
  const state = await getWorkingTreeState(repoRoot);
  const untracked = state.untracked.map((file) => formatUntrackedFile(repoRoot, file)).join("\n\n");
  const content = [
    "## Git Status",
    status || "(clean)",
    "",
    "## Shortstat",
    shortstat || "(none)",
    "",
    "## Diff",
    diff || "(none)",
    "",
    "## Untracked Files",
    untracked || "(none)"
  ].join("\n");
  return {
    repoRoot,
    target,
    content,
    truncated: false,
    metadata: { changedFiles: [...new Set([...state.staged, ...state.unstaged, ...state.untracked])] }
  };
}
```

- [ ] **Step 4: Run git tests**

Run: `node --test tests/git.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/git.mjs tests/git.test.mjs
git commit -m "feat: collect git review context"
```

## Task 6: Claude Wrapper And Setup Command

**Files:**
- Create: `tests/claude.test.mjs`
- Create: `scripts/lib/claude.mjs`
- Modify: `scripts/claude-companion.mjs`

- [ ] **Step 1: Write failing Claude wrapper tests**

Create `tests/claude.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { fixtureClaudePath } from "./helpers.mjs";
import { getClaudeStatus, runClaudePrint, buildToolArgs } from "../scripts/lib/claude.mjs";

test("getClaudeStatus reads version and auth", async () => {
  const status = await getClaudeStatus({ claudeBin: fixtureClaudePath });
  assert.equal(status.available, true);
  assert.equal(status.auth.loggedIn, true);
  assert.match(status.version.stdout, /Claude Code/);
});

test("buildToolArgs maps profiles", () => {
  assert.deepEqual(buildToolArgs("none"), ["--tools", ""]);
  assert.deepEqual(buildToolArgs("read"), ["--tools", "Read,Glob,Grep,Bash(git *)"]);
  assert.deepEqual(buildToolArgs("write"), ["--tools", "Read,Glob,Grep,Bash(git *),Edit,MultiEdit,Write"]);
});

test("runClaudePrint parses json result", async () => {
  const result = await runClaudePrint({
    claudeBin: fixtureClaudePath,
    cwd: process.cwd(),
    prompt: "hello",
    toolProfile: "none"
  });
  assert.equal(result.status, 0);
  assert.equal(result.sessionId, "fake-claude-session");
  assert.match(result.output, /Fake Claude response: hello/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/claude.test.mjs`

Expected: FAIL with module-not-found for `scripts/lib/claude.mjs`.

- [ ] **Step 3: Implement Claude wrapper**

Create `scripts/lib/claude.mjs`:

```js
import { binaryAvailable, runCommand } from "./process.mjs";

export function resolveClaudeBin(options = {}) {
  return options.claudeBin || process.env.CLAUDE_COMPANION_CLAUDE_BIN || "claude";
}

export function buildToolArgs(profile) {
  if (profile === "none") {
    return ["--tools", ""];
  }
  if (profile === "read") {
    return ["--tools", "Read,Glob,Grep,Bash(git *)"];
  }
  if (profile === "write") {
    return ["--tools", "Read,Glob,Grep,Bash(git *),Edit,MultiEdit,Write"];
  }
  throw new Error(`Unknown Claude tool profile: ${profile}`);
}

export async function getClaudeStatus(options = {}) {
  const claudeBin = resolveClaudeBin(options);
  const version = await binaryAvailable(claudeBin, ["--version"], options);
  let auth = { loggedIn: false, error: null };
  if (version.available) {
    const authResult = await runCommand(claudeBin, ["auth", "status"], options);
    try {
      auth = JSON.parse(authResult.stdout);
    } catch {
      auth = { loggedIn: false, error: authResult.stderr || authResult.stdout };
    }
  }
  return { available: version.available, version, auth };
}

export async function runClaudePrint(options) {
  const claudeBin = resolveClaudeBin(options);
  const args = [
    "-p",
    "--output-format",
    "json",
    ...buildToolArgs(options.toolProfile ?? "none")
  ];
  if (options.permissionMode) {
    args.push("--permission-mode", options.permissionMode);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  args.push(options.prompt);
  const result = await runCommand(claudeBin, args, { cwd: options.cwd, env: options.env });
  let output = result.stdout;
  let sessionId = null;
  try {
    const parsed = JSON.parse(result.stdout);
    output = parsed.result ?? result.stdout;
    sessionId = parsed.session_id ?? null;
  } catch {
    output = result.stdout;
  }
  return { status: result.status, stderr: result.stderr, raw: result.stdout, output, sessionId };
}
```

- [ ] **Step 4: Wire setup command**

Modify `scripts/claude-companion.mjs` so `setup` runs real setup instead of echoing parsed args:

```js
import { getClaudeStatus } from "./lib/claude.mjs";

async function handleSetup(parsed) {
  const status = await getClaudeStatus();
  const payload = {
    ready: status.available && Boolean(status.auth.loggedIn),
    claude: status
  };
  if (parsed.options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(payload.ready ? "Claude Companion setup: ready" : "Claude Companion setup: not ready");
    if (!status.available) console.log("Install Claude Code and retry.");
    if (status.available && !status.auth.loggedIn) console.log("Run `claude auth login`.");
  }
}
```

In `main`, dispatch `setup`:

```js
if (parsed.command === "setup") {
  await handleSetup(parsed);
  return;
}
```

- [ ] **Step 5: Run Claude tests**

Run: `node --test tests/claude.test.mjs`

Expected: PASS.

- [ ] **Step 6: Run setup smoke with fake Claude**

Run:

```bash
CLAUDE_COMPANION_CLAUDE_BIN=./tests/fake-claude-fixture.mjs node scripts/claude-companion.mjs setup --json
```

Expected stdout includes `"ready": true`.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/claude.mjs scripts/claude-companion.mjs tests/claude.test.mjs
git commit -m "feat: add claude setup checks"
```

## Task 7: Rendering

**Files:**
- Create: `tests/render.test.mjs`
- Create: `scripts/lib/render.mjs`

- [ ] **Step 1: Write failing render tests**

Create `tests/render.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { renderPlanResult, renderReviewResult, renderRescueResult, renderStatus } from "../scripts/lib/render.mjs";

test("renderPlanResult preserves output", () => {
  const rendered = renderPlanResult({ output: "Architecture plan", sessionId: "s1" });
  assert.match(rendered, /Claude Plan/);
  assert.match(rendered, /Architecture plan/);
  assert.match(rendered, /s1/);
});

test("renderReviewResult includes target and truncation", () => {
  const rendered = renderReviewResult({ output: "Finding", targetLabel: "working tree diff", truncated: true });
  assert.match(rendered, /Claude Review/);
  assert.match(rendered, /working tree diff/);
  assert.match(rendered, /context was truncated/);
});

test("renderRescueResult includes write mode and touched files", () => {
  const rendered = renderRescueResult({ output: "Fixed", write: true, touchedFiles: ["a.js"] });
  assert.match(rendered, /write-enabled/);
  assert.match(rendered, /a.js/);
});

test("renderStatus creates compact table", () => {
  const rendered = renderStatus({ running: [{ id: "job-1", kind: "plan", status: "running", phase: "starting" }], latestFinished: null, recent: [] });
  assert.match(rendered, /job-1/);
  assert.match(rendered, /running/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/render.test.mjs`

Expected: FAIL with module-not-found for `scripts/lib/render.mjs`.

- [ ] **Step 3: Implement render module**

Create `scripts/lib/render.mjs`:

```js
export function renderPlanResult(result) {
  return [
    "# Claude Plan",
    "",
    result.output || "(no output)",
    "",
    result.sessionId ? `Claude session: \`${result.sessionId}\`` : ""
  ].filter(Boolean).join("\n");
}

export function renderReviewResult(result) {
  return [
    "# Claude Review",
    "",
    `Target: ${result.targetLabel}`,
    result.truncated ? "Note: review context was truncated; omitted content is recorded in metadata." : "",
    "",
    result.output || "(no output)"
  ].filter(Boolean).join("\n");
}

export function renderRescueResult(result) {
  const mode = result.write ? "write-enabled" : "read-only";
  const files = result.touchedFiles?.length ? result.touchedFiles.map((file) => `- ${file}`).join("\n") : "(none)";
  return [
    "# Claude Rescue",
    "",
    `Mode: ${mode}`,
    "",
    "## Output",
    "",
    result.output || "(no output)",
    "",
    "## Touched Files",
    "",
    files
  ].join("\n");
}

export function renderStatus(snapshot) {
  const rows = [["Job", "Kind", "Status", "Phase"]];
  for (const job of snapshot.running ?? []) rows.push([job.id, job.kind, job.status, job.phase ?? ""]);
  if (snapshot.latestFinished) rows.push([snapshot.latestFinished.id, snapshot.latestFinished.kind, snapshot.latestFinished.status, snapshot.latestFinished.phase ?? ""]);
  return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}
```

- [ ] **Step 4: Run render tests**

Run: `node --test tests/render.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/render.mjs tests/render.test.mjs
git commit -m "feat: render companion outputs"
```

## Task 8: Foreground Plan, Review, Adversarial Review, And Rescue

**Files:**
- Create: `tests/cli-foreground.test.mjs`
- Modify: `scripts/claude-companion.mjs`

- [ ] **Step 1: Write failing foreground CLI tests**

Create `tests/cli-foreground.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempGitRepo, runCli } from "./helpers.mjs";

test("plan runs fake Claude and renders plan", async () => {
  const result = await runCli(["plan", "design", "this"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Claude Plan/);
  assert.match(result.stdout, /design this/);
});

test("review collects git context and renders review", async () => {
  const cwd = await makeTempGitRepo();
  fs.writeFileSync(path.join(cwd, "changed.txt"), "hello\n", "utf8");
  const result = await runCli(["review", "--scope", "working-tree"], { cwd });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Claude Review/);
  assert.match(result.stdout, /working tree diff/);
});

test("review rejects custom focus text", async () => {
  const result = await runCli(["review", "focus"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Custom review focus belongs in adversarial-review/);
});

test("rescue write renders write-enabled mode", async () => {
  const result = await runCli(["rescue", "--write", "fix", "it"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /write-enabled/);
});
```

- [ ] **Step 2: Run foreground tests to verify they fail**

Run: `node --test tests/cli-foreground.test.mjs`

Expected: FAIL because CLI still echoes parsed args.

- [ ] **Step 3: Implement foreground command handlers**

Modify `scripts/claude-companion.mjs` to import runtime modules:

```js
import { readPromptFromParsedInput } from "./lib/args.mjs";
import { runClaudePrint } from "./lib/claude.mjs";
import { collectReviewContext } from "./lib/git.mjs";
import { renderPlanResult, renderReviewResult, renderRescueResult } from "./lib/render.mjs";
```

Add handlers:

```js
async function handlePlan(parsed) {
  const prompt = readPromptFromParsedInput(parsed);
  if (!prompt) throw new Error("Provide a planning prompt.");
  const result = await runClaudePrint({ cwd: process.cwd(), prompt, toolProfile: "read", permissionMode: "plan", model: parsed.options.model, effort: parsed.options.effort });
  console.log(renderPlanResult(result));
}

async function handleReview(parsed, adversarial = false) {
  if (!adversarial && parsed.positionals.length > 0) {
    throw new Error("Custom review focus belongs in adversarial-review.");
  }
  const context = await collectReviewContext(process.cwd(), { base: parsed.options.base, scope: parsed.options.scope ?? "auto" });
  const focus = adversarial ? readPromptFromParsedInput(parsed) : "";
  const prompt = [
    adversarial ? "Run an adversarial review of this context." : "Run a code review of this context.",
    focus ? `Focus: ${focus}` : "",
    context.content
  ].filter(Boolean).join("\n\n");
  const result = await runClaudePrint({ cwd: context.repoRoot, prompt, toolProfile: "none" });
  console.log(renderReviewResult({ ...result, targetLabel: context.target.label, truncated: context.truncated }));
}

async function handleRescue(parsed) {
  const prompt = readPromptFromParsedInput(parsed);
  if (!prompt && !parsed.options.resume) throw new Error("Provide a rescue prompt or --resume.");
  const result = await runClaudePrint({
    cwd: process.cwd(),
    prompt: prompt || "Continue the previous Claude Companion rescue task.",
    toolProfile: parsed.options.write ? "write" : "read",
    model: parsed.options.model,
    effort: parsed.options.effort
  });
  console.log(renderRescueResult({ ...result, write: Boolean(parsed.options.write), touchedFiles: [] }));
}
```

Dispatch:

```js
if (parsed.command === "plan") return handlePlan(parsed);
if (parsed.command === "review") return handleReview(parsed, false);
if (parsed.command === "adversarial-review") return handleReview(parsed, true);
if (parsed.command === "rescue") return handleRescue(parsed);
```

- [ ] **Step 4: Run foreground CLI tests**

Run: `node --test tests/cli-foreground.test.mjs`

Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/claude-companion.mjs tests/cli-foreground.test.mjs
git commit -m "feat: run foreground claude companion commands"
```

## Task 9: Background Jobs, Status, Result, And Cancel

**Files:**
- Create: `tests/cli-background.test.mjs`
- Modify: `scripts/claude-companion.mjs`
- Modify: `scripts/lib/jobs.mjs`
- Modify: `scripts/lib/state.mjs`

- [ ] **Step 1: Write failing background CLI tests**

Create `tests/cli-background.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { makeTempDir, runCli } from "./helpers.mjs";

test("background plan creates job and result can be read", async () => {
  const stateDir = makeTempDir("background-state-");
  const launch = await runCli(["plan", "--background", "background", "plan"], { stateDir });
  assert.equal(launch.status, 0);
  const match = launch.stdout.match(/(plan-[a-z0-9-]+)/);
  assert.ok(match);
  const jobId = match[1];

  for (let index = 0; index < 20; index += 1) {
    const status = await runCli(["status", jobId, "--json"], { stateDir });
    if (status.stdout.includes("completed")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const result = await runCli(["result", jobId], { stateDir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Claude Plan/);
});

test("cancel reports missing job", async () => {
  const result = await runCli(["cancel", "job-missing"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No job found/);
});
```

- [ ] **Step 2: Run background tests to verify they fail**

Run: `node --test tests/cli-background.test.mjs`

Expected: FAIL because background/status/result/cancel are not implemented.

- [ ] **Step 3: Add job index helpers**

Modify `scripts/lib/state.mjs` with:

```js
export function resolveStateFile(workspaceRoot, env = process.env) {
  const dir = resolveStateDir(workspaceRoot, env);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "state.json");
}

export function readState(workspaceRoot, env = process.env) {
  const file = resolveStateFile(workspaceRoot, env);
  if (!fs.existsSync(file)) return { version: 1, jobs: [] };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeState(workspaceRoot, state, env = process.env) {
  const file = resolveStateFile(workspaceRoot, env);
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, jobs: state.jobs ?? [] }, null, 2)}\n`, "utf8");
  return file;
}

export function upsertJob(workspaceRoot, job, env = process.env) {
  const state = readState(workspaceRoot, env);
  const rest = state.jobs.filter((entry) => entry.id !== job.id);
  writeState(workspaceRoot, { jobs: [job, ...rest].slice(0, 50) }, env);
  writeJobFile(workspaceRoot, job.id, job, env);
}
```

- [ ] **Step 4: Add status and result helpers**

Modify `scripts/lib/jobs.mjs` with:

```js
export function findJob(jobs, reference) {
  const exact = jobs.find((job) => job.id === reference);
  if (exact) return exact;
  const matches = jobs.filter((job) => job.id.startsWith(reference));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Job reference "${reference}" is ambiguous.`);
  throw new Error(`No job found for "${reference}".`);
}
```

- [ ] **Step 5: Implement background command path**

Modify `scripts/claude-companion.mjs`:

- For `plan/review/adversarial-review/rescue` with `--background`, create a job with `createJobRecord`, persist with `upsertJob`, spawn `node scripts/claude-companion.mjs run-job <job-id>`, and print `<kind> started in the background as <job-id>`.
- `run-job` reads the job file, calls the corresponding foreground handler without printing to the parent stdout, stores rendered result, and marks completed or failed.
- `status` reads state and renders `renderStatus`.
- `result` reads the selected job file and prints stored `result.rendered`.
- `cancel` finds running jobs and calls `terminateProcessTree`.

Use this command construction for workers:

```js
const child = spawn(process.execPath, [new URL(import.meta.url).pathname, "run-job", job.id], {
  cwd: job.cwd,
  env: process.env,
  detached: true,
  stdio: "ignore"
});
child.unref();
```

- [ ] **Step 6: Run background CLI tests**

Run: `node --test tests/cli-background.test.mjs`

Expected: PASS.

- [ ] **Step 7: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/claude-companion.mjs scripts/lib/jobs.mjs scripts/lib/state.mjs tests/cli-background.test.mjs
git commit -m "feat: add background job management"
```

## Task 10: Codex Skills

**Files:**
- Create: `skills/claude-plan/SKILL.md`
- Create: `skills/claude-review/SKILL.md`
- Create: `skills/claude-rescue/SKILL.md`
- Create: `skills/claude-result-handling/SKILL.md`
- Create: `tests/skills.test.mjs`

- [ ] **Step 1: Write skill validation tests**

Create `tests/skills.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const skillPaths = [
  "skills/claude-plan/SKILL.md",
  "skills/claude-review/SKILL.md",
  "skills/claude-rescue/SKILL.md",
  "skills/claude-result-handling/SKILL.md"
];

test("all skills exist and reference companion CLI", () => {
  for (const file of skillPaths) {
    const body = fs.readFileSync(file, "utf8");
    assert.match(body, /^---\nname:/);
    assert.match(body, /claude-companion\.mjs/);
  }
});

test("review skill does not allow write mode", () => {
  const body = fs.readFileSync("skills/claude-review/SKILL.md", "utf8");
  assert.doesNotMatch(body, /--write/);
  assert.match(body, /Do not fix/);
});

test("rescue skill makes write explicit", () => {
  const body = fs.readFileSync("skills/claude-rescue/SKILL.md", "utf8");
  assert.match(body, /--write/);
  assert.match(body, /explicit/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/skills.test.mjs`

Expected: FAIL because skills do not exist.

- [ ] **Step 3: Create plan skill**

Create `skills/claude-plan/SKILL.md`:

```markdown
---
name: claude-plan
description: Use when the user wants Claude Code to plan architecture, design, specs, sequencing, risks, or implementation strategy from inside Codex.
---

# Claude Plan

Use this skill to delegate planning to Claude Code through the companion CLI.

Rules:

- Planning is read-only.
- Do not ask Claude to edit files.
- Use foreground for small planning requests.
- Use background for broad repo planning or multi-step architecture review.
- Invoke the companion through the plugin root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" plan "$ARGUMENTS"
```

For background:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" plan --background "$ARGUMENTS"
```

Return the companion output to the user. Do not rewrite Claude's plan unless the user asks for a summary.
```

- [ ] **Step 4: Create review skill**

Create `skills/claude-review/SKILL.md`:

```markdown
---
name: claude-review
description: Use when the user wants Claude Code to review code, review risks, challenge an approach, or run an adversarial review from inside Codex.
---

# Claude Review

Use this skill to delegate read-only review to Claude Code.

Rules:

- Review is read-only.
- Do not fix issues.
- Do not apply patches.
- Use `review` for normal code review.
- Use `adversarial-review` when the user asks to challenge assumptions, design direction, tradeoffs, hidden risks, rollback, data loss, race conditions, or alternatives.

Normal review:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" review "$ARGUMENTS"
```

Adversarial review:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" adversarial-review "$ARGUMENTS"
```

Return the companion output. If findings are reported, do not start fixing them in the same turn unless the user explicitly asks.
```

- [ ] **Step 5: Create rescue skill**

Create `skills/claude-rescue/SKILL.md`:

```markdown
---
name: claude-rescue
description: Use when the user explicitly wants Claude Code to investigate, fix, implement, apply a plan, or continue delegated work from inside Codex.
---

# Claude Rescue

Use this skill to delegate investigation or implementation work to Claude Code.

Rules:

- Investigation defaults to read-only.
- Add `--write` only when the user explicitly asks Claude to fix, implement, edit, apply a plan, or continue write-capable work.
- Do not add dangerous bypass flags.
- For follow-up work, prefer `--resume` only when the previous job belongs to this workspace.

Read-only investigation:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" rescue "$ARGUMENTS"
```

Write-enabled rescue:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" rescue --write "$ARGUMENTS"
```

Background write-enabled rescue:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" rescue --background --write "$ARGUMENTS"
```

Return the companion output exactly enough that the user can inspect changed files, verification, and residual risk.
```

- [ ] **Step 6: Create result handling skill**

Create `skills/claude-result-handling/SKILL.md`:

```markdown
---
name: claude-result-handling
description: Use when the user wants Claude Companion setup, status, result, cancellation, or stored delegated job output.
---

# Claude Result Handling

Use this skill to manage Claude Companion jobs.

Setup:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" setup
```

Status:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" status "$ARGUMENTS"
```

Result:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" result "$ARGUMENTS"
```

Cancel:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-companion.mjs" cancel "$ARGUMENTS"
```

Present status compactly. Present result output fully, preserving paths, line numbers, errors, and changed-file summaries.
```

- [ ] **Step 7: Run skill tests**

Run: `node --test tests/skills.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add skills/claude-plan/SKILL.md skills/claude-review/SKILL.md skills/claude-rescue/SKILL.md skills/claude-result-handling/SKILL.md tests/skills.test.mjs
git commit -m "feat: add claude companion skills"
```

## Task 11: Final Verification And Documentation Tightening

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-02-claude-companion-codex-plugin-design.md` only if implementation diverged from the spec during execution

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run manifest check**

Run: `npm run check:manifest`

Expected: PASS.

- [ ] **Step 3: Run fake setup smoke**

Run:

```bash
CLAUDE_COMPANION_CLAUDE_BIN=./tests/fake-claude-fixture.mjs node scripts/claude-companion.mjs setup --json
```

Expected stdout includes:

```json
"ready": true
```

- [ ] **Step 4: Run fake foreground smoke**

Run:

```bash
CLAUDE_COMPANION_CLAUDE_BIN=./tests/fake-claude-fixture.mjs node scripts/claude-companion.mjs plan "plan the plugin"
```

Expected stdout includes:

```text
# Claude Plan
```

- [ ] **Step 5: Run fake review smoke in a temp dirty repo**

Create a temp repo manually:

```bash
tmpdir="$(mktemp -d)"
git -C "$tmpdir" init -q
git -C "$tmpdir" config user.email test@example.com
git -C "$tmpdir" config user.name "Test User"
printf "initial\n" > "$tmpdir/README.md"
git -C "$tmpdir" add README.md
git -C "$tmpdir" commit -m initial
printf "changed\n" > "$tmpdir/changed.txt"
CLAUDE_COMPANION_CLAUDE_BIN="$PWD/tests/fake-claude-fixture.mjs" node scripts/claude-companion.mjs review --scope working-tree
```

Expected stdout includes:

```text
# Claude Review
Target: working tree diff
```

- [ ] **Step 6: Update README with verified behavior**

Modify `README.md` to include:

```markdown
## Safety Model

- `plan`, `review`, and `adversarial-review` are read-only companion commands.
- `rescue` is read-only unless `--write` is present.
- Dangerous Claude Code bypass flags are rejected by the companion.
- Job state is stored outside the reviewed project by default.

## Testing

```bash
npm test
npm run check:manifest
```
```

- [ ] **Step 7: Run final git status**

Run: `git status --short`

Expected: only intentional README or spec changes.

- [ ] **Step 8: Commit final docs**

```bash
git add README.md docs/superpowers/specs/2026-06-02-claude-companion-codex-plugin-design.md
git commit -m "docs: document claude companion verification"
```

If the spec did not change, use:

```bash
git add README.md
git commit -m "docs: document claude companion verification"
```

## Self-Review Notes

Spec coverage:

- Plugin manifest and skills: Tasks 1 and 10.
- No MCP: Task 1 manifest contains no `mcpServers`; Task 10 skills call CLI.
- Companion CLI: Tasks 3, 6, 8, and 9.
- Plan/review read-only: Tasks 6, 8, and 10 use tool profiles and skill rules.
- Rescue explicit write: Tasks 3, 6, 8, and 10 parse and route `--write`.
- Git context collection: Task 5.
- State outside project: Task 4.
- Background status/result/cancel: Task 9.
- Output protocol: Task 7.
- Fake Claude testing: Task 2 and Task 6.

Placeholder scan:

- The plan contains no placeholder markers.
- Every task names exact files, commands, expected output, and commit scope.

Type consistency:

- Job ids use `<kind>-<timestamp>-<random>`.
- `workspaceRoot`, `claudeSessionId`, `touchedFiles`, and `write` names are consistent with the design spec.
