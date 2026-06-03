import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const skillFiles = [
  "skills/claude-plan/SKILL.md",
  "skills/claude-review/SKILL.md",
  "skills/claude-rescue/SKILL.md",
  "skills/claude-result-handling/SKILL.md"
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

test("manifest exposes the skills directory and all expected skills exist", () => {
  const manifest = readJson(".codex-plugin/plugin.json");

  assert.equal(manifest.skills, "./skills/");
  assert.equal(Object.hasOwn(manifest, "mcpServers"), false);
  for (const file of skillFiles) {
    const body = read(file);
    assert.match(body, /^---\nname: claude-/);
    assert.match(body, /description:/);
    assert.match(body, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs"/);
    assert.doesNotMatch(body, /node scripts\/claude-companion\.mjs/);
    assert.match(body, /--json/);
  }
});

test("README command surface uses plugin root and lists all skills", () => {
  const readme = read("README.md");

  assert.doesNotMatch(readme, /node scripts\/claude-companion\.mjs/);
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" setup/);
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" plan /);
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" review /);
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" adversarial-review /);
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" rescue --write /);
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" status/);
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" result/);
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" cancel "\$JOB_ID"/);
  assert.match(readme, /background or waited jobs started with `--cwd <workspace>`/);

  for (const skill of ["claude-plan", "claude-review", "claude-rescue", "claude-result-handling"]) {
    assert.match(readme, new RegExp(`\\b${skill}\\b`));
  }

  assert.match(readme, /Safety Model/);
  assert.match(readme, /How Codex Uses It/);
  assert.match(readme, /Direct CLI Usage/);
  assert.match(readme, /Background Jobs/);
  assert.match(readme, /State Storage/);
  assert.match(readme, /Repository Layout/);
  assert.match(readme, /Limits/);
  assert.match(readme, /Do not automatically apply Claude output/);
  assert.match(readme, /stage, commit, or push/);
  assert.match(readme, /does not use MCP/);
  assert.match(readme, /Claude Code CLI installed and authenticated/);
  assert.match(readme, /Ask Claude to review my current changes/);
});

test("AGENTS guide documents maintenance invariants", () => {
  const guide = read("AGENTS.md");

  assert.match(guide, /Core Rules/);
  assert.match(guide, /Keep the plugin CLI-only/);
  assert.match(guide, /Do not add MCP servers/);
  assert.match(guide, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs"/);
  assert.doesNotMatch(guide, /node scripts\/claude-companion\.mjs/);
  assert.match(guide, /plan`, `review`, and `adversarial-review` must remain read-only/);
  assert.match(guide, /rescue` must remain read-only unless/);
  assert.match(guide, /Background Job Rules/);
  assert.match(guide, /status`, `result`, and `cancel` must support the same `--cwd`/);
  assert.match(guide, /Documentation Rules/);
  assert.match(guide, /npm test/);
  assert.match(guide, /npm run check:manifest/);
});

test("skill docs pin read-only defaults and write-enabled rescue boundary", () => {
  const plan = read("skills/claude-plan/SKILL.md");
  const review = read("skills/claude-review/SKILL.md");
  const rescue = read("skills/claude-rescue/SKILL.md");

  assert.match(plan, /Planning is read-only/);
  assert.doesNotMatch(plan, /--write/);

  assert.match(review, /Normal review and adversarial review are read-only/);
  assert.match(review, /Do not fix issues/);
  assert.doesNotMatch(review, /--write/);

  assert.match(rescue, /Rescue defaults to read-only investigation/);
  assert.match(rescue, /--write/);
  assert.match(rescue, /explicitly requested by the user/);
});

test("skill docs include critical safety exclusions", () => {
  const combined = skillFiles.map(read).join("\n");

  assert.match(combined, /do not start, configure, or invent MCP behavior/i);
  assert.match(combined, /automatically apply/i);
  assert.match(combined, /push changes/i);
  assert.match(combined, /--mcp-config/);
  assert.match(combined, /--dangerously-skip-permissions/);
  assert.match(combined, /--allow-dangerously-skip-permissions/);
  assert.match(combined, /--dangerously-bypass-approvals-and-sandbox/);
  assert.match(combined, /--permission-mode bypassPermissions/);
  assert.match(combined, /broad shell or git write tools in read mode/);
});

test("skill docs include when-not-to-use guidance", () => {
  const combined = skillFiles.map(read).join("\n");

  assert.match(combined, /trivial local tasks/i);
  assert.match(combined, /Claude Code is missing/i);
  assert.match(combined, /asked not to delegate/i);
  assert.match(combined, /secrets, credentials, private keys, tokens/i);
});

test("skill docs include setup, status, result, cancel, background, and wait commands", () => {
  const combined = skillFiles.map(read).join("\n");

  assert.match(combined, /setup --json/);
  assert.match(combined, /status "\$JOB_ID" --json/);
  assert.match(combined, /result "\$JOB_ID" --json/);
  assert.match(combined, /cancel "\$JOB_ID" --json/);
  assert.match(combined, /status "\$JOB_ID" --cwd "\$WORKSPACE" --json/);
  assert.match(combined, /result "\$JOB_ID" --cwd "\$WORKSPACE" --json/);
  assert.match(combined, /cancel "\$JOB_ID" --cwd "\$WORKSPACE" --json/);
  assert.match(combined, /background or waited job was started with `--cwd "\$WORKSPACE"`/);
  assert.match(combined, /--background --json/);
  assert.match(combined, /--wait --json/);

  const review = read("skills/claude-review/SKILL.md");
  assert.match(review, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" review --json --scope working-tree/);
  assert.match(review, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" adversarial-review --json --scope auto --prompt "\$FOCUS"/);

  const rescue = read("skills/claude-rescue/SKILL.md");
  assert.match(rescue, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" rescue --json --prompt "\$PROMPT"/);
  assert.match(rescue, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" rescue --write --json --prompt "\$PROMPT"/);
});
