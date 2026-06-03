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
  assert.match(readme, /Installation/);
  assert.match(readme, /Codex App/);
  assert.match(readme, /Codex CLI/);
  assert.match(readme, /Add plugin marketplace/);
  assert.match(readme, /Source: `git@github\.com:HelloiOS2014\/claude_work\.git`/);
  assert.match(readme, /Git ref: `main`/);
  assert.match(readme, /Sparse path: leave empty/);
  assert.match(readme, /Do not enter `plugins\/codex` or `\.agents\/plugins`/);
  assert.match(readme, /Verify Installation/);
  assert.match(readme, /How Codex Uses It/);
  assert.match(readme, /Direct CLI Usage/);
  assert.match(readme, /Background Jobs/);
  assert.match(readme, /State Storage/);
  assert.match(readme, /Repository Layout/);
  assert.match(readme, /Limits/);
  assert.match(readme, /Troubleshooting/);
  assert.match(readme, /codex plugin marketplace add git@github\.com:HelloiOS2014\/claude_work\.git --ref main/);
  assert.match(readme, /codex plugin marketplace upgrade claude-work/);
  assert.match(readme, /codex plugin marketplace remove claude-work/);
  assert.match(readme, /codex plugin marketplace remove claude-companion-local/);
  assert.doesNotMatch(readme, /Git ref: `codex\/claude-companion-plugin`/);
  assert.match(readme, /Claude Work/);
  assert.match(readme, /Do not use `--sparse \.agents\/plugins`/);
  assert.doesNotMatch(readme, /codex plugin marketplace list/);
  assert.doesNotMatch(readme, /node scripts\/install-personal-marketplace\.mjs/);
  assert.doesNotMatch(readme, /~\/\.codex\/plugins\/claude-companion/);
  assert.match(readme, /\.agents\/plugins\/marketplace\.json/);
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
  assert.match(guide, /README must document installation/);
  assert.match(guide, /Codex App UI fields and Codex CLI commands/);
  assert.match(guide, /main branch as the install ref/);
  assert.match(guide, /\.agents\/plugins\/marketplace\.json/);
  assert.match(guide, /single-plugin repository/);
  assert.match(guide, /source\.local\.path = "\.\/"/);
  assert.match(guide, /Do not document personal marketplace copying/);
  assert.match(guide, /npm test/);
  assert.match(guide, /npm run check:manifest/);
});

test("local marketplace exposes the plugin package", () => {
  const marketplace = readJson(".agents/plugins/marketplace.json");

  assert.equal(marketplace.name, "claude-work");
  assert.equal(marketplace.interface.displayName, "Claude Work");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, "claude-companion");
  assert.equal(marketplace.plugins[0].source.source, "local");
  assert.equal(marketplace.plugins[0].source.path, "./");
  assert.equal(marketplace.plugins[0].policy.installation, "AVAILABLE");
  assert.equal(marketplace.plugins[0].category, "Developer Tools");
  assert.equal(marketplace.plugins[0].interface.displayName, "Claude Companion");

  const plugin = readJson(".codex-plugin/plugin.json");
  assert.equal(plugin.interface.category, "Developer Tools");
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
