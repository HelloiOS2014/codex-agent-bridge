import fs from "node:fs";
import path from "node:path";
import { assertNoDangerousArgs } from "./safety.mjs";

export { assertNoDangerousArgs };

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
  if (typeof parsed.options.prompt === "string") {
    return parsed.options.prompt;
  }
  return parsed.positionals.join(" ").trim();
}
