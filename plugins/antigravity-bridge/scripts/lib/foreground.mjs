import path from "node:path";
import { readPromptFromParsedInput } from "./args.mjs";
import { runAgyPrint } from "./agy.mjs";
import { collectReviewContext } from "./git-context.mjs";
import {
  renderAdversarialReviewResult,
  renderPlanResult,
  renderRescueResult,
  renderReviewResult
} from "./render.mjs";
import {
  collectGitTouchedFiles,
  isolationMetadata,
  prepareIsolatedWorkspace,
  removeIsolatedWorkspace
} from "./workspace-isolation.mjs";

const FOREGROUND_COMMANDS = new Set(["plan", "review", "adversarial-review", "rescue"]);
const VALID_SCOPES = new Set(["auto", "working-tree", "branch"]);
const JOB_TAIL_BYTES = 4096;

function hasDeferredMode(parsed) {
  return parsed.options.background || parsed.options.wait;
}

function rejectDeferredMode(parsed) {
  if (hasDeferredMode(parsed)) {
    throw new Error("Deferred foreground execution is handled by companion dispatch; call the CLI entrypoint for --background or --wait.");
  }
}

function resolveCwd(parsed, runtime = {}) {
  const baseCwd = runtime.cwd ?? process.cwd();
  return parsed.options.cwd ? path.resolve(baseCwd, parsed.options.cwd) : baseCwd;
}

function positiveIntegerOption(options, names, label) {
  for (const name of names) {
    if (options[name] === undefined) {
      continue;
    }
    if (!/^[1-9]\d*$/.test(String(options[name]))) {
      throw new Error(`${label} must be a positive integer.`);
    }
    return Number.parseInt(String(options[name]), 10);
  }
  return undefined;
}

function timeoutMs(options) {
  return positiveIntegerOption(options, ["timeout-ms", "timeout"], "Timeout");
}

function utf8Tail(value, maxBytes = JOB_TAIL_BYTES) {
  const text = String(value ?? "");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(chars.slice(chars.length - mid).join(""), "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return chars.slice(chars.length - low).join("");
}

function agyJobHooks(runtime = {}) {
  if (typeof runtime.updateJob !== "function") {
    return {};
  }
  let stdoutTail = "";
  let stderrTail = "";
  let firstOutputAt = null;
  const recordOutput = (field, chunk) => {
    const now = new Date().toISOString();
    firstOutputAt ??= now;
    if (field === "stdoutTail") {
      stdoutTail = utf8Tail(`${stdoutTail}${chunk}`);
    } else {
      stderrTail = utf8Tail(`${stderrTail}${chunk}`);
    }
    runtime.updateJob({
      [field]: field === "stdoutTail" ? stdoutTail : stderrTail,
      firstOutputAt,
      lastOutputAt: now,
      phase: "agy_output"
    }, `agy ${field === "stdoutTail" ? "stdout" : "stderr"} output`);
  };
  return {
    onStart: ({ pid, command, args }) => {
      runtime.updateJob({
        agyPid: pid,
        agyCommand: command,
        agyArgv: [...args],
        phase: "agy_spawned"
      }, `agy spawned pid ${pid}`);
    },
    onStdout: (chunk) => recordOutput("stdoutTail", chunk),
    onStderr: (chunk) => recordOutput("stderrTail", chunk)
  };
}

function reviewContextOptions(options) {
  if (options.scope && !VALID_SCOPES.has(options.scope)) {
    throw new Error(`Unsupported review scope: ${options.scope}`);
  }

  return {
    against: options.against ?? options.base,
    base: options.base,
    scope: options.scope ?? "auto",
    maxDiffBytes: positiveIntegerOption(options, ["max-diff-bytes", "max-diff"], "Max diff cap"),
    maxUntrackedFileBytes: positiveIntegerOption(
      options,
      ["max-untracked-file-bytes", "max-untracked-bytes", "max-untracked"],
      "Max untracked file cap"
    )
  };
}

function agyRuntimeOptions(parsed, cwd, runtime, prompt, toolProfile, extra = {}) {
  return {
    agyBin: runtime.agyBin ?? runtime.env?.ANTIGRAVITY_COMPANION_AGY_BIN,
    cwd,
    env: runtime.env,
    prompt,
    model: parsed.options.model,
    toolProfile,
    timeoutMs: timeoutMs(parsed.options),
    ...agyJobHooks(runtime),
    ...extra
  };
}

function mergeResultMetadata(result, metadata) {
  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      ...metadata
    }
  };
}

function errorMessage(error) {
  if (!error) {
    return "";
  }
  return error instanceof Error ? error.message : String(error);
}

