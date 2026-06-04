#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("1.0.4");
  process.exit(0);
}

if (process.env.FAKE_AGY_SLEEP_MS) {
  await new Promise((resolve) => setTimeout(resolve, Number.parseInt(process.env.FAKE_AGY_SLEEP_MS, 10)));
}

if (process.env.FAKE_AGY_FAIL) {
  console.error("fake agy failure");
  process.exit(2);
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
