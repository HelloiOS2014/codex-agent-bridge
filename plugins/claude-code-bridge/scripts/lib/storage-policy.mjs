const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS = {
  maxJobs: 50,
  maxStateBytes: 536870912,
  maxLogBytes: 5242880,
  maxResultBytes: 2097152,
  maxResultTextBytes: 1048576,
  maxJobAgeDays: 7
};

function positiveInteger(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const value = String(raw);
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe positive integer.`);
  }
  return parsed;
}

export function readStoragePolicy(env = process.env) {
  const maxJobAgeDays = positiveInteger(env, "CLAUDE_COMPANION_MAX_JOB_AGE_DAYS", DEFAULTS.maxJobAgeDays);
  return {
    maxJobs: positiveInteger(env, "CLAUDE_COMPANION_MAX_JOBS", DEFAULTS.maxJobs),
    maxStateBytes: positiveInteger(env, "CLAUDE_COMPANION_MAX_STATE_BYTES", DEFAULTS.maxStateBytes),
    maxLogBytes: positiveInteger(env, "CLAUDE_COMPANION_MAX_LOG_BYTES", DEFAULTS.maxLogBytes),
    maxResultBytes: positiveInteger(env, "CLAUDE_COMPANION_MAX_RESULT_BYTES", DEFAULTS.maxResultBytes),
    maxResultTextBytes: positiveInteger(
      env,
      "CLAUDE_COMPANION_MAX_RESULT_TEXT_BYTES",
      DEFAULTS.maxResultTextBytes
    ),
    maxJobAgeMs: maxJobAgeDays * DAY_MS
  };
}
