#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import {
  cancelJob,
  createQueuedJob,
  readSelectedResult,
  runStoredJob,
  spawnBackgroundJob,
  statusSnapshot
} from "./lib/background.mjs";
import { getAgyStatus } from "./lib/agy.mjs";
import { formatForegroundResult, runForegroundCommand } from "./lib/foreground.mjs";
import { renderStatus, renderStoredResult } from "./lib/render.mjs";
import { resolveStateDir, resolveStateRoot } from "./lib/state.mjs";
import {
  collectStorageUsage,
  formatStorageReport,
  pruneStateRoot,
  pruneWorkspaceState
} from "./lib/storage-prune.mjs";

const COMMAND_CONFIG = {
  setup: { booleanOptions: ["json"], valueOptions: [] },
  plan: {
    booleanOptions: ["background", "wait", "json"],
    valueOptions: ["cwd", "prompt", "prompt-file", "timeout", "timeout-ms"],
    exclusiveGroups: [["background", "wait"]]
  },
  review: {
    booleanOptions: ["background", "wait", "json"],
    valueOptions: [
      "cwd",
      "base",
      "against",
      "scope",
      "prompt",
      "prompt-file",
      "timeout",
      "timeout-ms",
      "max-diff",
      "max-diff-bytes",
      "max-untracked",
      "max-untracked-bytes",
      "max-untracked-file-bytes"
    ],
    exclusiveGroups: [["background", "wait"]]
  },
  "adversarial-review": {
    booleanOptions: ["background", "wait", "json"],
    valueOptions: [
      "cwd",
      "base",
      "against",
      "scope",
      "prompt",
      "prompt-file",
      "timeout",
      "timeout-ms",
      "max-diff",
      "max-diff-bytes",
      "max-untracked",
      "max-untracked-bytes",
      "max-untracked-file-bytes"
    ],
    exclusiveGroups: [["background", "wait"]]
  },
  rescue: {
    booleanOptions: ["background", "wait", "resume", "fresh", "write", "json"],
    valueOptions: ["cwd", "prompt", "prompt-file", "timeout", "timeout-ms"],
    exclusiveGroups: [["background", "wait"], ["resume", "fresh"]]
  },
  status: { booleanOptions: ["all", "brief", "json"], valueOptions: ["cwd"] },
  result: { booleanOptions: ["json"], valueOptions: ["cwd"] },
  cancel: { booleanOptions: ["json"], valueOptions: ["cwd"] },
  storage: { booleanOptions: ["all", "json"], valueOptions: ["cwd"] },
  cleanup: { booleanOptions: ["all", "dry-run", "json"], valueOptions: ["cwd"] },
  "run-job": { booleanOptions: [], valueOptions: [] }
};

function usage() {
  return [
    "Usage:",
    "  antigravity-companion setup [--json]",
    "  antigravity-companion plan [--background|--wait] [prompt...]",
    "  antigravity-companion review [--background|--wait] [--base <ref>] [--scope auto|working-tree|branch]",
    "  antigravity-companion adversarial-review [--background|--wait] [focus...]",
    "  antigravity-companion rescue [--background|--wait] [--resume|--fresh] [--write] [prompt...]",
    "  antigravity-companion status [job-id] [--cwd <workspace>] [--all] [--brief] [--json]",
    "  antigravity-companion result [job-id] [--cwd <workspace>] [--json]",
    "  antigravity-companion cancel [job-id] [--cwd <workspace>] [--json]",
    "  antigravity-companion storage [--cwd <workspace>] [--all] [--json]",
    "  antigravity-companion cleanup [--cwd <workspace>] [--all] [--dry-run] [--json]"
  ].join("\n");
}

function jsonRequested(argv) {
  return argv.includes("--json");
}

function errorPayload(argv, error) {
  const message = error instanceof Error ? error.message : String(error);
  const command = argv[0] ?? "help";
  const foregroundKind = ["plan", "review", "adversarial-review", "rescue"].includes(command)
    ? command
    : "plan";
  return {
    kind: foregroundKind,
    status: "failed",
    title: "Antigravity Bridge Error",
    summary: message,
    text: "",
    rawOutput: "",
    rendered: [
      "# Antigravity Bridge Error",
      "",
      "Status: failed",
      `Error: ${message}`
    ].join("\n"),
    findings: [],
    actions: [],
    touchedFiles: [],
    sessionId: null,
    error: message,
    metadata: {
      command
    }
  };
}

function foregroundCommand(command) {
  return ["plan", "review", "adversarial-review", "rescue"].includes(command);
}

