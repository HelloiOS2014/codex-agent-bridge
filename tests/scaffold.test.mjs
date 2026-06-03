import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const pluginRoot = new URL("../plugins/claude-code-bridge/", import.meta.url);

async function readPluginJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, pluginRoot), "utf8"));
}

test("plugin manifest points to present scaffold assets", async () => {
  const manifest = await readPluginJson(".codex-plugin/plugin.json");

  assert.equal(manifest.name, "claude-code-bridge");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(existsSync(new URL(manifest.skills, pluginRoot)), true);
  assert.equal(Object.hasOwn(manifest, "homepage"), false);
  assert.equal(Object.hasOwn(manifest, "repository"), false);
  assert.equal(manifest.interface.displayName, "Claude Code Bridge");
  assert.deepEqual(manifest.interface.capabilities, ["Interactive", "Read", "Write"]);
});

test("review output schema constrains known companion result types", async () => {
  const schema = await readPluginJson("schemas/review-output.schema.json");

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
});
