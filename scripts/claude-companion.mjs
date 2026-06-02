#!/usr/bin/env node

import { parseArgs } from "./lib/args.mjs";
import { getClaudeStatus } from "./lib/claude.mjs";
import { formatForegroundResult, runForegroundCommand } from "./lib/foreground.mjs";

const COMMAND_CONFIG = {
  setup: { booleanOptions: ["json"], valueOptions: [] },
  plan: {
    booleanOptions: ["background", "wait", "json"],
    valueOptions: ["cwd", "prompt", "model", "effort", "prompt-file", "timeout", "timeout-ms"],
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
      "model",
      "effort",
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
      "model",
      "effort",
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
    valueOptions: ["cwd", "prompt", "model", "effort", "prompt-file", "timeout", "timeout-ms"],
    exclusiveGroups: [["background", "wait"], ["resume", "fresh"]]
  },
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
    title: "Claude Companion Error",
    summary: message,
    text: "",
    rawOutput: "",
    rendered: [
      "# Claude Companion Error",
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

async function handleSetup(parsed) {
  const status = await getClaudeStatus({ cwd: process.cwd() });
  const payload = {
    ready: status.ready,
    claude: status
  };

  if (parsed.options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(payload.ready ? "Claude Companion setup: ready" : "Claude Companion setup: not ready");
  if (status.available) {
    const version = status.version.stdout.trim() || "version unavailable";
    console.log(`Claude: ${version}`);
  } else {
    console.log("Claude: not found");
    console.log("Install Claude Code or set CLAUDE_COMPANION_CLAUDE_BIN to the Claude binary path.");
  }
  if (status.available && !status.auth.loggedIn) {
    console.log("Run `claude auth login` before delegating work.");
  }
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
  if (["plan", "review", "adversarial-review", "rescue"].includes(parsed.command)) {
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
  console.log(JSON.stringify({ command: parsed.command, options: parsed.options, positionals: parsed.positionals }));
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
