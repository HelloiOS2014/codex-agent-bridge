import { spawn } from "node:child_process";

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ status: null, stdout, stderr, error });
    });
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr, error: null });
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

export function terminateProcessTree(pid, signal = "SIGTERM") {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
