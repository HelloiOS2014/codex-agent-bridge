import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function checkPluginEntry(marketplacePath, entry, expectedPath) {
  assert(entry.name === "claude-code-bridge", `${marketplacePath}: unexpected plugin name`);
  assert(entry.category === "Developer Tools", `${marketplacePath}: category must be Developer Tools`);
  assert(entry.source?.source === "local", `${marketplacePath}: source must be local`);
  assert(entry.source?.path === expectedPath, `${marketplacePath}: unexpected source path`);
  assert(entry.policy?.installation === "AVAILABLE", `${marketplacePath}: plugin must be installable`);

  const marketplaceDir = path.dirname(path.join(root, marketplacePath));
  const pluginRoot = path.resolve(marketplaceDir, "..", "..", entry.source.path);
  const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert(manifest.name === entry.name, `${manifestPath}: name must match marketplace entry`);
  assert(manifest.version, `${manifestPath}: missing version`);
  assert(manifest.skills === "./skills/", `${manifestPath}: missing skills directory`);
  assert(fs.existsSync(path.join(pluginRoot, manifest.skills)), `${manifestPath}: skills directory missing`);
  assert(!Object.hasOwn(manifest, "mcpServers"), `${manifestPath}: mcpServers must not be declared`);
  assert(manifest.interface?.displayName === "Claude Code Bridge", `${manifestPath}: unexpected display name`);
  assert(manifest.interface?.category === "Developer Tools", `${manifestPath}: unexpected category`);
}

const rootMarketplacePath = ".agents/plugins/marketplace.json";
const rootMarketplace = readJson(rootMarketplacePath);
assert(rootMarketplace.name === "codex-agent-bridge", "root marketplace name mismatch");
assert(rootMarketplace.interface?.displayName === "Agent Bridge", "root marketplace display name mismatch");
assert(Array.isArray(rootMarketplace.plugins), "root marketplace plugins must be an array");
assert(rootMarketplace.plugins.length >= 1, "root marketplace must expose at least one plugin");
checkPluginEntry(rootMarketplacePath, rootMarketplace.plugins[0], "./plugins/claude-code-bridge");

const claudeMarketplacePath = "plugins/claude-code-bridge/.agents/plugins/marketplace.json";
const claudeMarketplace = readJson(claudeMarketplacePath);
assert(claudeMarketplace.name === "claude-code-bridge", "single-plugin marketplace name mismatch");
assert(claudeMarketplace.interface?.displayName === "Claude Code Bridge", "single-plugin marketplace display name mismatch");
assert(Array.isArray(claudeMarketplace.plugins), "single-plugin marketplace plugins must be an array");
assert(claudeMarketplace.plugins.length === 1, "single-plugin marketplace must expose exactly one plugin");
checkPluginEntry(claudeMarketplacePath, claudeMarketplace.plugins[0], "./");
