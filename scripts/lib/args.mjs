import fs from "node:fs";
import path from "node:path";

const DANGEROUS_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox"
]);

const DANGEROUS_FLAG_PREFIXES = [
  "--dangerously-",
  "--allow-dangerously-"
];

const DANGEROUS_PERMISSION_MODES = new Set(["bypassPermissions"]);

function flagName(arg) {
  const equalsIndex = arg.indexOf("=");
  return equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
}

export function assertNoDangerousArgs(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const flag = flagName(arg);
    if (DANGEROUS_FLAGS.has(flag) || DANGEROUS_FLAG_PREFIXES.some((prefix) => flag.startsWith(prefix))) {
      throw new Error(`Dangerous Claude flag is not allowed: ${flag}`);
    }
    if (arg === "--permission-mode" && DANGEROUS_PERMISSION_MODES.has(argv[index + 1])) {
      throw new Error(`Dangerous Claude permission mode is not allowed: ${argv[index + 1]}`);
    }
    if (flag === "--permission-mode" && arg.includes("=")) {
      const permissionMode = arg.slice("--permission-mode=".length);
      if (DANGEROUS_PERMISSION_MODES.has(permissionMode)) {
        throw new Error(`Dangerous Claude permission mode is not allowed: ${permissionMode}`);
      }
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

  for (const group of config.exclusiveGroups ?? []) {
    const activeOptions = group.filter((name) => options[name] === true);
    if (activeOptions.length > 1) {
      throw new Error(`Options are mutually exclusive: ${activeOptions.map((name) => `--${name}`).join(", ")}`);
    }
  }

  return { command: command ?? "help", options, positionals };
}

export function readPromptFromParsedInput(parsed, options = {}) {
  if (parsed.options["prompt-file"]) {
    return fs.readFileSync(path.resolve(options.cwd ?? process.cwd(), parsed.options["prompt-file"]), "utf8");
  }
  return parsed.positionals.join(" ").trim();
}
