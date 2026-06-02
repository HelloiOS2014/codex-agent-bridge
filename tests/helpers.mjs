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

export async function makeTempGitRepo() {
  const cwd = makeTempDir("claude-companion-git-");
  await runCommand("git", ["init", "-q"], { cwd });
  await runCommand("git", ["config", "user.email", "test@example.com"], { cwd });
  await runCommand("git", ["config", "user.name", "Test User"], { cwd });
  fs.writeFileSync(path.join(cwd, "README.md"), "initial\n", "utf8");
  await runCommand("git", ["add", "README.md"], { cwd });
  await runCommand("git", ["commit", "-m", "initial"], { cwd });
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
