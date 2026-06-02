import fs from "node:fs";
import path from "node:path";
import { assertNoDangerousArgs } from "./args.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

const TOOL_PROFILES = {
  none: "",
  read: "Read,Glob,Grep,Bash(git *)",
  write: "Read,Glob,Grep,Bash(git *),Edit,MultiEdit,Write"
};

const TOOL_CONTROL_FLAGS = new Set([
  "--tools",
  "--allowedTools",
  "--disallowedTools",
  "--mcp-config"
]);

export function resolveClaudeBin(options = {}) {
  return options.claudeBin || process.env.CLAUDE_COMPANION_CLAUDE_BIN || "claude";
}

export function buildToolArgs(profile = "none") {
  if (!Object.hasOwn(TOOL_PROFILES, profile)) {
    throw new Error(`Unknown Claude tool profile: ${profile}`);
  }
  return ["--tools", TOOL_PROFILES[profile]];
}

function normalizeStringArray(value, name) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

function assertNoToolControlArgs(argv) {
  for (const arg of argv) {
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (TOOL_CONTROL_FLAGS.has(flag)) {
      throw new Error("Claude tool flags must be selected with toolProfile");
    }
  }
}

function readPrompt(options = {}) {
  if (options.promptFile) {
    const cwd = options.cwd ?? process.cwd();
    const promptFile = path.resolve(cwd, options.promptFile);
    return fs.readFileSync(promptFile, "utf8");
  }
  return options.prompt ?? "";
}

export function buildClaudeArgs(options = {}) {
  const extraArgs = normalizeStringArray(options.extraArgs, "extraArgs");
  assertNoDangerousArgs(extraArgs);
  assertNoToolControlArgs(extraArgs);

  const args = [
    "-p",
    "--output-format",
    options.outputFormat ?? "json",
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
  args.push(...extraArgs);

  if (options.promptMode !== "stdin") {
    args.push(readPrompt(options));
  }

  assertNoDangerousArgs(args);
  return args;
}

export async function getClaudeStatus(options = {}) {
  const claudeBin = resolveClaudeBin(options);
  const version = await binaryAvailable(claudeBin, ["--version"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs
  });
  const status = {
    ready: false,
    available: version.available,
    claudeBin,
    version,
    auth: {
      checked: false,
      loggedIn: false,
      error: null
    }
  };

  if (!version.available) {
    return status;
  }

  const authResult = await runCommand(claudeBin, ["auth", "status"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs
  });
  status.auth.checked = true;
  status.auth.status = authResult.status;
  status.auth.stderr = authResult.stderr;
  try {
    const parsed = JSON.parse(authResult.stdout);
    status.auth = {
      ...status.auth,
      ...parsed,
      loggedIn: Boolean(parsed.loggedIn)
    };
  } catch {
    status.auth.error = authResult.error
      ? authResult.error.message
      : authResult.stderr || authResult.stdout || (authResult.status === 0 ? null : "Claude auth status failed");
  }
  status.ready = status.available && Boolean(status.auth.loggedIn);
  return status;
}

function parseClaudeJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch {
        // Keep looking for the last JSON payload in streaming output.
      }
    }
  }
  return null;
}

export async function runClaudePrint(options = {}) {
  const claudeBin = resolveClaudeBin(options);
  const prompt = readPrompt(options);
  const args = buildClaudeArgs(options);
  const result = await runCommand(claudeBin, args, {
    cwd: options.cwd,
    env: options.env,
    stdin: options.promptMode === "stdin" ? prompt : undefined,
    timeoutMs: options.timeoutMs
  });
  const parsed = parseClaudeJson(result.stdout);
  const output = parsed?.result ?? result.stdout;

  return {
    status: result.status,
    signal: result.signal ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
    raw: result.stdout,
    output,
    sessionId: parsed?.session_id ?? parsed?.sessionId ?? null,
    error: result.error ?? null,
    timedOut: Boolean(result.timedOut),
    claudeBin,
    args
  };
}
