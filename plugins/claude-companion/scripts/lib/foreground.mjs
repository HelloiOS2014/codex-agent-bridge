import path from "node:path";
import { readPromptFromParsedInput } from "./args.mjs";
import { runClaudePrint } from "./claude.mjs";
import { collectReviewContext } from "./git-context.mjs";
import {
  renderAdversarialReviewResult,
  renderPlanResult,
  renderRescueResult,
  renderReviewResult
} from "./render.mjs";

const FOREGROUND_COMMANDS = new Set(["plan", "review", "adversarial-review", "rescue"]);
const VALID_SCOPES = new Set(["auto", "working-tree", "branch"]);

function hasDeferredMode(parsed) {
  return parsed.options.background || parsed.options.wait;
}

function rejectDeferredMode(parsed) {
  if (hasDeferredMode(parsed)) {
    throw new Error("Foreground commands do not support deferred mode yet; Task 9 owns --background/--wait.");
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

function claudeRuntimeOptions(parsed, cwd, runtime, prompt, toolProfile, extra = {}) {
  return {
    claudeBin: runtime.claudeBin ?? runtime.env?.CLAUDE_COMPANION_CLAUDE_BIN,
    cwd,
    env: runtime.env,
    prompt,
    toolProfile,
    model: parsed.options.model,
    effort: parsed.options.effort,
    timeoutMs: timeoutMs(parsed.options),
    ...extra
  };
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
    "You are Claude Code assisting Codex in read-only planning mode.",
    "Produce a full implementation or review plan for the request. Cover scope, affected files, sequencing, risks, assumptions, rollback, and verification.",
    "Do not edit files, create commits, run write commands, or change project state. Return a plan for Codex to execute or review.",
    "User request:",
    userPrompt
  ].join("\n\n");
}

function composeReviewPrompt(context, focus = "") {
  return [
    "You are Claude Code acting as a conservative code reviewer for Codex.",
    "Use only the git context below. Do not edit files or ask for write access.",
    "Prioritize concrete bugs, behavioral regressions, security/data-loss risks, missing tests, and unclear rollout risk. Put findings first with file and line references when the context supports them. If there are no findings, say that clearly and mention residual risk.",
    focus ? `Review focus:\n${focus}` : "",
    context.content
  ].filter(Boolean).join("\n\n");
}

function composeAdversarialReviewPrompt(context, focus = "") {
  return [
    "You are Claude Code acting as an adversarial opposing reviewer for Codex.",
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
      "You are Claude Code in explicitly write-enabled rescue mode for Codex.",
      "Use the allowed write tools conservatively. Make the smallest safe edits needed, avoid dangerous bypass modes, and do not change unrelated files.",
      "Report the diagnosis, changed files, verification performed, and remaining risk.",
      "User request:",
      userPrompt
    ].join("\n\n");
  }

  return [
    "You are Claude Code helping Codex with a read-only diagnosis / dry-run rescue.",
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
  const result = await runClaudePrint(claudeRuntimeOptions(
    parsed,
    cwd,
    runtime,
    composePlanPrompt(userPrompt),
    "read",
    { permissionMode: "plan" }
  ));
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
  const result = await runClaudePrint(claudeRuntimeOptions(
    parsed,
    context.repoRoot ?? cwd,
    runtime,
    prompt,
    "none"
  ));
  return normalizeResult(adversarial ? "adversarial-review" : "review", result, reviewMetadata(context));
}

export async function runRescueForeground(parsed, runtime = {}) {
  rejectDeferredMode(parsed);
  const cwd = resolveCwd(parsed, runtime);
  let userPrompt = readPrompt(parsed, cwd);
  if (!userPrompt && parsed.options.resume) {
    userPrompt = "Continue the previous Claude Companion rescue task.";
  }
  if (!userPrompt) {
    throw new Error("Provide a rescue prompt or --resume.");
  }
  const write = Boolean(parsed.options.write);
  const result = await runClaudePrint(claudeRuntimeOptions(
    parsed,
    cwd,
    runtime,
    composeRescuePrompt(userPrompt, write),
    write ? "write" : "read"
  ));
  return normalizeResult("rescue", result, { write });
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
