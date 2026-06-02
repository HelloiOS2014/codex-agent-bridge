const FINAL_KINDS = new Set(["plan", "review", "adversarial-review", "rescue"]);

const DEFAULT_TITLES = {
  plan: "Claude Plan",
  review: "Claude Review",
  "adversarial-review": "Claude Adversarial Review",
  rescue: "Claude Rescue"
};

const SEVERITY_RANK = new Map([
  ["critical", 0],
  ["blocker", 0],
  ["high", 1],
  ["major", 1],
  ["medium", 2],
  ["moderate", 2],
  ["low", 3],
  ["minor", 3],
  ["info", 4],
  ["informational", 4]
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function compactString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function stringifyRaw(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function parseJsonText(value) {
  if (typeof value !== "string") {
    return { parsed: null, error: null };
  }
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return { parsed: null, error: null };
  }
  try {
    return { parsed: JSON.parse(trimmed), error: null };
  } catch (error) {
    return { parsed: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeKind(kind) {
  return FINAL_KINDS.has(kind) ? kind : "plan";
}

function normalizeStatus(status, input = {}) {
  if (typeof status === "number") {
    return status === 0 ? "completed" : "failed";
  }
  if (typeof status === "string" && status.trim()) {
    return status.trim();
  }
  if (input.error || input.errorMessage || input.timedOut) {
    return "failed";
  }
  return "completed";
}

function extractRawOutput(input) {
  if (!isPlainObject(input)) {
    return stringifyRaw(input);
  }
  if (input.rawOutput !== undefined) {
    return stringifyRaw(input.rawOutput);
  }
  if (input.raw !== undefined) {
    return stringifyRaw(input.raw);
  }
  if (input.stdout !== undefined) {
    const stdout = stringifyRaw(input.stdout);
    const stderr = stringifyRaw(input.stderr);
    return stdout || stderr ? [stdout, stderr].filter(Boolean).join("\n") : "";
  }
  if (input.output !== undefined) {
    return stringifyRaw(input.output);
  }
  if (input.text !== undefined) {
    return stringifyRaw(input.text);
  }
  return "";
}

function extractClaudeEnvelope(input, rawOutput) {
  const stdout = isPlainObject(input) ? input.stdout ?? input.raw ?? input.rawOutput : rawOutput;
  const { parsed, error } = parseJsonText(stringifyRaw(stdout));
  if (!isPlainObject(parsed)) {
    return { envelope: null, parseError: error };
  }
  if (
    Object.hasOwn(parsed, "result")
    || Object.hasOwn(parsed, "session_id")
    || Object.hasOwn(parsed, "sessionId")
    || Object.hasOwn(parsed, "type")
  ) {
    return { envelope: parsed, parseError: null };
  }
  return { envelope: null, parseError: null };
}

function pickClaudeText(input, envelope, rawOutput) {
  if (isPlainObject(input)) {
    if (input.text !== undefined) {
      return input.text;
    }
    if (input.output !== undefined) {
      return input.output;
    }
    if (input.result !== undefined) {
      return input.result;
    }
  }
  if (envelope) {
    if (envelope.result !== undefined) {
      return envelope.result;
    }
    if (envelope.output !== undefined) {
      return envelope.output;
    }
    if (envelope.text !== undefined) {
      return envelope.text;
    }
  }
  return rawOutput;
}

function extractStructured(value) {
  if (isPlainObject(value)) {
    return { structured: cloneJson(value), parseError: null, text: "" };
  }
  const text = compactString(value);
  const { parsed, error } = parseJsonText(text);
  if (isPlainObject(parsed)) {
    return { structured: parsed, parseError: null, text: "" };
  }
  return { structured: {}, parseError: error, text };
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeFinding(finding, index) {
  if (typeof finding === "string") {
    return {
      severity: "info",
      title: finding,
      detail: "",
      file: null,
      line: null,
      column: null,
      metadata: {},
      _index: index
    };
  }
  const source = isPlainObject(finding) ? finding : {};
  const severity = compactString(source.severity ?? source.level ?? source.priority ?? "info").toLowerCase() || "info";
  return {
    severity,
    title: compactString(source.title ?? source.summary ?? source.message ?? source.description ?? "(untitled finding)"),
    detail: compactString(source.detail ?? source.details ?? source.body ?? source.explanation ?? ""),
    file: compactString(source.file ?? source.path ?? source.filename ?? source.location?.file) || null,
    line: source.line ?? source.startLine ?? source.location?.line ?? null,
    column: source.column ?? source.col ?? source.location?.column ?? null,
    metadata: cloneJson(source.metadata ?? {}),
    _index: index
  };
}

function severityWeight(severity) {
  return SEVERITY_RANK.get(String(severity).toLowerCase()) ?? 5;
}

function normalizeFindings(...sources) {
  return sources
    .flatMap((source) => asArray(source))
    .filter((finding) => finding !== undefined && finding !== null && finding !== "")
    .map((finding, index) => normalizeFinding(finding, index))
    .sort((left, right) => {
      const severityDelta = severityWeight(left.severity) - severityWeight(right.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      const fileDelta = String(left.file ?? "").localeCompare(String(right.file ?? ""));
      if (fileDelta !== 0) {
        return fileDelta;
      }
      const lineDelta = Number(left.line ?? Number.MAX_SAFE_INTEGER) - Number(right.line ?? Number.MAX_SAFE_INTEGER);
      if (lineDelta !== 0) {
        return lineDelta;
      }
      return left._index - right._index;
    })
    .map(({ _index, ...finding }) => finding);
}

function normalizeActions(...sources) {
  return sources
    .flatMap((source) => asArray(source))
    .filter((action) => action !== undefined && action !== null && action !== "")
    .map((action) => {
      if (typeof action === "string") {
        return { title: action, detail: "" };
      }
      const source = isPlainObject(action) ? action : {};
      return {
        title: compactString(source.title ?? source.summary ?? source.label ?? source.action ?? "(untitled action)"),
        detail: compactString(source.detail ?? source.details ?? source.description ?? "")
      };
    });
}

function normalizeStringList(...sources) {
  const values = sources
    .flatMap((source) => asArray(source))
    .map((value) => {
      if (typeof value === "string") {
        return value.trim();
      }
      if (isPlainObject(value)) {
        return compactString(value.file ?? value.path ?? value.name);
      }
      return compactString(value);
    })
    .filter(Boolean);
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeTextList(...sources) {
  return sources
    .flatMap((source) => asArray(source))
    .map(compactString)
    .filter(Boolean);
}

function normalizeSteps(...sources) {
  return sources
    .flatMap((source) => asArray(source))
    .filter((step) => step !== undefined && step !== null && step !== "")
    .map((step) => {
      if (typeof step === "string") {
        return { title: step, detail: "" };
      }
      const source = isPlainObject(step) ? step : {};
      return {
        title: compactString(source.title ?? source.name ?? source.step ?? source.summary ?? "(untitled step)"),
        detail: compactString(source.detail ?? source.details ?? source.description ?? source.summary ?? "")
      };
    });
}

function normalizeChecklist(...sources) {
  return sources
    .flatMap((source) => asArray(source))
    .filter((item) => item !== undefined && item !== null && item !== "")
    .map((item) => {
      if (typeof item === "string") {
        return { text: item, done: false };
      }
      const source = isPlainObject(item) ? item : {};
      return {
        text: compactString(source.text ?? source.title ?? source.item ?? source.summary ?? "(untitled item)"),
        done: Boolean(source.done ?? source.completed ?? source.checked)
      };
    });
}

function mergeMetadata(...sources) {
  const metadata = {};
  for (const source of sources) {
    if (isPlainObject(source)) {
      Object.assign(metadata, cloneJson(source));
    }
  }
  return metadata;
}

function buildError(input, status, stderr) {
  if (!isPlainObject(input)) {
    return null;
  }
  if (input.error instanceof Error) {
    return input.error.message;
  }
  const explicitError = compactString(input.error ?? input.errorMessage);
  if (explicitError) {
    return explicitError;
  }
  if (input.timedOut) {
    return "Claude command timed out";
  }
  if (status === "failed") {
    return compactString(stderr) || "Claude command failed";
  }
  return null;
}

function firstNonEmpty(...values) {
  return values.map(compactString).find(Boolean) ?? "";
}

function renderFieldLine(label, value) {
  return value ? `${label}: ${value}` : "";
}

function renderLocation(finding) {
  if (!finding.file) {
    return "";
  }
  if (finding.line !== null && finding.line !== undefined && finding.line !== "") {
    const column = finding.column !== null && finding.column !== undefined && finding.column !== ""
      ? `:${finding.column}`
      : "";
    return `${finding.file}:${finding.line}${column}`;
  }
  return finding.file;
}

function renderFinding(finding) {
  const location = renderLocation(finding);
  const suffix = location ? ` - ${location}` : "";
  const detail = finding.detail ? `\n  ${finding.detail}` : "";
  return `- [${finding.severity}] ${finding.title}${suffix}${detail}`;
}

function renderActions(actions) {
  if (!actions.length) {
    return [];
  }
  return [
    "## Actions",
    "",
    ...actions.map((action) => {
      const detail = action.detail ? ` - ${action.detail}` : "";
      return `- ${action.title}${detail}`;
    })
  ];
}

function renderPlan(normalized) {
  const lines = [
    `# ${normalized.title}`,
    "",
    normalized.status !== "completed" ? renderFieldLine("Status", normalized.status) : "",
    renderFieldLine("Summary", normalized.summary),
    normalized.sessionId ? `Claude session: \`${normalized.sessionId}\`` : "",
    normalized.error ? `Error: ${normalized.error}` : ""
  ].filter(Boolean);

  if (normalized.text) {
    lines.push("", normalized.text);
  }
  if (normalized.steps.length) {
    lines.push("", "## Steps", "", ...normalized.steps.map((step, index) => {
      const detail = step.detail && step.detail !== step.title ? ` - ${step.detail}` : "";
      return `${index + 1}. ${step.title}${detail}`;
    }));
  }
  if (normalized.checklist.length) {
    lines.push("", "## Checklist", "", ...normalized.checklist.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`));
  }
  lines.push(...withSectionBreak(renderActions(normalized.actions), lines));

  if (!normalized.text && !normalized.steps.length && !normalized.checklist.length && !normalized.actions.length) {
    lines.push("", "(no output)");
  }
  return lines.join("\n");
}

function renderReview(normalized) {
  const lines = [
    `# ${normalized.title}`,
    "",
    renderFieldLine("Target", normalized.metadata.targetLabel),
    normalized.status !== "completed" ? renderFieldLine("Status", normalized.status) : "",
    normalized.metadata.truncated ? "Note: review context was truncated; omitted content is recorded in metadata." : "",
    normalized.sessionId ? `Claude session: \`${normalized.sessionId}\`` : "",
    normalized.error ? `Error: ${normalized.error}` : "",
    renderFieldLine("Summary", normalized.summary)
  ].filter(Boolean);

  if (normalized.findings.length) {
    lines.push("", "## Findings", "", ...normalized.findings.map(renderFinding));
  }
  if (normalized.text) {
    lines.push("", normalized.findings.length ? "## Output" : "## Findings", "", normalized.text);
  }
  lines.push(...withSectionBreak(renderActions(normalized.actions), lines));

  if (!normalized.findings.length && !normalized.text && !normalized.actions.length) {
    lines.push("", "(no findings reported)");
  }
  return lines.join("\n");
}

function renderRescue(normalized) {
  const mode = normalized.metadata.write ? "write-enabled" : "read-only / dry-run";
  const lines = [
    `# ${normalized.title}`,
    "",
    `Mode: ${mode}`,
    normalized.status !== "completed" ? renderFieldLine("Status", normalized.status) : "",
    renderFieldLine("Summary", normalized.summary),
    normalized.sessionId ? `Claude session: \`${normalized.sessionId}\`` : "",
    normalized.error ? `Error: ${normalized.error}` : "",
    "",
    "## Output",
    "",
    normalized.text || "(no output)",
    "",
    "## Touched Files",
    "",
    ...(normalized.touchedFiles.length ? normalized.touchedFiles.map((file) => `- ${file}`) : ["(none)"])
  ].filter((line) => line !== "");
  lines.push(...withSectionBreak(renderActions(normalized.actions), lines));
  return lines.join("\n");
}

function withSectionBreak(section, existingLines) {
  if (!section.length) {
    return [];
  }
  return existingLines.length ? ["", ...section] : section;
}

function renderGeneric(normalized) {
  return [
    `# ${normalized.title}`,
    "",
    normalized.status !== "completed" ? renderFieldLine("Status", normalized.status) : "",
    renderFieldLine("Summary", normalized.summary),
    normalized.error ? `Error: ${normalized.error}` : "",
    "",
    normalized.text || "(no output)"
  ].filter(Boolean).join("\n");
}

function renderNormalizedResult(normalized) {
  if (normalized.kind === "plan") {
    return renderPlan(normalized);
  }
  if (normalized.kind === "review" || normalized.kind === "adversarial-review") {
    return renderReview(normalized);
  }
  if (normalized.kind === "rescue") {
    return renderRescue(normalized);
  }
  return renderGeneric(normalized);
}

export function normalizeCompanionResult(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : { output: input };
  const rawOutput = extractRawOutput(source);
  const { envelope, parseError: envelopeParseError } = extractClaudeEnvelope(source, rawOutput);
  const claudeText = pickClaudeText(source, envelope, rawOutput);
  const { structured, parseError: structuredParseError, text } = extractStructured(claudeText);
  const kind = normalizeKind(options.kind ?? source.kind ?? structured.kind);
  const status = normalizeStatus(source.status ?? structured.status, source);
  const stderr = isPlainObject(source) ? source.stderr : "";
  const error = buildError(source, status, stderr);
  const metadata = mergeMetadata(
    structured.metadata,
    source.metadata,
    options.metadata,
    {
      targetLabel: firstNonEmpty(options.targetLabel, source.targetLabel, structured.targetLabel),
      truncated: Boolean(options.truncated ?? source.truncated ?? structured.truncated),
      write: Boolean(options.write ?? source.write ?? structured.write)
    }
  );
  if (envelopeParseError) {
    metadata.parseError = envelopeParseError;
  }
  if (structuredParseError) {
    metadata.parseError = structuredParseError;
  }
  if (source.signal) {
    metadata.signal = source.signal;
  }
  if (source.timedOut) {
    metadata.timedOut = true;
  }

  const normalized = {
    kind,
    status,
    title: firstNonEmpty(options.title, source.title, structured.title, DEFAULT_TITLES[kind]),
    summary: firstNonEmpty(source.summary, structured.summary),
    text: firstNonEmpty(source.text, structured.text, structured.markdown, structured.output, text),
    rawOutput,
    rendered: "",
    findings: normalizeFindings(source.findings, structured.findings, structured.issues),
    actions: normalizeActions(source.actions, structured.actions, structured.recommendations, structured.nextSteps),
    touchedFiles: normalizeStringList(source.touchedFiles, structured.touchedFiles, structured.changedFiles, structured.files),
    reasoningSummary: normalizeTextList(source.reasoningSummary, structured.reasoningSummary),
    sessionId: firstNonEmpty(source.sessionId, source.claudeSessionId, envelope?.session_id, envelope?.sessionId, structured.sessionId) || null,
    error,
    metadata,
    steps: normalizeSteps(source.steps, structured.steps, structured.plan),
    checklist: normalizeChecklist(source.checklist, structured.checklist, structured.acceptanceCriteria)
  };
  normalized.rendered = renderNormalizedResult(normalized);
  return normalized;
}

function renderResultForKind(kind, input, options = {}) {
  const normalized = normalizeCompanionResult(input, { ...options, kind });
  return options.json ? normalized : normalized.rendered;
}

export function renderPlanResult(result, options = {}) {
  return renderResultForKind("plan", result, options);
}

export function renderReviewResult(result, options = {}) {
  return renderResultForKind("review", result, options);
}

export function renderAdversarialReviewResult(result, options = {}) {
  return renderResultForKind("adversarial-review", result, options);
}

export function renderRescueResult(result, options = {}) {
  return renderResultForKind("rescue", result, options);
}

export function renderStoredResult(result, options = {}) {
  const normalized = normalizeCompanionResult(result, options);
  if (options.json) {
    return normalized;
  }
  if (isPlainObject(result) && typeof result.rendered === "string" && result.rendered.trim()) {
    return result.rendered;
  }
  return normalized.rendered;
}

export function renderResult(result, options = {}) {
  return renderStoredResult(result, options);
}

export function renderSetupResult(status, options = {}) {
  const payload = cloneJson(status ?? {});
  if (options.json) {
    return payload;
  }
  const ready = Boolean(payload.ready);
  const lines = [
    `Claude Companion setup: ${ready ? "ready" : "not ready"}`,
    payload.claude?.available === false ? "Claude: not found" : "",
    payload.claude?.version?.stdout ? `Claude: ${payload.claude.version.stdout.trim()}` : "",
    payload.claude?.available && payload.claude?.auth?.loggedIn === false ? "Claude auth: not logged in" : ""
  ];
  return lines.filter(Boolean).join("\n");
}

export function renderStatus(snapshot = {}, options = {}) {
  const payload = cloneJson(snapshot ?? {});
  if (options.json) {
    return payload;
  }
  const rows = [["Job", "Kind", "Status", "Phase"]];
  const seen = new Set();
  for (const job of [
    ...asArray(payload.running),
    payload.latestFinished,
    ...asArray(payload.recent)
  ].filter(Boolean)) {
    if (seen.has(job.id)) {
      continue;
    }
    seen.add(job.id);
    rows.push([
      compactString(job.id),
      compactString(job.kind),
      compactString(job.status),
      compactString(job.phase)
    ]);
  }
  if (rows.length === 1) {
    return "No Claude companion jobs recorded.";
  }
  return rows
    .map((row, index) => {
      const line = `| ${row.map((cell) => String(cell).replaceAll("|", "\\|")).join(" | ")} |`;
      if (index === 0) {
        return `${line}\n| ${row.map(() => "---").join(" | ")} |`;
      }
      return line;
    })
    .join("\n");
}
