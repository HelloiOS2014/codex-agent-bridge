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

const EXPECTED_PLUGINS = new Map([
  ["claude-code-bridge", {
    displayName: "Claude Code Bridge",
    rootPath: "./plugins/claude-code-bridge"
  }],
  ["antigravity-bridge", {
    displayName: "Antigravity Bridge",
    rootPath: "./plugins/antigravity-bridge"
  }]
]);

function checkPluginEntry(marketplacePath, entry, expectedPath, expected) {
  assert(EXPECTED_PLUGINS.has(entry.name), `${marketplacePath}: unexpected plugin name ${entry.name}`);
  assert(expected?.displayName, `${marketplacePath}: missing expected metadata for ${entry.name}`);
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
  assert(manifest.interface?.displayName === expected.displayName, `${manifestPath}: unexpected display name`);
  assert(manifest.interface?.category === "Developer Tools", `${manifestPath}: unexpected category`);
}

function findPlugin(marketplacePath, marketplace, name) {
  const entry = marketplace.plugins.find((plugin) => plugin.name === name);
  assert(entry, `${marketplacePath}: missing plugin ${name}`);
  return entry;
}

function checkNoPluginLocalMarketplace(pluginName) {
  const marketplacePath = `plugins/${pluginName}/.agents/plugins/marketplace.json`;
  assert(
    !fs.existsSync(path.join(root, marketplacePath)),
    `${marketplacePath}: plugin-local marketplaces are not supported; use the root marketplace only`
  );
}

const rootMarketplacePath = ".agents/plugins/marketplace.json";
const rootMarketplace = readJson(rootMarketplacePath);
assert(rootMarketplace.name === "codex-agent-bridge", "root marketplace name mismatch");
assert(rootMarketplace.interface?.displayName === "Agent Bridge", "root marketplace display name mismatch");
assert(Array.isArray(rootMarketplace.plugins), "root marketplace plugins must be an array");
assert(rootMarketplace.plugins.length === EXPECTED_PLUGINS.size, "root marketplace plugin count mismatch");

for (const [pluginName, expected] of EXPECTED_PLUGINS) {
  checkPluginEntry(rootMarketplacePath, findPlugin(rootMarketplacePath, rootMarketplace, pluginName), expected.rootPath, expected);
  checkNoPluginLocalMarketplace(pluginName);
}
