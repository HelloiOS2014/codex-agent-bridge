import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCompanionResult,
  renderPlanResult,
  renderReviewResult,
  renderRescueResult,
  renderStoredResult,
  renderStatus
} from "../plugins/claude-companion/scripts/lib/render.mjs";

test("renderPlanResult preserves raw text output", () => {
  const rendered = renderPlanResult({ output: "Architecture plan", sessionId: "s1" });

  assert.match(rendered, /Claude Plan/);
  assert.match(rendered, /Architecture plan/);
  assert.match(rendered, /s1/);
});

test("renderPlanResult preserves structured steps and checklist from Claude JSON shape", () => {
  const input = {
    status: 0,
    stdout: JSON.stringify({
      type: "result",
      session_id: "fake-claude-session",
      result: JSON.stringify({
        summary: "Build the companion renderer",
        steps: [
          { title: "Normalize", summary: "Create a result shape" },
          "Render deterministically"
        ],
        checklist: [
          { text: "No filesystem writes", done: true },
          "Run node tests"
        ]
      })
    })
  };

  const normalized = renderPlanResult(input, { json: true });
  const rendered = renderPlanResult(input);

  assert.equal(normalized.kind, "plan");
  assert.equal(normalized.status, "completed");
  assert.equal(normalized.sessionId, "fake-claude-session");
  assert.equal(normalized.rawOutput, input.stdout);
  assert.match(rendered, /## Steps/);
  assert.match(rendered, /1\. Normalize - Create a result shape/);
  assert.match(rendered, /- \[x\] No filesystem writes/);
  assert.match(rendered, /- \[ \] Run node tests/);
});

test("renderReviewResult sorts findings by severity and includes file and line", () => {
  const rendered = renderReviewResult({
    targetLabel: "working tree diff",
    findings: [
      { severity: "low", title: "Minor copy issue", file: "README.md", line: 12 },
      { severity: "critical", title: "Data loss", file: "scripts/lib/state.mjs", line: 44 },
      { severity: "high", title: "Race condition", file: "scripts/lib/jobs.mjs", line: 9 }
    ],
    truncated: true
  });

  assert.match(rendered, /Claude Review/);
  assert.match(rendered, /Target: working tree diff/);
  assert.match(rendered, /context was truncated/);
  assert.ok(rendered.indexOf("[critical] Data loss") < rendered.indexOf("[high] Race condition"));
  assert.ok(rendered.indexOf("[high] Race condition") < rendered.indexOf("[low] Minor copy issue"));
  assert.match(rendered, /scripts\/lib\/state\.mjs:44/);
});

test("normalizeCompanionResult fills missing fields deterministically", () => {
  const normalized = normalizeCompanionResult({}, { kind: "review" });

  assert.deepEqual({
    kind: normalized.kind,
    status: normalized.status,
    title: normalized.title,
    summary: normalized.summary,
    text: normalized.text,
    rawOutput: normalized.rawOutput,
    findings: normalized.findings,
    actions: normalized.actions,
    touchedFiles: normalized.touchedFiles,
    sessionId: normalized.sessionId,
    error: normalized.error
  }, {
    kind: "review",
    status: "completed",
    title: "Claude Review",
    summary: "",
    text: "",
    rawOutput: "",
    findings: [],
    actions: [],
    touchedFiles: [],
    sessionId: null,
    error: null
  });
  assert.equal(typeof normalized.rendered, "string");
  assert.equal(typeof normalized.metadata, "object");
});

test("normalizeCompanionResult marks nonzero Claude output as failed and preserves stderr", () => {
  const normalized = normalizeCompanionResult({
    status: 42,
    stdout: "",
    stderr: "fake claude failure"
  }, { kind: "review" });

  assert.equal(normalized.status, "failed");
  assert.match(normalized.error, /fake claude failure/);
  assert.match(normalized.rawOutput, /fake claude failure/);
  assert.match(normalized.rendered, /fake claude failure/);
});

test("normalizeCompanionResult maps raw statuses to schema enum values", () => {
  const allowed = new Set(["completed", "failed", "cancelled", "running", "queued"]);
  const cases = [
    [{ status: "0" }, "completed"],
    [{ status: "42" }, "failed"],
    [{ status: null, signal: "SIGTERM" }, "cancelled"],
    [{ status: null, timedOut: true }, "cancelled"],
    [{ status: "cancelled" }, "cancelled"],
    [{ status: "cancel" }, "cancelled"],
    [{ error: new Error("spawn failed") }, "failed"],
    [{ stderr: "stderr failure" }, "failed"]
  ];

  for (const [input, expected] of cases) {
    const normalized = normalizeCompanionResult(input, { kind: "review" });

    assert.equal(normalized.status, expected);
    assert.equal(allowed.has(normalized.status), true);
  }

  const unknown = normalizeCompanionResult({ status: "mystery-state" }, { kind: "review" });

  assert.equal(unknown.status, "failed");
  assert.equal(unknown.metadata.rawStatus, "mystery-state");
  assert.notEqual(unknown.status, "mystery-state");
});

test("renderReviewResult sanitizes finding markdown fields", () => {
  const rendered = renderReviewResult({
    findings: [{
      severity: "high\nStatus: failed",
      title: "Real title\n- [critical] fake title",
      file: "src/real.js\nStatus: failed",
      line: "12\n- [critical] fake line",
      column: "5\nStatus: failed",
      detail: "first detail line\n- [critical] fake detail\nStatus: failed"
    }]
  });
  const lines = rendered.split("\n");

  assert.equal(lines.filter((line) => line.startsWith("- [")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("Status: failed")).length, 0);
  assert.match(rendered, /Real title - \[critical\] fake title/);
  assert.match(rendered, /src\/real\.js Status: failed:12 - \[critical\] fake line:5 Status: failed/);
  assert.match(rendered, /\n  first detail line\n  - \[critical\] fake detail\n  Status: failed/);
});

test("renderReviewResult ranks numeric and P-style priorities before lower severities", () => {
  const rendered = renderReviewResult({
    findings: [
      { severity: "info", title: "Info issue" },
      { severity: "low", title: "Low issue" },
      { severity: "medium", title: "Medium issue" },
      { severity: "high", title: "High issue" },
      { priority: "P0", title: "P0 issue" },
      { priority: 0, title: "Priority zero issue" },
      { severity: "warning", title: "Warning issue" },
      { severity: "error", title: "Error issue" }
    ]
  });

  assert.ok(rendered.indexOf("P0 issue") < rendered.indexOf("High issue"));
  assert.ok(rendered.indexOf("Priority zero issue") < rendered.indexOf("High issue"));
  assert.ok(rendered.indexOf("Error issue") < rendered.indexOf("Warning issue"));
  assert.ok(rendered.indexOf("Warning issue") < rendered.indexOf("Low issue"));
  assert.ok(rendered.indexOf("High issue") < rendered.indexOf("Medium issue"));
  assert.ok(rendered.indexOf("Medium issue") < rendered.indexOf("Low issue"));
  assert.ok(rendered.indexOf("Low issue") < rendered.indexOf("Info issue"));
});

test("renderRescueResult distinguishes write mode and touched files", () => {
  const dryRun = renderRescueResult({ output: "Investigated only", write: false });
  const writeEnabled = renderRescueResult({
    output: "Fixed",
    write: true,
    touchedFiles: ["b.js", "a.js", "a.js"]
  });

  assert.match(dryRun, /Mode: read-only \/ dry-run/);
  assert.match(writeEnabled, /Mode: write-enabled/);
  assert.match(writeEnabled, /- a\.js/);
  assert.match(writeEnabled, /- b\.js/);
  assert.equal(writeEnabled.indexOf("- a.js") < writeEnabled.indexOf("- b.js"), true);
});

test("renderStatus creates compact table", () => {
  const rendered = renderStatus({
    running: [{ id: "job-1", kind: "plan", status: "running", phase: "starting" }],
    latestFinished: null,
    recent: []
  });

  assert.match(rendered, /job-1/);
  assert.match(rendered, /running/);
});

test("renderStoredResult preserves stored rendered text and normalizes json mode", () => {
  const stored = {
    kind: "review",
    status: "completed",
    summary: "review done",
    rawOutput: "raw",
    rendered: "already rendered",
    reasoningSummary: ["checked the diff"]
  };

  assert.equal(renderStoredResult(stored), "already rendered");
  assert.deepEqual(renderStoredResult(stored, { json: true }).reasoningSummary, ["checked the diff"]);
  assert.equal(renderStoredResult(stored, { json: true }).rawOutput, "raw");
});

test("normalization and rendering do not mutate input object", () => {
  const input = {
    output: JSON.stringify({
      summary: "Review",
      findings: [{ severity: "high", title: "Bug", file: "a.js", line: 1 }],
      touchedFiles: ["z.js", "a.js"]
    }),
    metadata: { nested: { value: 1 } },
    touchedFiles: ["z.js", "a.js"]
  };
  const before = structuredClone(input);

  normalizeCompanionResult(input, { kind: "review" });
  renderReviewResult(input);

  assert.deepEqual(input, before);
});
