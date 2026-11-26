import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Default config file path for non-interactive agent shells:
 * $XDG_CONFIG_HOME/ego-browser/env (falling back to ~/.config/ego-browser/env).
 */
export function defaultEnvPath(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "ego-browser", "env");
}

/**
 * Parse KEY=VALUE lines from an env file. Supports `#` comments, blank lines,
 * optional `export ` prefixes, and matching single/double quotes.
 */
export function parseEnvContent(text) {
  const entries = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\");
    } else if (value.length >= 2 && value.startsWith("\x27") && value.endsWith("\x27")) {
      value = value.slice(1, -1);
    }
    entries.push([key, value]);
  }
  return entries;
}

/**
 * Populate `env` from the default env file without overriding variables that
 * are already present in `env`.
 */
export function loadDefaultEnv({ env = process.env, envFile } = {}) {
  const path = envFile || defaultEnvPath(env);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { loaded: false, path };
  }
  const applied = [];
  for (const [key, value] of parseEnvContent(text)) {
    if (!Object.hasOwn(env, key) || env[key] === undefined) {
      env[key] = value;
      applied.push(key);
    }
  }
  return { loaded: true, path, applied };
}
