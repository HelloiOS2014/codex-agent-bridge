export const DANGEROUS_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox"
]);

export const DANGEROUS_FLAG_PREFIXES = [
  "--dangerously-",
  "--allow-dangerously-"
];

export const DANGEROUS_PERMISSION_MODES = new Set(["bypassPermissions"]);

export function flagName(arg) {
  const equalsIndex = arg.indexOf("=");
  return equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
}

export function assertNoDangerousFlags(argv) {
  for (const arg of argv) {
    const flag = flagName(arg);
    if (DANGEROUS_FLAGS.has(flag) || DANGEROUS_FLAG_PREFIXES.some((prefix) => flag.startsWith(prefix))) {
      throw new Error(`Dangerous Antigravity flag is not allowed: ${flag}`);
    }
  }
}

export function assertNoDangerousArgs(argv) {
  assertNoDangerousFlags(argv);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const flag = flagName(arg);
    if (arg === "--permission-mode" && DANGEROUS_PERMISSION_MODES.has(argv[index + 1])) {
      throw new Error(`Dangerous Antigravity permission mode is not allowed: ${argv[index + 1]}`);
    }
    if (flag === "--permission-mode" && arg.includes("=")) {
      const permissionMode = arg.slice("--permission-mode=".length);
      if (DANGEROUS_PERMISSION_MODES.has(permissionMode)) {
        throw new Error(`Dangerous Antigravity permission mode is not allowed: ${permissionMode}`);
      }
    }
  }
}