function readOnlyViolationError(touchedFiles, result) {
  const base = `Antigravity modified the read-only isolated workspace: ${touchedFiles.join(", ")}`;
  const original = errorMessage(result.error);
  return new Error(original ? `${base}; original agy error: ${original}` : base);
}

function composeIsolatedPrompt(prompt, isolation) {
  return [
    "Antigravity Bridge safety context:",
    `- Original workspace: ${isolation.originalCwd}`,
    `- Current execution workspace: ${isolation.isolatedCwd}`,
    "- The current execution workspace is disposable. Treat it as a read-only snapshot for analysis only.",
    "- Do not edit files, create commits, run write commands, install dependencies, or change project state.",
    "- If any file changes are detected in this disposable workspace, the companion will mark the run as failed.",
    "",
    prompt
  ].join("\n");
}

async function runReadOnlyAgyPrint(parsed, cwd, runtime, prompt, options = {}) {
  const isolation = await prepareIsolatedWorkspace(cwd, {
    env: runtime.env,
    includeWorkspace: options.includeWorkspace
  });

  try {
    const result = await runAgyPrint(agyRuntimeOptions(
      parsed,
      isolation.isolatedCwd,
      runtime,
      composeIsolatedPrompt(prompt, isolation),
      "read",
      options.runtimeOptions
    ));
    const touchedFiles = await collectGitTouchedFiles(isolation.snapshotRoot, {
      env: runtime.env,
      includeIgnored: true
    });
    const metadata = isolationMetadata(isolation, {
      touchedFiles,
      readOnlyViolation: touchedFiles.length > 0
    });
    if (touchedFiles.length > 0) {
      return mergeResultMetadata({
        ...result,
        status: "failed",
        touchedFiles,
        error: readOnlyViolationError(touchedFiles, result)
      }, metadata);
    }
    return mergeResultMetadata(result, metadata);
  } finally {
    await removeIsolatedWorkspace(isolation);
  }
}

function targetLabelForContext(context) {
  if (context.baseline?.ref) {
    return `diff against ${context.baseline.ref}`;
  }
  return "working tree diff";
}

function reviewMetadata(context) {
  return {
    targetLabel: targetLabelForContext(context),
    truncated: Boolean(context.truncated),
    metadata: {
      ...context.metadata,
      baseline: context.baseline,
      changedFiles: context.changedFiles,
      currentBranch: context.currentBranch,
      isGitRepository: context.isGitRepository,
      repoRoot: context.repoRoot
    }
  };
}

function normalizeResult(kind, result, options = {}) {
  if (kind === "plan") {
    return renderPlanResult(result, { json: true, ...options });
  }
  if (kind === "review") {
    return renderReviewResult(result, { json: true, ...options });
  }
  if (kind === "adversarial-review") {
    return renderAdversarialReviewResult(result, { json: true, ...options });
  }
  if (kind === "rescue") {
    return renderRescueResult(result, { json: true, ...options });
  }
  throw new Error(`Unsupported foreground command: ${kind}`);
}

export function formatForegroundResult(result, options = {}) {
  return options.json ? JSON.stringify(result, null, 2) : result.rendered;
}

function readPrompt(parsed, cwd) {
  return readPromptFromParsedInput(parsed, { cwd }).trim();
}

function composePlanPrompt(userPrompt) {
  return [
    "You are Antigravity assisting Codex in read-only planning mode.",
    "Produce a full implementation or review plan for the request. Cover scope, affected files, sequencing, risks, assumptions, rollback, and verification.",
    "Do not edit files, create commits, run write commands, or change project state. Return a plan for Codex to execute or review.",
    "User request:",
    userPrompt
  ].join("\n\n");
}

function composeReviewPrompt(context, focus = "") {
  return [
    "You are Antigravity acting as a conservative code reviewer for Codex.",
    "Use only the git context below. Do not edit files or ask for write access.",
    "Prioritize concrete bugs, behavioral regressions, security/data-loss risks, missing tests, and unclear rollout risk. Put findings first with file and line references when the context supports them. If there are no findings, say that clearly and mention residual risk.",
    focus ? `Review focus:\n${focus}` : "",
    context.content
  ].filter(Boolean).join("\n\n");
}

function composeAdversarialReviewPrompt(context, focus = "") {
  return [
    "You are Antigravity acting as an adversarial opposing reviewer for Codex.",
    "Take a stricter stance than a normal review. Challenge the design choices, hidden assumptions, failure modes, rollback story, data loss paths, race conditions, and simpler alternatives.",
    "Use only the git context below. Do not edit files or ask for write access.",
    "Return only actionable findings and risk analysis. If the change survives scrutiny, say so with the remaining concerns.",
    focus ? `Adversarial focus:\n${focus}` : "",
    context.content
  ].filter(Boolean).join("\n\n");
}

