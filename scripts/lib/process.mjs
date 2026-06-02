import { spawn } from "node:child_process";

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    let timedOut = false;
    let timeout = null;
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: false
    });

    let stdout = "";
    let stderr = "";

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({ timedOut, ...result });
    }

    if (Number.isInteger(options.timeoutMs) && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill(options.killSignal ?? "SIGTERM");
      }, options.timeoutMs);
    }

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish({ status: null, signal: timedOut ? (options.killSignal ?? "SIGTERM") : null, stdout, stderr, error });
    });
    child.on("close", (status, signal) => {
      finish({ status: timedOut ? null : status, signal, stdout, stderr, error: null });
    });
  });
}

export async function binaryAvailable(command, args = ["--version"], options = {}) {
  const result = await runCommand(command, args, options);
  return {
    available: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error ? result.error.message : null
  };
}

export function terminateProcessTree(pid, signal = "SIGTERM", options = {}) {
  if (!Number.isInteger(pid) || pid <= 1) {
    return false;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    if (options.allowPidFallback !== true) {
      return false;
    }
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
