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
