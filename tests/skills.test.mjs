import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = path.join(root, "plugins", "claude-code-bridge");
const antigravityPluginRoot = path.join(root, "plugins", "antigravity-bridge");

const skillFiles = [
  "plugins/claude-code-bridge/skills/claude-plan/SKILL.md",
  "plugins/claude-code-bridge/skills/claude-review/SKILL.md",
  "plugins/claude-code-bridge/skills/claude-rescue/SKILL.md",
  "plugins/claude-code-bridge/skills/claude-result-handling/SKILL.md"
];

const antigravitySkillFiles = [
  "plugins/antigravity-bridge/skills/antigravity-plan/SKILL.md",
  "plugins/antigravity-bridge/skills/antigravity-review/SKILL.md",
  "plugins/antigravity-bridge/skills/antigravity-rescue/SKILL.md",
  "plugins/antigravity-bridge/skills/antigravity-result-handling/SKILL.md"
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

test("manifest exposes the skills directory and all expected skills exist", () => {
  const manifest = readJson("plugins/claude-code-bridge/.codex-plugin/plugin.json");
  const antigravityManifest = readJson("plugins/antigravity-bridge/.codex-plugin/plugin.json");

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

  assert.equal(antigravityManifest.name, "antigravity-bridge");
  assert.equal(antigravityManifest.skills, "./skills/");
  assert.equal(Object.hasOwn(antigravityManifest, "mcpServers"), false);
  assert.equal(antigravityManifest.interface.displayName, "Antigravity Bridge");
  for (const file of antigravitySkillFiles) {
    const body = read(file);
    assert.match(body, /^---\nname: antigravity-/);
    assert.match(body, /description:/);
    assert.match(body, /node "\$ANTIGRAVITY_PLUGIN_ROOT\/scripts\/antigravity-companion\.mjs"/);
    assert.doesNotMatch(body, /node scripts\/antigravity-companion\.mjs/);
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
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" storage --json/);
  assert.match(readme, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" cleanup --dry-run --json/);
  assert.match(readme, /cleanup --all --dry-run --json/);
  assert.match(readme, /background or waited jobs started with `--cwd <workspace>`/);
  assert.match(readme, /Agents should use background jobs for broad plans/);
  assert.match(readme, /Agents should not add this by default/);
  assert.match(readme, /`--model <model>`: pass a user-requested Claude Code model through to Claude/);
  assert.match(readme, /short alias such as `opus` or `sonnet`, or a full model name/);
  assert.match(readme, /If the user does not specify a model, omit `--model` so Claude Code uses its own default model/);

  for (const skill of ["claude-plan", "claude-review", "claude-rescue", "claude-result-handling"]) {
    assert.match(readme, new RegExp(`\\b${skill}\\b`));
  }

  assert.match(readme, /Safety Model/);
  assert.match(readme, /Installation/);
  assert.match(readme, /Codex App/);
  assert.match(readme, /Codex CLI/);
  assert.match(readme, /Add plugin marketplace/);
  assert.match(readme, /Source: `git@github\.com:HelloiOS2014\/codex-agent-bridge\.git`/);
  assert.match(readme, /Git ref: `main`/);
  assert.match(readme, /Sparse path: leave empty/);
  assert.doesNotMatch(readme, /Sparse path: `plugins\/claude-code-bridge`/);
  assert.doesNotMatch(readme, /Sparse path: `plugins\/antigravity-bridge`/);
  assert.match(readme, /Install on Another Machine/);
  assert.match(readme, /registers the marketplace only/);
  assert.match(readme, /current Codex CLI does not install or enable an individual plugin/);
  assert.match(readme, /Codex App and Codex CLI share the same Codex home configuration/);
  assert.match(readme, /\[marketplaces\.codex-agent-bridge\]/);
  assert.match(readme, /source_type = "git"/);
  assert.match(readme, /Verify Installation/);
  assert.match(readme, /How Codex Uses It/);
  assert.match(readme, /Direct CLI Usage/);
  assert.match(readme, /Background Jobs/);
  assert.match(readme, /State Storage/);
  assert.match(readme, /status --json` includes `phase`, `pid`, `claudePid`, `claudeArgv`, `runtimeMs`, `idleMs`, `lastActivityAt`, `firstOutputAt`, `lastOutputAt`, bounded `recentLog` entries/);
  assert.match(readme, /status --brief --json/);
  assert.match(readme, /omit prompt args, stdout\/stderr tails, and embedded stored result payloads/);
  assert.match(readme, /Running Claude jobs can legitimately have empty stdout\/stderr for a while/);
  assert.match(readme, /Agents should not cancel, add a timeout, or rerun only because stdout\/stderr is quiet/);
  assert.match(readme, /metadata\.resultAvailable: false/);
  assert.match(readme, /whether TERM or KILL was signalled/);
  assert.match(readme, /CLAUDE_COMPANION_MAX_STATE_BYTES/);
  assert.match(readme, /metadata\.storage\.truncated/);
  assert.match(readme, /archival caps, not execution caps/);
  assert.match(readme, /Repository Layout/);
  assert.match(readme, /Limits/);
  assert.match(readme, /Troubleshooting/);
  assert.match(readme, /codex plugin marketplace add git@github\.com:HelloiOS2014\/codex-agent-bridge\.git --ref main/);
  assert.match(readme, /codex plugin marketplace upgrade codex-agent-bridge/);
  assert.match(readme, /codex plugin marketplace remove codex-agent-bridge/);
  assert.match(readme, /codex plugin marketplace remove claude-work/);
  assert.match(readme, /codex plugin marketplace remove claude-companion-local/);
  assert.doesNotMatch(readme, /Git ref: `codex\/claude-companion-plugin`/);
  assert.match(readme, /Agent Bridge/);
  assert.match(readme, /exactly one marketplace/);
  assert.match(readme, /Do not use sparse marketplace installation/);
  assert.match(readme, /plugins\/claude-code-bridge/);
  assert.match(readme, /plugins\/antigravity-bridge/);
  assert.match(readme, /Claude Code Bridge/);
  assert.match(readme, /Antigravity Bridge/);
  assert.doesNotMatch(readme, /codex plugin marketplace list/);
  assert.doesNotMatch(readme, /node scripts\/install-personal-marketplace\.mjs/);
  assert.doesNotMatch(readme, /~\/\.codex\/plugins\/claude-companion/);
  assert.match(readme, /\.agents\/plugins\/marketplace\.json/);
  assert.match(readme, /Do not automatically apply Claude output/);
  assert.match(readme, /stage, commit, or push/);
  assert.match(readme, /does not use MCP/);
  assert.match(readme, /Claude Code CLI installed and authenticated/);
  assert.match(readme, /Antigravity CLI installed/);
  assert.match(readme, /Ask Claude to review my current changes/);
  assert.match(readme, /Ask Antigravity to review my current changes/);
  assert.match(readme, /node "\$ANTIGRAVITY_PLUGIN_ROOT\/scripts\/antigravity-companion\.mjs" setup/);
  assert.match(readme, /node "\$ANTIGRAVITY_PLUGIN_ROOT\/scripts\/antigravity-companion\.mjs" plan /);
  assert.match(readme, /node "\$ANTIGRAVITY_PLUGIN_ROOT\/scripts\/antigravity-companion\.mjs" review /);
  assert.match(readme, /node "\$ANTIGRAVITY_PLUGIN_ROOT\/scripts\/antigravity-companion\.mjs" rescue --write /);
  assert.match(readme, /node "\$ANTIGRAVITY_PLUGIN_ROOT\/scripts\/antigravity-companion\.mjs" rescue --write --resume --json/);
  assert.match(readme, /Antigravity `rescue --write --resume` passes `agy --continue`/);
  assert.match(readme, /read-only `rescue --resume` is rejected/);
  assert.match(readme, /Antigravity CLI does not expose a native plan-only mode/);
  assert.match(readme, /Do not treat it as a broad repository-understanding tool/);
  assert.match(readme, /not intended for open-ended whole-repository understanding/);
  assert.match(readme, /ANTIGRAVITY_COMPANION_AGY_BIN/);
  assert.match(readme, /ANTIGRAVITY_COMPANION_MAX_STATE_BYTES/);
  assert.match(readme, /agyPid/);
  assert.match(readme, /agyArgv/);

  const antigravityRescue = read("plugins/antigravity-bridge/skills/antigravity-rescue/SKILL.md");
  assert.match(antigravityRescue, /rescue --write --resume --json/);
  assert.match(antigravityRescue, /agy --continue/);
});

test("AGENTS guide documents maintenance invariants", () => {
  const guide = read("AGENTS.md");

  assert.match(guide, /Core Rules/);
  assert.match(guide, /Keep every plugin CLI-only/);
  assert.match(guide, /Do not route multiple agents through one generic plugin by keyword matching/);
  assert.match(guide, /Do not add MCP servers/);
  assert.match(guide, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs"/);
  assert.match(guide, /node "\$ANTIGRAVITY_PLUGIN_ROOT\/scripts\/antigravity-companion\.mjs"/);
  assert.doesNotMatch(guide, /node scripts\/claude-companion\.mjs/);
  assert.match(guide, /plan`, `review`, and `adversarial-review` must remain read-only/);
  assert.match(guide, /rescue` must remain read-only unless/);
  assert.match(guide, /Background Job Rules/);
  assert.match(guide, /status`, `result`, and `cancel` must support the same `--cwd`/);
  assert.match(guide, /Documentation Rules/);
  assert.match(guide, /README must document installation/);
  assert.match(guide, /Codex App UI fields and Codex CLI commands/);
  assert.match(guide, /main branch as the install ref/);
  assert.match(guide, /not to add `--timeout` or `--timeout-ms` by default/);
  assert.match(guide, /sandbox_permissions: "require_escalated"/);
  assert.match(guide, /explicit request to use a Bridge is delegation authorization/);
  assert.match(guide, /Do not run `setup --json`, `claude auth status`, or `agy --version` before every delegation/);
  assert.match(guide, /If the user specifies a Claude Code model, pass it with `--model`/);
  assert.match(guide, /Short aliases such as `opus` or `sonnet` must be passed through as model values/);
  assert.match(guide, /If the user does not specify a model, omit `--model`/);
  assert.match(guide, /metadata\.storage/);
  assert.match(guide, /cleanup --all --dry-run --json/);
  assert.match(guide, /\.agents\/plugins\/marketplace\.json/);
  assert.match(guide, /\.\/plugins\/claude-code-bridge/);
  assert.match(guide, /\.\/plugins\/antigravity-bridge/);
  assert.match(guide, /exactly one marketplace/);
  assert.match(guide, /Do not add plugin-local marketplaces/);
  assert.match(guide, /Do not document personal marketplace copying/);
  assert.match(guide, /npm test/);
  assert.match(guide, /npm run check:manifest/);
});

test("local marketplace exposes the plugin package", () => {
  const marketplace = readJson(".agents/plugins/marketplace.json");

  assert.equal(marketplace.name, "codex-agent-bridge");
  assert.equal(marketplace.interface.displayName, "Agent Bridge");
  assert.equal(marketplace.plugins.length, 2);

  const claudeEntry = marketplace.plugins.find((plugin) => plugin.name === "claude-code-bridge");
  const antigravityEntry = marketplace.plugins.find((plugin) => plugin.name === "antigravity-bridge");
  assert.ok(claudeEntry);
  assert.ok(antigravityEntry);

  for (const [entry, expectedRoot, displayName] of [
    [claudeEntry, pluginRoot, "Claude Code Bridge"],
    [antigravityEntry, antigravityPluginRoot, "Antigravity Bridge"]
  ]) {
    assert.equal(entry.source.source, "local");
    assert.equal(entry.policy.installation, "AVAILABLE");
    assert.equal(entry.category, "Developer Tools");
    assert.equal(Object.hasOwn(entry, "interface"), false);

    const pluginManifestPath = path.join(entry.source.path, ".codex-plugin/plugin.json");
    const plugin = readJson(pluginManifestPath);
    assert.equal(path.resolve(root, entry.source.path), expectedRoot);
    assert.equal(plugin.interface.displayName, displayName);
    assert.equal(plugin.interface.category, "Developer Tools");
  }
  assert.equal(claudeEntry.source.path, "./plugins/claude-code-bridge");
  assert.equal(antigravityEntry.source.path, "./plugins/antigravity-bridge");
});

test("repository contains only the root marketplace", () => {
  const marketplacePaths = [
    ".agents/plugins/marketplace.json",
    "plugins/claude-code-bridge/.agents/plugins/marketplace.json",
    "plugins/antigravity-bridge/.agents/plugins/marketplace.json"
  ].filter((relativePath) => fs.existsSync(path.join(root, relativePath)));

  assert.deepEqual(marketplacePaths, [".agents/plugins/marketplace.json"]);
});

test("antigravity skill docs pin sandbox defaults and write-enabled rescue boundary", () => {
  const combined = antigravitySkillFiles.map(read).join("\n");
  const plan = read("plugins/antigravity-bridge/skills/antigravity-plan/SKILL.md");
  const review = read("plugins/antigravity-bridge/skills/antigravity-review/SKILL.md");
  const rescue = read("plugins/antigravity-bridge/skills/antigravity-rescue/SKILL.md");

  assert.match(plan, /Planning is read-only/);
  assert.match(plan, /Antigravity CLI does not expose a native plan-only mode/);
  assert.match(plan, /Do not use for open-ended whole-repository understanding/);
  assert.match(plan, /`--sandbox`/);
  assert.match(plan, /disposable isolated workspace snapshot/);
  assert.match(plan, /If the user explicitly requests an Antigravity model, pass it with `--model <model>`/);
  assert.doesNotMatch(plan, /dontAsk|Read,Glob,Grep/);
  assert.doesNotMatch(plan, /--write/);

  assert.match(review, /Normal review and adversarial review are read-only/);
  assert.match(review, /disposable scratch cwd with pre-collected git context/);
  assert.match(review, /Do not fix issues/);
  assert.match(review, /`--sandbox`/);
  assert.doesNotMatch(review, /--write/);

  assert.match(rescue, /Rescue defaults to read-only investigation/);
  assert.match(rescue, /Read-only rescue runs in a disposable isolated workspace snapshot/);
  assert.match(rescue, /--write/);
  assert.match(rescue, /read-only `rescue --resume` is rejected/);
  assert.match(rescue, /explicitly requested by the user/);
  assert.match(combined, /ANTIGRAVITY_COMPANION_AGY_BIN/);
  assert.match(combined, /--dangerously-skip-permissions/);
  assert.doesNotMatch(combined, /\.claude\/local\/claude/);
});

test("skill docs pin read-only defaults and write-enabled rescue boundary", () => {
  const readme = read("README.md");
  const plan = read("plugins/claude-code-bridge/skills/claude-plan/SKILL.md");
  const review = read("plugins/claude-code-bridge/skills/claude-review/SKILL.md");
  const rescue = read("plugins/claude-code-bridge/skills/claude-rescue/SKILL.md");

  assert.match(plan, /Planning is read-only/);
  assert.match(plan, /non-interactive `dontAsk` permission mode/);
  assert.match(readme, /non-interactive `dontAsk` permission mode with the read-only `Read,Glob,Grep` tool profile/);
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

test("bridge docs pin Codex execution and delegation defaults", () => {
  const readme = read("README.md");
  const allSkillFiles = [...skillFiles, ...antigravitySkillFiles];

  assert.match(readme, /sandbox_permissions: "require_escalated"/);
  assert.match(readme, /Do not run Bridge companion commands in the default Codex sandbox first and retry after sandbox failure/);
  assert.match(readme, /A user request that explicitly names Claude Code Bridge, Claude Code, Antigravity Bridge, or Antigravity is sufficient authorization/);
  assert.match(readme, /Do not ask for a second delegation confirmation/);
  assert.match(readme, /Do not run `setup --json`, `claude auth status`, or `agy --version` before every delegation/);
  assert.match(readme, /Assume the bridge is already installed and authenticated unless a companion command reports otherwise/);

  for (const file of allSkillFiles) {
    const body = read(file);
    assert.match(body, /sandbox_permissions: "require_escalated"/, file);
    assert.match(
      body,
      /Do not run the companion in the default Codex sandbox first and retry after sandbox failure/,
      file
    );
    assert.match(
      body,
      /An explicit user request to use this Bridge for the current task is enough delegation authorization/,
      file
    );
    assert.match(body, /Do not ask for a second confirmation before calling the Bridge/, file);
    assert.match(body, /Do not run `setup --json` or raw auth\/version checks before every delegation/, file);
    assert.match(body, /Assume the Bridge is installed and authenticated unless a companion command fails/, file);
  }
});

test("skill docs document Claude model selection policy", () => {
  const combined = skillFiles.map(read).join("\n");

  assert.match(combined, /If the user explicitly requests a Claude Code model, pass it with `--model <model>`/);
  assert.match(combined, /The model value may be a short alias such as `opus` or `sonnet`, or a full model name/);
  assert.match(combined, /If the user does not specify a model, omit `--model` so Claude Code uses its own default model/);
  assert.doesNotMatch(combined, /CLAUDE_COMPANION_DEFAULT_MODEL/);
});

test("skill docs include when-not-to-use guidance", () => {
  const combined = skillFiles.map(read).join("\n");

  assert.match(combined, /trivial local tasks/i);
  assert.match(combined, /Claude Code is missing/i);
  assert.match(combined, /asked not to delegate/i);
  assert.match(combined, /secrets, credentials, private keys, tokens/i);
});

test("skill docs handle missing Claude binary without asking users to configure PATH", () => {
  const combined = skillFiles.map(read).join("\n");
  const readme = read("README.md");
  const guide = read("AGENTS.md");

  assert.match(combined, /CLAUDE_COMPANION_CLAUDE_BIN/);
  assert.match(combined, /command-scoped/i);
  assert.match(combined, /do not ask the user to edit shell PATH/i);
  assert.match(combined, /common local install locations/);
  assert.doesNotMatch(combined, /ask the user to configure PATH|tell the user to edit shell PATH/i);

  assert.match(readme, /Do not ask users to edit shell PATH/);
  assert.match(readme, /CLAUDE_COMPANION_CLAUDE_BIN/);
  assert.doesNotMatch(readme, /set `CLAUDE_COMPANION_CLAUDE_BIN` if `claude` is not on `PATH`/);

  assert.match(guide, /Do not ask users to edit shell PATH/);
});

test("skill docs include setup, status, result, cancel, background, and wait commands", () => {
  const combined = skillFiles.map(read).join("\n");
  const plan = read("plugins/claude-code-bridge/skills/claude-plan/SKILL.md");
  const resultHandling = read("plugins/claude-code-bridge/skills/claude-result-handling/SKILL.md");

  assert.match(combined, /setup --json/);
  assert.match(combined, /status "\$JOB_ID" --json/);
  assert.match(combined, /status --all --brief --json/);
  assert.match(combined, /result "\$JOB_ID" --json/);
  assert.match(combined, /cancel "\$JOB_ID" --json/);
  assert.match(combined, /status "\$JOB_ID" --cwd "\$WORKSPACE" --json/);
  assert.match(combined, /result "\$JOB_ID" --cwd "\$WORKSPACE" --json/);
  assert.match(combined, /cancel "\$JOB_ID" --cwd "\$WORKSPACE" --json/);
  assert.match(combined, /storage --json/);
  assert.match(combined, /storage --cwd "\$WORKSPACE" --json/);
  assert.match(combined, /cleanup --dry-run --json/);
  assert.match(combined, /cleanup --all --dry-run --json/);
  assert.match(combined, /background or waited job was started with `--cwd "\$WORKSPACE"`/);
  assert.match(combined, /--background --json/);
  assert.match(combined, /--wait --json/);
  assert.match(combined, /Do not add `--timeout` or `--timeout-ms` by default/);
  assert.match(combined, /hard stops for explicit user time budgets, smoke tests, or deliberate cancellation probes only/);
  assert.match(combined, /A running job can legitimately have empty stdout\/stderr for a while/);
  assert.match(combined, /Do not cancel, add a timeout, or rerun only because stdout\/stderr is quiet/);
  assert.match(plan, /A running job can legitimately have empty stdout\/stderr for a while/);
  assert.match(resultHandling, /A running job can legitimately have empty stdout\/stderr for a while/);
  assert.match(combined, /Do not request unbounded raw logs/);
  assert.match(combined, /status --json` includes `phase`, `pid`, `claudePid`, `claudeArgv`, `runtimeMs`, `idleMs`, `lastActivityAt`, `firstOutputAt`, `lastOutputAt`, bounded `recentLog` entries/);
  assert.match(combined, /prompt args, stdout\/stderr tails, and embedded stored results are omitted/);
  assert.match(combined, /metadata\.resultAvailable` is `false`/);
  assert.match(combined, /whether TERM or KILL was used/);

  const review = read("plugins/claude-code-bridge/skills/claude-review/SKILL.md");
  assert.match(review, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" review --json --scope working-tree/);
  assert.match(review, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" adversarial-review --json --scope auto --prompt "\$FOCUS"/);

  const rescue = read("plugins/claude-code-bridge/skills/claude-rescue/SKILL.md");
  assert.match(rescue, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" rescue --json --prompt "\$PROMPT"/);
  assert.match(rescue, /node "\$CLAUDE_PLUGIN_ROOT\/scripts\/claude-companion\.mjs" rescue --write --json --prompt "\$PROMPT"/);
});