function failedExecutionStatus(status) {
  return status === "failed" || status === "cancelled";
}

function assertAtMostOnePositional(parsed, label) {
  if (parsed.positionals.length > 1) {
    throw new Error(`${label} accepts at most one job id.`);
  }
  return parsed.positionals[0] ?? null;
}

function commandWorkspace(parsed) {
  return parsed.options.cwd ? path.resolve(process.cwd(), parsed.options.cwd) : process.cwd();
}

function printRendered(value, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value);
}

async function handleSetup(parsed) {
  const status = await getAgyStatus({ cwd: process.cwd() });
  const payload = {
    ready: status.ready,
    antigravity: status
  };

  if (parsed.options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(payload.ready ? "Antigravity Bridge setup: ready" : "Antigravity Bridge setup: not ready");
  if (status.available) {
    const version = status.version.stdout.trim() || "version unavailable";
    console.log(`Antigravity: ${version}`);
  } else {
    console.log("Antigravity: not found");
    console.log("Antigravity binary was not found after checking common local install locations. Report this setup blocker before delegating work.");
  }
}

async function executeStoredJob(job, runtime = {}) {
  const config = COMMAND_CONFIG[job.command];
  if (!config || !foregroundCommand(job.command)) {
    throw new Error(`Unsupported stored job command: ${job.command}`);
  }
  const parsed = parseArgs([job.command, ...(job.args ?? [])], config);
  return runForegroundCommand(parsed, {
    cwd: job.cwd,
    env: process.env,
    updateJob: runtime.updateJob
  });
}

async function handleDeferredForeground(parsed) {
  const job = createQueuedJob(parsed, {
    cwd: process.cwd(),
    env: process.env
  });

  if (parsed.options.background) {
    const running = spawnBackgroundJob(job, {
      cliPath: fileURLToPath(import.meta.url),
      env: process.env
    });
    if (parsed.options.json) {
      printRendered({ status: running.status, job: running }, { json: true });
      return;
    }
    console.log(`${running.kind} started in the background as ${running.id}`);
    return;
  }

  const completed = await runStoredJob(job.id, {
    workspaceRoot: job.workspaceRoot,
    env: process.env,
    execute: executeStoredJob
  });
  const rendered = renderStoredResult(completed.result, { json: Boolean(parsed.options.json) });
  printRendered(rendered, { json: Boolean(parsed.options.json) });
  if (failedExecutionStatus(completed.status)) {
    process.exitCode = 1;
  }
}

async function handleRunJob(parsed) {
  const jobId = assertAtMostOnePositional(parsed, "run-job");
  if (!jobId) {
    throw new Error("run-job requires a job id.");
  }
  const completed = await runStoredJob(jobId, {
    workspaceRoot: process.cwd(),
    env: process.env,
    execute: executeStoredJob
  });
  if (failedExecutionStatus(completed.status)) {
    process.exitCode = 1;
  }
}

function handleStatus(parsed) {
  const jobId = assertAtMostOnePositional(parsed, "status");
  const snapshot = statusSnapshot(commandWorkspace(parsed), {
    jobId,
    all: Boolean(parsed.options.all),
    brief: Boolean(parsed.options.brief),
    env: process.env
  });
  const rendered = renderStatus(snapshot, { json: Boolean(parsed.options.json) });
  printRendered(rendered, { json: Boolean(parsed.options.json) });
}

function handleResult(parsed) {
  const jobId = assertAtMostOnePositional(parsed, "result");
  const { result } = readSelectedResult(commandWorkspace(parsed), {
    jobId,
    env: process.env
  });
  const rendered = renderStoredResult(result, { json: Boolean(parsed.options.json) });
  printRendered(rendered, { json: Boolean(parsed.options.json) });
}

async function handleCancel(parsed) {
  const jobId = assertAtMostOnePositional(parsed, "cancel");
  if (!jobId) {
    throw new Error("cancel requires a job id.");
  }
  const payload = await cancelJob(commandWorkspace(parsed), jobId, { env: process.env });
  if (parsed.options.json) {
    printRendered(payload, { json: true });
    return;
  }
  console.log(payload.message);
}

function workspaceDirsFromUsage(usage) {
  return usage.workspaces
    .map((workspace) => ({
      workspaceRoot: workspace.workspaceRoot,
      stateDir: workspace.stateDir
    }))
    .filter((workspace) => workspace.stateDir);
}

function combineCleanupReports({ stateRoot, dryRun, before, workspaceReports, quotaReport, after }) {
  const removedFiles = [];
  const seen = new Set();
  let removedBytes = 0;
  const warnings = [];
  const protectedActiveJobs = new Set();
  const protectedSelectedJobs = new Set();

  for (const report of [...workspaceReports, quotaReport].filter(Boolean)) {
    removedBytes += report.removedBytes ?? 0;
    for (const file of report.removedFiles ?? []) {
      if (!seen.has(file)) {
        seen.add(file);
        removedFiles.push(file);
      }
    }
    for (const warning of report.warnings ?? []) {
      warnings.push(warning);
    }
    for (const jobId of report.protectedActiveJobs ?? []) {
      protectedActiveJobs.add(jobId);
    }
    for (const jobId of report.protectedSelectedJobs ?? []) {
      protectedSelectedJobs.add(jobId);
    }
  }

  return {
    stateRoot,
    dryRun,
    beforeBytes: before.totalBytes,
    afterBytes: dryRun ? Math.max(0, before.totalBytes - removedBytes) : after.totalBytes,
    removedBytes,
    removedFiles,
    protectedActiveJobs: [...protectedActiveJobs].sort(),
    protectedSelectedJobs: [...protectedSelectedJobs].sort(),
    workspaceReports,
    quotaReport,
    warnings
  };
}

function handleStorage(parsed) {
  const env = process.env;
  const stateRoot = resolveStateRoot(env);
  const usage = scopedStorageUsage(parsed, collectStorageUsage(stateRoot, env), env);
  if (parsed.options.json) {
    console.log(JSON.stringify(usage, null, 2));
    return;
  }
  console.log([
    `State root: ${usage.stateRoot}`,
    `Total: ${usage.totalBytes} bytes`,
    `Workspaces: ${usage.workspaces.length}`
  ].join("\n"));
}

function scopedStorageUsage(parsed, usage, env) {
  if (parsed.options.all) {
    return usage;
  }
  const selectedStateDir = resolveStateDir(commandWorkspace(parsed), env);
  const workspaces = usage.workspaces.filter((workspace) => workspace.stateDir === selectedStateDir);
  return {
    ...usage,
    totalBytes: workspaces.reduce((total, workspace) => total + workspace.bytes, 0),
    workspaces
  };
}

function handleCleanup(parsed) {
  const env = process.env;
  const stateRoot = resolveStateRoot(env);
  const dryRun = Boolean(parsed.options["dry-run"]);
  const before = collectStorageUsage(stateRoot, env);
  const workspaceReports = [];

  if (parsed.options.all) {
    for (const workspace of workspaceDirsFromUsage(before)) {
      workspaceReports.push(pruneWorkspaceState(workspace.workspaceRoot ?? process.cwd(), {
        env,
        stateDir: workspace.stateDir,
        dryRun
      }));
    }
  } else {
    workspaceReports.push(pruneWorkspaceState(commandWorkspace(parsed), { env, dryRun }));
  }

  const quotaReport = pruneStateRoot({ stateRoot, env, dryRun });
  const after = collectStorageUsage(stateRoot, env);
  const report = combineCleanupReports({
    stateRoot,
    dryRun,
    before,
    workspaceReports,
    quotaReport,
    after
  });

  if (parsed.options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatStorageReport(report));
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
  if (parsed.command === "setup") {
    await handleSetup(parsed);
    return;
  }
  if (foregroundCommand(parsed.command)) {
    if (parsed.options.background || parsed.options.wait) {
      await handleDeferredForeground(parsed);
      return;
    }
    const result = await runForegroundCommand(parsed, {
      cwd: process.cwd(),
      env: process.env
    });
    console.log(formatForegroundResult(result, { json: Boolean(parsed.options.json) }));
    if (result.status === "failed" || result.status === "cancelled") {
      process.exitCode = 1;
    }
    return;
  }
  if (parsed.command === "status") {
    handleStatus(parsed);
    return;
  }
  if (parsed.command === "result") {
    handleResult(parsed);
    return;
  }
  if (parsed.command === "cancel") {
    await handleCancel(parsed);
    return;
  }
  if (parsed.command === "storage") {
    handleStorage(parsed);
    return;
  }
  if (parsed.command === "cleanup") {
    handleCleanup(parsed);
    return;
  }
  if (parsed.command === "run-job") {
    await handleRunJob(parsed);
    return;
  }
  throw new Error(`Unsupported command: ${parsed.command}`);
}

const argv = process.argv.slice(2);
main(argv).catch((error) => {
  if (jsonRequested(argv)) {
    console.log(JSON.stringify(errorPayload(argv, error), null, 2));
    process.exit(1);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
