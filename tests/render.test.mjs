import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCompanionResult,
  renderPlanResult,
  renderReviewResult,
  renderRescueResult,
  renderStoredResult,
  renderStatus
} from "../scripts/lib/render.mjs";

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
