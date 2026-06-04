import fs from "node:fs";
import path from "node:path";
import { binaryAvailable, runCommand } from "./process.mjs";
import { assertNoDangerousFlags, flagName } from "./safety.mjs";

const SAFE_EXTRA_BOOLEAN_FLAGS = new Set([
  "--sandbox",
  "--continue"
]);

const SAFE_EXTRA_VALUE_FLAGS = new Set([
  "--print-timeout",
  "--add-dir",
  "--conversation"
]);

export function resolveAgyBin(options = {}) {
  if (options.agyBin) {
    return options.agyBin;
  }
  const env = options.env ?? process.env;
  if (env.ANTIGRAVITY_COMPANION_AGY_BIN) {
    return env.ANTIGRAVITY_COMPANION_AGY_BIN;
  }
  return discoverAgyBin(env) ?? "agy";
}

function discoverAgyBin(env = process.env) {
  return commonAgyBinCandidates(env).find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

function commonAgyBinCandidates(env = process.env) {
  const candidates = [];
  const home = env.HOME || env.USERPROFILE;
  if (home) {
    candidates.push(
      path.join(home, ".local", "bin", "agy")
    );
  }
  candidates.push(
    "/opt/homebrew/bin/agy",
    "/usr/local/bin/agy"
  );
  return [...new Set(candidates)];
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

function assertNoDangerousAgyArgs(argv) {
  assertNoDangerousFlags(argv);
}

function normalizeSafeExtraArgs(argv) {
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const flag = flagName(arg);

    if (!arg.startsWith("--")) {
      throw new Error(`Unsupported Antigravity extra arg: ${arg}`);
    }

    if (SAFE_EXTRA_BOOLEAN_FLAGS.has(flag)) {
      if (arg.includes("=")) {
        throw new Error(`Antigravity extra arg does not accept a value: ${flag}`);
      }
      args.push(flag);
      continue;
    }

    if (SAFE_EXTRA_VALUE_FLAGS.has(flag)) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
      if (!value || (!arg.includes("=") && value.startsWith("--"))) {
        throw new Error(`Missing value for Antigravity extra arg: ${flag}`);
      }
      args.push(flag, value);
      if (!arg.includes("=")) {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unsupported Antigravity extra arg: ${flag}`);
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

function shouldUseSandbox(options = {}) {
  if (typeof options.sandbox === "boolean") {
    return options.sandbox;
  }
  return options.toolProfile !== "write";
}

function appendValueOption(args, flag, value) {
  if (value !== undefined && value !== null && value !== "") {
    args.push(flag, String(value));
  }
}

function appendRepeatedValueOption(args, flag, values) {
  for (const value of normalizeStringArray(values, flag)) {
    args.push(flag, value);
  }
}

function detectAgyRuntimeError(result) {
  if (result.status !== 0 || result.error) {
    return null;
  }

  const combined = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  const patterns = [
    /authentication timed out/i,
    /please sign in/i,
    /not authenticated/i,
    /oauth.*timed out/i,
    /invalid array length/i
  ];
  const matched = patterns.find((pattern) => pattern.test(combined));
  return matched ? (combined.match(matched)?.[0] ?? "Antigravity runtime error") : null;
}

export function buildAgyArgs(options = {}) {
  const prompt = readPrompt(options);
  const requestedExtraArgs = normalizeStringArray(options.extraArgs, "extraArgs");
  assertNoDangerousAgyArgs(requestedExtraArgs);
  const extraArgs = normalizeSafeExtraArgs(requestedExtraArgs);

  const args = ["--print"];
  if (shouldUseSandbox(options)) {
    args.push("--sandbox");
  }
  appendValueOption(args, "--model", options.model);
  appendValueOption(args, "--print-timeout", options.printTimeout);
  appendRepeatedValueOption(args, "--add-dir", options.addDirs);
  if (options.continueConversation) {
    args.push("--continue");
  }
  appendValueOption(args, "--conversation", options.conversation);
  args.push(...extraArgs);
  args.push("--", prompt);

  assertNoDangerousAgyArgs(args.slice(0, -1));
  return args;
}

export async function getAgyStatus(options = {}) {
  const agyBin = resolveAgyBin(options);
  const version = await binaryAvailable(agyBin, ["--version"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs
  });

  return {
    ready: version.available,
    available: version.available,
    agyBin,
    version,
    auth: {
      checked: false,
      required: false,
      loggedIn: null,
      error: null
    }
  };
}

function parseAgyJson(stdout) {
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
        // Keep looking for a final JSON envelope, but plain text output is valid too.
      }
    }
  }
  return null;
}

export async function runAgyPrint(options = {}) {
  const agyBin = resolveAgyBin(options);
  const args = buildAgyArgs(options);
  const result = await runCommand(agyBin, args, {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs,
    onStart: options.onStart,
    onStdout: options.onStdout,
    onStderr: options.onStderr
  });
  const parsed = parseAgyJson(result.stdout);
  const output = parsed?.result ?? parsed?.output ?? parsed?.text ?? result.stdout;
  const runtimeError = detectAgyRuntimeError(result);

  return {
    status: runtimeError ? 1 : result.status,
    signal: result.signal ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
    raw: result.stdout,
    output,
    sessionId: parsed?.session_id ?? parsed?.sessionId ?? parsed?.conversation_id ?? parsed?.conversationId ?? null,
    error: result.error ?? (runtimeError ? new Error(runtimeError) : null),
    timedOut: Boolean(result.timedOut),
    agyBin,
    args
  };
}
