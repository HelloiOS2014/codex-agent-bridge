#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("2.1.160 (Claude Code)");
  process.exit(0);
}

if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "oauth_token", apiProvider: "firstParty" }));
  process.exit(0);
}

if (process.env.FAKE_CLAUDE_FAIL === "1") {
  console.error("fake claude failure");
  process.exit(42);
}

if (process.env.FAKE_CLAUDE_SLEEP_MS) {
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_CLAUDE_SLEEP_MS)));
}

const prompt = args[args.length - 1] ?? "";
const payload = {
  type: "result",
  session_id: "fake-claude-session",
  result: `Fake Claude response: ${prompt}`
};

console.log(JSON.stringify(payload));