function composeRescuePrompt(userPrompt, write) {
  if (write) {
    return [
      "You are Antigravity in explicitly write-enabled rescue mode for Codex.",
      "Use the allowed write tools conservatively. Make the smallest safe edits needed, avoid dangerous bypass modes, and do not change unrelated files.",
      "Report the diagnosis, changed files, verification performed, and remaining risk.",
      "User request:",
      userPrompt
    ].join("\n\n");
  }

  return [
    "You are Antigravity helping Codex with a read-only diagnosis / dry-run rescue.",
    "Do not edit files, create commits, run write commands, or change project state. Diagnose the issue and propose the smallest safe fix for Codex to apply.",
    "Include evidence, likely root cause, recommended edits, tests to run, and risks.",
    "User request:",
    userPrompt
  ].join("\n\n");
}

export async function runPlanForeground(parsed, runtime = {}) {
  rejectDeferredMode(parsed);
  const cwd = resolveCwd(parsed, runtime);
  const userPrompt = readPrompt(parsed, cwd);
  if (!userPrompt) {
    throw new Error("Provide a planning prompt.");
  }
  const result = await runReadOnlyAgyPrint(parsed, cwd, runtime, composePlanPrompt(userPrompt), {
    includeWorkspace: true
  });
  return normalizeResult("plan", result);
}

export async function runReviewForeground(parsed, runtime = {}, adversarial = false) {
  rejectDeferredMode(parsed);
  const cwd = resolveCwd(parsed, runtime);
  const focus = readPrompt(parsed, cwd);
  if (!adversarial && focus) {
    throw new Error("Custom review focus belongs in adversarial-review.");
  }
  const context = await collectReviewContext(cwd, reviewContextOptions(parsed.options));
  const prompt = adversarial
    ? composeAdversarialReviewPrompt(context, focus)
    : composeReviewPrompt(context);
  const result = await runReadOnlyAgyPrint(parsed, context.repoRoot ?? cwd, runtime, prompt, {
    includeWorkspace: false
  });
  return normalizeResult(adversarial ? "adversarial-review" : "review", result, reviewMetadata(context));
}

export async function runRescueForeground(parsed, runtime = {}) {
  rejectDeferredMode(parsed);
  const cwd = resolveCwd(parsed, runtime);
  let userPrompt = readPrompt(parsed, cwd);
  if (!userPrompt && parsed.options.resume) {
    userPrompt = "Continue the previous Antigravity Bridge rescue task.";
  }
  if (!userPrompt) {
    throw new Error("Provide a rescue prompt or --resume.");
  }
  const write = Boolean(parsed.options.write);
  if (!write && parsed.options.resume) {
    throw new Error("Antigravity read-only rescue cannot use --resume because continued CLI conversations may retain write-capable workspace context. Use --fresh or request explicit --write.");
  }
  if (!write) {
    const result = await runReadOnlyAgyPrint(parsed, cwd, runtime, composeRescuePrompt(userPrompt, false), {
      includeWorkspace: true,
      runtimeOptions: { continueConversation: false }
    });
    return normalizeResult("rescue", result, { write: false });
  }

  const result = await runAgyPrint(agyRuntimeOptions(
    parsed,
    cwd,
    runtime,
    composeRescuePrompt(userPrompt, write),
    write ? "write" : "read",
    { continueConversation: Boolean(parsed.options.resume) }
  ));
  const touchedFiles = await collectGitTouchedFiles(cwd, { env: runtime.env });
  return normalizeResult("rescue", {
    ...result,
    touchedFiles,
    metadata: {
      ...(result.metadata ?? {}),
      antigravityIsolation: {
        kind: "real-workspace",
        originalCwd: cwd,
        originalRepoRoot: null,
        isolatedCwd: cwd,
        snapshotRoot: null,
        readOnlyViolation: false,
        touchedFiles
      }
    }
  }, { write });
}

export async function runForegroundCommand(parsed, runtime = {}) {
  if (!FOREGROUND_COMMANDS.has(parsed.command)) {
    throw new Error(`Unsupported foreground command: ${parsed.command}`);
  }
  if (parsed.command === "plan") {
    return runPlanForeground(parsed, runtime);
  }
  if (parsed.command === "review") {
    return runReviewForeground(parsed, runtime, false);
  }
  if (parsed.command === "adversarial-review") {
    return runReviewForeground(parsed, runtime, true);
  }
  return runRescueForeground(parsed, runtime);
}
