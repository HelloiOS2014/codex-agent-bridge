import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const plugins = [
  {
    name: "claude-code-bridge",
    displayName: "Claude Code Bridge",
    root: new URL("../plugins/claude-code-bridge/", import.meta.url)
  },
  {
    name: "antigravity-bridge",
    displayName: "Antigravity Bridge",
    root: new URL("../plugins/antigravity-bridge/", import.meta.url)
  }
];

async function readPluginJson(plugin, relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, plugin.root), "utf8"));
}

test("plugin manifests point to present scaffold assets", async () => {
  for (const plugin of plugins) {
    const manifest = await readPluginJson(plugin, ".codex-plugin/plugin.json");

    assert.equal(manifest.name, plugin.name);
    assert.equal(manifest.version, "0.1.0");
    assert.equal(manifest.skills, "./skills/");
    assert.equal(existsSync(new URL(manifest.skills, plugin.root)), true);
    assert.equal(Object.hasOwn(manifest, "homepage"), false);
    assert.equal(Object.hasOwn(manifest, "repository"), false);
    assert.equal(Object.hasOwn(manifest, "mcpServers"), false);
    assert.equal(manifest.interface.displayName, plugin.displayName);
    assert.deepEqual(manifest.interface.capabilities, ["Interactive", "Read", "Write"]);
  }
});

test("review output schemas constrain known companion result types", async () => {
  for (const plugin of plugins) {
    const schema = await readPluginJson(plugin, "schemas/review-output.schema.json");

    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.deepEqual(schema.required, ["status", "kind", "summary", "rawOutput", "rendered"]);
    assert.deepEqual(schema.properties.status, {
      type: "string",
      enum: ["completed", "failed", "cancelled", "running", "queued"],
    });
    assert.deepEqual(schema.properties.kind, {
      type: "string",
      enum: ["plan", "review", "adversarial-review", "rescue"],
    });
    assert.equal(schema.properties.summary.type, "string");
    assert.equal(schema.properties.rawOutput.type, "string");
    assert.equal(schema.properties.rendered.type, "string");
  }
});
