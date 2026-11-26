import { homedir } from "node:os";
import { join } from "node:path";

import { defaultEnvPath, loadDefaultEnv } from "./env-loader.mjs";

// Load ~/.config/ego-browser/env (or $XDG_CONFIG_HOME/ego-browser/env) before
// resolving profile/state directories so non-interactive agent shells pick up
// configured paths and CDP endpoints without overriding explicit env vars.
loadDefaultEnv();

const HOME = homedir();

export const CONFIG_DIR = join(
  process.env.XDG_CONFIG_HOME || join(HOME, ".config"),
  "ego-browser",
);
export const DEFAULT_ENV_FILE = defaultEnvPath();

/** Persistent browser profile — the Linux stand-in for the ego lite app's profile. */
export const DATA_DIR = join(
  process.env.XDG_DATA_HOME || join(HOME, ".local", "share"),
  "ego-lite-linux",
);

/** Runtime state shared across heredoc invocations (each run is its own process). */
export const STATE_DIR = join(
  process.env.XDG_STATE_HOME || join(HOME, ".local", "state"),
  "ego-lite-linux",
);

export const PROFILE_DIR = process.env.EGO_LINUX_PROFILE || join(DATA_DIR, "profile");
export const BROWSER_STATE_FILE = join(STATE_DIR, "browser.json");
export const SPACES_STATE_FILE = join(STATE_DIR, "spaces-server.json");
export const TASK_SPACE_FILE = join(STATE_DIR, "task-spaces.json");

/** Where a stock Chrome keeps the profile we can import logins from. */
export const CHROME_CONFIG_CANDIDATES = [
  join(HOME, ".config", "google-chrome"),
  join(HOME, ".config", "chromium"),
  join(HOME, ".config", "microsoft-edge"),
  join(HOME, ".config", "BraveSoftware", "Brave-Browser"),
];
