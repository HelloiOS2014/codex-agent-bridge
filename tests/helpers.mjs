import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../scripts/lib/process.mjs";

export const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const fixtureClaudePath = path.join(repoRoot, "tests", "fake-claude-fixture.mjs");

export function makeTempDir(prefix = "claude-companion-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function runChecked(command, args, options) {
  const result = await runCommand(command, args, options);
  if (!result.error && result.status === 0) {
    return result;
  }

  const parts = [
    `Command failed: ${[command, ...args].join(" ")}`,
    `status: ${result.status}`,
    `signal: ${result.signal ?? null}`,
    result.error ? `error: ${result.error.message}` : null,
    `stderr: ${result.stderr || "<empty>"}`,
    `stdout: ${result.stdout || "<empty>"}`
  ].filter(Boolean);
  throw new Error(parts.join("\n"));
}

export async function makeTempGitRepo() {
  const cwd = makeTempDir("claude-companion-git-");
  await runChecked("git", ["init", "-q"], { cwd });
  await runChecked("git", ["config", "user.email", "test@example.com"], { cwd });
  await runChecked("git", ["config", "user.name", "Test User"], { cwd });
  fs.writeFileSync(path.join(cwd, "README.md"), "initial\n", "utf8");
  await runChecked("git", ["add", "README.md"], { cwd });
  await runChecked("git", ["commit", "-m", "initial"], { cwd });
  return cwd;
}

export async function runCli(args, options = {}) {
  return runCommand(process.execPath, [path.join(repoRoot, "scripts", "claude-companion.mjs"), ...args], {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      CLAUDE_COMPANION_CLAUDE_BIN: fixtureClaudePath,
      CLAUDE_COMPANION_STATE_DIR: options.stateDir ?? makeTempDir("claude-companion-state-"),
      ...(options.env ?? {})
    }
  });
}
