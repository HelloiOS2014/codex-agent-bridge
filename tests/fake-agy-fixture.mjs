#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("1.0.5");
  process.exit(0);
}

if (process.env.FAKE_AGY_SLEEP_MS) {
  await new Promise((resolve) => setTimeout(resolve, Number.parseInt(process.env.FAKE_AGY_SLEEP_MS, 10)));
}

if (process.env.FAKE_AGY_FAIL) {
  console.error("fake agy failure");
  process.exit(2);
}

if (process.env.FAKE_AGY_TOUCH) {
  fs.writeFileSync(path.join(process.cwd(), process.env.FAKE_AGY_TOUCH), "fake agy touched this file\n", "utf8");
}

if (process.env.FAKE_AGY_AUTH_TIMEOUT) {
  console.log("authentication timed out");
  process.exit(0);
}

const terminatorIndex = args.indexOf("--");
const prompt = terminatorIndex >= 0 ? args.slice(terminatorIndex + 1).join(" ") : "";

console.log(JSON.stringify({
  type: "result",
  session_id: "fake-agy-session",
  result: [
    `Fake Agy response: ${prompt}`,
    "ARGS:",
    JSON.stringify(args)
  ].join("\n")
}));
