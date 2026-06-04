import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./helpers.mjs";

test("manifest checker requires explicit expected plugin metadata", () => {
  const source = fs.readFileSync(path.join(repoRoot, "scripts", "check-manifest.mjs"), "utf8");

  assert.doesNotMatch(source, /function\s+checkPluginEntry\([^)]*expected\s*=\s*\{\}/);
});
