import fs from "node:fs";
import path from "node:path";
import { assertNoDangerousArgs } from "./args.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

const TOOL_PROFILES = {
  none: "",
  read: "Read,Glob,Grep",
  write: "Read,Glob,Grep,Edit,MultiEdit,Write"
};

const TOOL_CONTROL_FLAGS = new Set([
  "--tools",
  "--allowedTools",
  "--disallowedTools",
  "--mcp-config"
]);

const SAFE_EXTRA_BOOLEAN_FLAGS = new Set([
  "--verbose"
]);

const SAFE_EXTRA_VALUE_FLAGS = new Set([
  "--max-turns"
]);

export function resolveClaudeBin(options = {}) {
  if (options.claudeBin) {
    return options.claudeBin;
  }
  const env = options.env ?? process.env;
  if (env.CLAUDE_COMPANION_CLAUDE_BIN) {
    return env.CLAUDE_COMPANION_CLAUDE_BIN;
  }
  return discoverClaudeBin(env) ?? "claude";
}

function discoverClaudeBin(env = process.env) {
  return commonClaudeBinCandidates(env).find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

function commonClaudeBinCandidates(env = process.env) {
  const candidates = [];
  const home = env.HOME || env.USERPROFILE;
  if (home) {
    candidates.push(
      path.join(home, ".local", "bin", "claude"),
      path.join(home, ".claude", "local", "claude")
    );
  }
  candidates.push(
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude"
  );
  return [...new Set(candidates)];
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

function flagName(arg) {
  const equalsIndex = arg.indexOf("=");
  return equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
}

function validateMaxTurns(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`Claude --max-turns must be a positive integer: ${value}`);
  }
}

function normalizeSafeExtraArgs(argv) {
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const flag = flagName(arg);

    if (!arg.startsWith("--")) {
      throw new Error(`Unsupported Claude extra arg: ${arg}`);
    }

    if (SAFE_EXTRA_BOOLEAN_FLAGS.has(flag)) {
      if (arg.includes("=")) {
        throw new Error(`Claude extra arg does not accept a value: ${flag}`);
      }
      args.push(flag);
      continue;
    }

    if (SAFE_EXTRA_VALUE_FLAGS.has(flag)) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
      if (!value || (!arg.includes("=") && value.startsWith("--"))) {
        throw new Error(`Missing value for Claude extra arg: ${flag}`);
      }
      if (flag === "--max-turns") {
        validateMaxTurns(value);
      }
      args.push(flag, value);
      if (!arg.includes("=")) {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unsupported Claude extra arg: ${flag}`);
  }
  return args;
}

function readPrompt(options = {}) {
  if (options.promptFile) {
    const cwd = options.cwd ?? process.cwd();
    const promptFile = path.resolve(cwd, options.promptFile);
    return fs.readFileSync(promptFile, "utf8");
  }
  return options.prompt ?? "";
}

function resolvePromptMode(options = {}) {
  const promptMode = options.promptMode ?? "stdin";
  if (promptMode !== "stdin") {
    throw new Error(`Unsupported Claude prompt mode: ${promptMode}`);
  }
  return promptMode;
}

export function buildClaudeArgs(options = {}) {
  resolvePromptMode(options);
  const requestedExtraArgs = normalizeStringArray(options.extraArgs, "extraArgs");
  assertNoDangerousArgs(requestedExtraArgs);
  assertNoToolControlArgs(requestedExtraArgs);
  const extraArgs = normalizeSafeExtraArgs(requestedExtraArgs);

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
  const promptMode = resolvePromptMode(options);
  const prompt = readPrompt(options);
  const args = buildClaudeArgs(options);
  const result = await runCommand(claudeBin, args, {
    cwd: options.cwd,
    env: options.env,
    stdin: promptMode === "stdin" ? prompt : undefined,
    timeoutMs: options.timeoutMs,
    onStart: options.onStart,
    onStdout: options.onStdout,
    onStderr: options.onStderr
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
