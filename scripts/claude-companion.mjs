#!/usr/bin/env node

import { parseArgs } from "./lib/args.mjs";
import { getClaudeStatus } from "./lib/claude.mjs";

const COMMAND_CONFIG = {
  setup: { booleanOptions: ["json"], valueOptions: [] },
  plan: {
    booleanOptions: ["background", "wait"],
    valueOptions: ["model", "effort", "prompt-file"],
    exclusiveGroups: [["background", "wait"]]
  },
  review: {
    booleanOptions: ["background", "wait", "json"],
    valueOptions: ["base", "scope"],
    exclusiveGroups: [["background", "wait"]]
  },
  "adversarial-review": {
    booleanOptions: ["background", "wait"],
    valueOptions: ["base", "scope", "prompt-file"],
    exclusiveGroups: [["background", "wait"]]
  },
  rescue: {
    booleanOptions: ["background", "wait", "resume", "fresh", "write"],
    valueOptions: ["model", "effort", "prompt-file"],
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
  console.log(JSON.stringify({ command: parsed.command, options: parsed.options, positionals: parsed.positionals }));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
