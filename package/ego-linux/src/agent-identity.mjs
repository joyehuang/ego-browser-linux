import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const RUNTIME_MARKER = "/.config/cue/runtime/";

function profileFromEnvironment() {
  for (const value of Object.values(process.env)) {
    if (typeof value !== "string") continue;
    const at = value.indexOf(RUNTIME_MARKER);
    if (at === -1) continue;
    const rest = value.slice(at + RUNTIME_MARKER.length);
    const name = rest.split("/")[0];
    if (name) return name;
  }
  return null;
}

function profileFromPinFile(startDir) {
  let dir = startDir;
  for (let depth = 0; depth < 12; depth += 1) {
    const pin = join(dir, ".cue.profile");
    if (existsSync(pin)) {
      try {
        const name = readFileSync(pin, "utf8").trim();
        if (name) return name;
      } catch {
        // unreadable pin is the same as no pin
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function agentIdentity(cwd = process.cwd()) {
  if (process.env.EGO_LINUX_PANEL === "1") {
    return { profile: null, session: null };
  }
  const profile = profileFromEnvironment() || profileFromPinFile(cwd) || null;
  const session = process.env.CLAUDE_CODE_SESSION_ID || null;
  return {
    profile,
    session: session ? session.slice(0, 8) : null,
  };
}

/**
 * Best-effort agent host label (e.g. "Claude", "Pi", "Antigravity", "Codex")
 * stored on newly created TaskSpaces for display in the Web Console.
 */
export function agentHostLabel() {
  if (process.env.EGO_LINUX_PANEL === "1") return "User";
  if (process.env.EGO_AGENT_NAME) return process.env.EGO_AGENT_NAME.trim();
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_CONFIG_DIR) {
    return "Claude";
  }
  if (process.env.PI_CODING_AGENT || process.env.PI_SESSION || process.env.PI_AGENT_DIR) {
    return "Pi";
  }
  if (process.env.ANTIGRAVITY_AGENT || process.env.ANTIGRAVITY_CLI || process.env.AGY_ACCOUNT) {
    return "Antigravity";
  }
  if (process.env.CODEX_CI || process.env.CODEX_SANDBOX || process.env.CODEX_THREAD_ID) {
    return "Codex";
  }
  try {
    const comm = readFileSync(`/proc/${process.ppid}/comm`, "utf8").trim().toLowerCase();
    if (comm.includes("claude")) return "Claude";
    if (comm === "pi" || comm.includes("pi-")) return "Pi";
    if (comm.includes("agy") || comm.includes("antigravity")) return "Antigravity";
    if (comm.includes("codex")) return "Codex";
  } catch {
    // ignore non-Linux or inaccessible /proc
  }
  return process.env.EGO_LINUX_CURSOR_NAME || "Agent";
}
