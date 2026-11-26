#!/usr/bin/env node
/**
 * ego-browser, Linux edition.
 *
 * Same CLI shape as the macOS/Windows `ego-browser`: `ego-browser nodejs` (or
 * bare `ego-browser <<'JS'`) runs an agent script with every ego-browser helper
 * preloaded, `ego-browser skill` prints the versioned usage guide, and
 * `ego-browser plugins` / `ego-browser run` manage reusable E2E workflow plugins.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { browserStatus, stopBrowser } from "../src/chrome.mjs";
import { installDesktopEntry } from "../src/desktop.mjs";
import {
  CHROME_CONFIG_CANDIDATES,
  PROFILE_DIR,
  SPACES_STATE_FILE,
  TASK_SPACE_FILE,
  STATE_DIR,
} from "../src/paths.mjs";
import { loadPlugins, pluginsDir } from "../src/plugins.mjs";
import { createEgoShim } from "../src/shim.mjs";
import { startSpacesServer } from "../src/spaces-server.mjs";

const HARNESS = new URL("../../ego-browser/dist/out/index.js", import.meta.url);
const BUNDLED_SKILL_WORKSPACE = new URL(
  "../../ego-browser/dist/out/agent-skills/ego-browser",
  import.meta.url,
);
const SKILL_WORKSPACE = new URL("../../../skills/ego-browser", import.meta.url);

const USAGE = `ego-browser (Linux port)

  ego-browser nodejs <<'JS'
  const task = await taskSpace('demo')
  const page = task.page('p1')
  await page.goto('https://example.com')
  console.log(await page.snapshot())
  JS

Commands:
  nodejs [--plugin <path>]... [--sdk-path <path>] [-e <code>]
                            run an agent script (stdin or -e)
  skill  [--sdk-path <path>]
                            print the usage guide for this SDK
  plugins [--plugin <path>]... [--json]
                            list discovered plugins, helpers, and E2E workflows
  run <plugin>[.<workflow>] [--plugin <path>]... [--profile <id>] [--keep-open]
                            [--arg key=val]... [--json '<json>'] [--headless]
                            [--sdk-path <path>]
                            run a plugin E2E workflow and print JSON to stdout
  help                      show this help message
  (bare \`ego-browser <<'JS'\` is an alias for \`ego-browser nodejs\`)

Linux-only commands:
  --status                  show the backing browser's connection state
  --open                    open the shared agent browser window
  --console [--host <ip>] [--port <n>] [--vnc-upstream <host:port>]
                            serve unified TaskSpace + noVNC console (default :6080)
  --serve                   serve the Spaces overview panel in the foreground
  --spaces                  open the Spaces overview panel
  --prune-spaces            close spaces that hold nothing but about:blank
                            Set EGO_LINUX_SPACE_IDLE_MIN to change the idle
                            window (default 30, or 0 to sweep only by hand)
  --stop                    stop the backing browser
  --import-chrome-profile   copy your real Chrome profile in, to inherit logins
  --install-desktop-entry   add it to your app launcher, with an icon
  --headless                run the backing browser headless (first launch only)
                            EGO_LINUX_HEADLESS=1 makes that the default; --open
                            still gives you a visible one when you want it
`;

async function importChromeProfile() {
  const source = CHROME_CONFIG_CANDIDATES.find((candidate) =>
    existsSync(join(candidate, "Default")),
  );
  if (!source) {
    process.stderr.write("no Chrome/Chromium profile found to import\n");
    return 1;
  }
  const status = await browserStatus();
  if (status.running) {
    process.stderr.write(
      "the backing browser is running; run --stop and close it before importing\n",
    );
    return 1;
  }
  process.stderr.write(`importing ${join(source, "Default")} -> ${PROFILE_DIR}/Default\n`);
  await cp(join(source, "Default"), join(PROFILE_DIR, "Default"), {
    recursive: true,
    force: true,
  });
  process.stderr.write("done — logins and cookies now carry into agent tasks\n");
  return 0;
}

/** Is a Spaces server already listening on the recorded port? */
async function liveSpacesServer() {
  try {
    const state = JSON.parse(await readFile(SPACES_STATE_FILE, "utf8"));
    const response = await fetch(`http://127.0.0.1:${state.port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok ? state.port : null;
  } catch {
    return null;
  }
}

/** Open the panel as a chrome-less app window on the shared browser. */
async function openPanelWindow(url) {
  const status = await browserStatus();
  spawn(status.binary || "google-chrome", [`--user-data-dir=${PROFILE_DIR}`, `--app=${url}`], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

/**
 * Serve the Spaces panel in the foreground until signalled.
 */
async function serveSpacesForeground() {
  process.env.EGO_LINUX_PANEL = "1";
  const shim = await createEgoShim({ headless: false });
  const spaces = await startSpacesServer(shim);
  const url = `http://127.0.0.1:${spaces.port}/`;

  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    SPACES_STATE_FILE,
    JSON.stringify({ port: spaces.port, pid: process.pid }, null, 2),
  );

  process.stdout.write(`Spaces panel: ${url}\n`);

  await new Promise((resolveDone) => {
    const stop = () => resolveDone();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  spaces.close();
  shim.close();
  await rm(SPACES_STATE_FILE, { force: true });
  return 0;
}

/**
 * Serve the Spaces panel until the browser goes away.
 */
async function runSpacesDaemon() {
  process.env.EGO_LINUX_PANEL = "1";
  const shim = await createEgoShim({ headless: false });
  const spaces = await startSpacesServer(shim);
  const url = `http://127.0.0.1:${spaces.port}/`;

  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    SPACES_STATE_FILE,
    JSON.stringify({ port: spaces.port, pid: process.pid }, null, 2),
  );

  await openPanelWindow(url);

  const outcome = await new Promise((resolveDone) => {
    process.on("SIGINT", () => resolveDone("signal"));
    process.on("SIGTERM", () => resolveDone("signal"));

    let seenPanel = false;
    const started = Date.now();

    const timer = setInterval(async () => {
      let targetInfos;
      try {
        ({ targetInfos = [] } = await shim.cdp.call("Target.getTargets"));
      } catch {
        clearInterval(timer);
        resolveDone("browser-gone");
        return;
      }

      const open = targetInfos.some(
        (target) => target.type === "page" && String(target.url || "").startsWith(url),
      );
      if (open) {
        seenPanel = true;
        return;
      }
      if (seenPanel || Date.now() - started > 20000) {
        clearInterval(timer);
        resolveDone("panel-closed");
      }
    }, 2500);
  });

  spaces.close();
  shim.close();
  await rm(SPACES_STATE_FILE, { force: true });

  if (outcome === "browser-gone") {
    spawn(process.execPath, [fileURLToPath(import.meta.url), "--spaces-daemon"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
  return 0;
}

async function openSpaces() {
  const running = await liveSpacesServer();
  if (running) {
    await openPanelWindow(`http://127.0.0.1:${running}/`);
    process.stderr.write(`Spaces panel: http://127.0.0.1:${running}/\n`);
    return 0;
  }

  spawn(process.execPath, [fileURLToPath(import.meta.url), "--spaces-daemon"], {
    detached: true,
    stdio: "ignore",
  }).unref();

  let port = null;
  const deadline = Date.now() + 30000;
  while (!port && Date.now() < deadline) {
    await new Promise((resolveDone) => setTimeout(resolveDone, 400));
    port = await liveSpacesServer();
  }
  if (!port) {
    process.stderr.write("the Spaces server did not come up\n");
    return 1;
  }

  process.stderr.write(`Spaces panel: http://127.0.0.1:${port}/\n`);
  return 0;
}

/**
 * Sweep spaces that hold nothing but about:blank.
 */
async function pruneSpaces() {
  const status = await browserStatus();
  if (!status.running) {
    process.stdout.write("no backing browser is running; nothing to prune\n");
    return 0;
  }
  const shim = await createEgoShim({ headless: status.headless === true });
  try {
    const { taskSpaces = [] } = await shim.ego.listTaskSpaces();
    let selectedId = null;
    try {
      ({ selectedId = null } = JSON.parse(await readFile(TASK_SPACE_FILE, "utf8")));
    } catch {
      // No state file means no selection to protect.
    }
    const { targetInfos = [] } = await shim.cdp.call("Target.getTargets");
    const byTarget = new Map(targetInfos.map((target) => [target.targetId, target]));

    let closed = 0;
    for (const space of taskSpaces) {
      const tabs = (space.targetIds || []).map((id) => byTarget.get(id)).filter(Boolean);
      if (tabs.length === 0) continue;
      if (space.id === selectedId) continue;
      if (space.lastContentAt) continue;
      if (space.ownership !== "agent") continue;
      if (!tabs.every((target) => target.url === "about:blank")) continue;
      shim.ego.useTaskSpace(space.id);
      const res = await shim.ego.closeTaskSpace().catch(() => null);
      if (res && !res.error) closed += 1;
    }
    process.stdout.write(
      closed === 0
        ? "no empty spaces to close\n"
        : `closed ${closed} empty ${closed === 1 ? "space" : "spaces"}\n`,
    );
  } finally {
    shim.close();
  }
  return 0;
}

async function runConsoleForeground(args) {
  process.env.EGO_LINUX_PANEL = "1";
  let host = (process.env.EGO_CONSOLE_HOST || "").trim() || "127.0.0.1";
  let port = Number(process.env.EGO_CONSOLE_PORT || process.env.EGO_NOVNC_PORT || 6080);
  let vncUpstream = (process.env.EGO_VNC_UPSTREAM || "").trim() || "127.0.0.1:6081";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--host" && args[i + 1]) {
      host = args[++i];
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
    } else if (arg === "--port" && args[i + 1]) {
      port = Number(args[++i]);
    } else if (arg.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
    } else if (arg === "--vnc-upstream" && args[i + 1]) {
      vncUpstream = args[++i];
    } else if (arg.startsWith("--vnc-upstream=")) {
      vncUpstream = arg.slice("--vnc-upstream=".length);
    } else {
      process.stderr.write(`unknown --console option: ${arg}\n`);
      return 2;
    }
  }

  let initialShim = null;
  try {
    initialShim = await createEgoShim({ headless: false });
  } catch {
    // Allow console to start before Chrome finishes coming up; reconnect lazily.
  }

  const server = await startSpacesServer(initialShim, {
    host,
    port,
    vncUpstream,
    reconnect: () => createEgoShim({ headless: false }),
  });
  process.stdout.write(`ego-browser console listening on http://${host}:${server.port}/\n`);

  await new Promise((resolveDone) => {
    const stop = () => resolveDone();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  server.close();
  return 0;
}

function platformGuideFilename(platform = process.platform) {
  if (platform === "linux") return "SKILL.linux.md";
  if (platform === "darwin") return "SKILL.macos.md";
  if (platform === "win32") return "SKILL.windows.md";
  return "SKILL.md";
}

function ensureAgentWorkspaceEnv() {
  if (!process.env.EGO_BROWSER_AGENT_WORKSPACE) {
    const bundled = fileURLToPath(BUNDLED_SKILL_WORKSPACE);
    process.env.EGO_BROWSER_AGENT_WORKSPACE = existsSync(bundled)
      ? bundled
      : fileURLToPath(SKILL_WORKSPACE);
  }
}

async function runSkillCommand(args) {
  let sdkPathOverride = null;
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--sdk-path") {
      const next = args[i + 1];
      if (!next) {
        process.stderr.write("--sdk-path requires a path\n");
        return 2;
      }
      sdkPathOverride = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--sdk-path=")) {
      const next = arg.slice("--sdk-path=".length);
      if (!next) {
        process.stderr.write("--sdk-path requires a path\n");
        return 2;
      }
      sdkPathOverride = next;
      continue;
    }
    positional.push(arg);
  }

  if (positional.length > 0) {
    process.stderr.write(
      `Usage: ego-browser skill [--sdk-path <path>]\nUnexpected arguments: ${positional.join(" ")}\n`,
    );
    return 2;
  }

  const resolvedSdk = sdkPathOverride
    ? resolve(sdkPathOverride)
    : fileURLToPath(HARNESS);
  const guideDir = join(dirname(resolvedSdk), "ego-browser");
  const platformFile = join(guideDir, platformGuideFilename());
  const fallbackFile = join(guideDir, "SKILL.md");

  let guidePath = null;
  if (existsSync(platformFile)) {
    guidePath = platformFile;
  } else if (existsSync(fallbackFile)) {
    guidePath = fallbackFile;
  } else {
    process.stderr.write(
      `ego-browser skill guide not found. Checked:\n  ${platformFile}\n  ${fallbackFile}\n`,
    );
    return 1;
  }

  if (sdkPathOverride) {
    process.stdout.write(
      `[ego-browser:skill] source=sdk-path dir=${guideDir} (override, not the bundled guide)\n`,
    );
  }
  const content = await readFile(guidePath, "utf8");
  process.stdout.write(content);
  return 0;
}

function formatPluginsTable(list) {
  if (list.length === 0) {
    return `No plugins found.\nAdd plugins in ${pluginsDir()} or pass --plugin <path>.\n`;
  }
  const rows = list.map((p) => ({
    name: p.name,
    version: p.version || "-",
    helpers: p.helpers.length ? p.helpers.join(", ") : "-",
    workflows: p.workflows.length ? p.workflows.join(", ") : "-",
    description: p.description || p.source,
  }));
  const headers = {
    name: "PLUGIN",
    version: "VERSION",
    helpers: "HELPERS",
    workflows: "WORKFLOWS",
    description: "DESCRIPTION",
  };
  const cols = ["name", "version", "helpers", "workflows", "description"];
  const widths = Object.fromEntries(
    cols.map((col) => [
      col,
      Math.max(headers[col].length, ...rows.map((r) => r[col].length)),
    ]),
  );
  const fmt = (row) =>
    cols
      .map((col, idx) => (idx === cols.length - 1 ? row[col] : row[col].padEnd(widths[col])))
      .join("  ");
  return `${[fmt(headers), ...rows.map(fmt)].join("\n")}\n`;
}

async function runPluginsCommand(args) {
  const pluginPaths = [];
  let asJson = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      asJson = true;
      continue;
    }
    if (arg === "--plugin") {
      const next = args[i + 1];
      if (!next) {
        process.stderr.write("--plugin requires a path\n");
        return 2;
      }
      pluginPaths.push(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--plugin=")) {
      const next = arg.slice("--plugin=".length);
      if (!next) {
        process.stderr.write("--plugin requires a path\n");
        return 2;
      }
      pluginPaths.push(next);
      continue;
    }
    process.stderr.write(`Usage: ego-browser plugins [--plugin <path>]... [--json]\nUnknown argument: ${arg}\n`);
    return 2;
  }

  const registry = await loadPlugins({ extraPaths: pluginPaths, target: {} });
  const list = registry.list();
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ plugins: list }, null, 2)}\n`);
  } else {
    process.stdout.write(formatPluginsTable(list));
  }
  return 0;
}

function parseArgPair(raw, out) {
  const eq = raw.indexOf("=");
  if (eq === -1) {
    if (!raw.trim()) throw new Error("--arg requires key=val");
    out[raw.trim()] = true;
    return;
  }
  const key = raw.slice(0, eq).trim();
  const val = raw.slice(eq + 1);
  if (!key) throw new Error(`Invalid --arg pair: ${raw}`);
  out[key] = val;
}

async function runWorkflowCommand(args) {
  let headless = !["", "0", "false", "no"].includes(
    (process.env.EGO_LINUX_HEADLESS ?? "").toLowerCase(),
  );
  let harness = HARNESS.href;
  let profileId;
  let keepOpen = false;
  let jsonOpts = {};
  const cliArgs = {};
  const pluginPaths = [];
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--headless") {
      headless = true;
      continue;
    }
    if (arg === "--keep-open") {
      keepOpen = true;
      continue;
    }
    if (arg === "--plugin") {
      const next = args[i + 1];
      if (!next) {
        process.stderr.write("--plugin requires a path\n");
        return 2;
      }
      pluginPaths.push(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--plugin=")) {
      const next = arg.slice("--plugin=".length);
      if (!next) {
        process.stderr.write("--plugin requires a path\n");
        return 2;
      }
      pluginPaths.push(next);
      continue;
    }
    if (arg === "--profile") {
      const next = args[i + 1];
      if (!next) {
        process.stderr.write("--profile requires a profile id\n");
        return 2;
      }
      profileId = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      const next = arg.slice("--profile=".length);
      if (!next) {
        process.stderr.write("--profile requires a profile id\n");
        return 2;
      }
      profileId = next;
      continue;
    }
    if (arg === "--sdk-path") {
      const next = args[i + 1];
      if (!next) {
        process.stderr.write("--sdk-path requires a path\n");
        return 2;
      }
      harness = pathToFileURL(resolve(next)).href;
      i += 1;
      continue;
    }
    if (arg.startsWith("--sdk-path=")) {
      const next = arg.slice("--sdk-path=".length);
      if (!next) {
        process.stderr.write("--sdk-path requires a path\n");
        return 2;
      }
      harness = pathToFileURL(resolve(next)).href;
      continue;
    }
    if (arg === "--arg") {
      const next = args[i + 1];
      if (next === undefined) {
        process.stderr.write("--arg requires key=val\n");
        return 2;
      }
      try {
        parseArgPair(next, cliArgs);
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 2;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--arg=")) {
      try {
        parseArgPair(arg.slice("--arg=".length), cliArgs);
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 2;
      }
      continue;
    }
    if (arg === "--json" || arg.startsWith("--json=")) {
      const raw = arg === "--json" ? args[++i] : arg.slice("--json=".length);
      if (raw === undefined) {
        process.stderr.write("--json requires a JSON object string\n");
        return 2;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          process.stderr.write("--json value must be a JSON object\n");
          return 2;
        }
        jsonOpts = { ...jsonOpts, ...parsed };
      } catch (error) {
        process.stderr.write(`Invalid --json payload: ${error.message}\n`);
        return 2;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      process.stderr.write(`Unknown option for run: ${arg}\n`);
      return 2;
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    process.stderr.write(
      "Usage: ego-browser run <plugin>[.<workflow>] [--plugin <path>]... [--profile <id>] [--keep-open] [--arg key=val]... [--json '<json>'] [--headless] [--sdk-path <path>]\n",
    );
    return 2;
  }

  const targetSpec = positional[0];
  ensureAgentWorkspaceEnv();

  const shim = await createEgoShim({ headless });
  globalThis.ego = shim.ego;

  let disposeEgoSdk;
  try {
    const sdk = await import(harness);
    disposeEgoSdk = sdk.disposeEgoSdk;
    // Redirect SDK console/cliLog to stderr so stdout remains clean JSON.
    sdk.installEgoSdk?.(globalThis, {
      cliLog: (...parts) => {
        const line = parts
          .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
          .join(" ");
        process.stderr.write(`${line}\n`);
      },
    });
    await loadPlugins({ extraPaths: pluginPaths, target: globalThis });

    const runOptions = {
      ...jsonOpts,
      ...cliArgs,
      ...(profileId !== undefined ? { profileId } : {}),
      ...(keepOpen ? { keepOpen: true } : {}),
    };
    const res = await globalThis.plugins.run(targetSpec, runOptions);
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return res.ok ? 0 : 1;
  } finally {
    await disposeEgoSdk?.(globalThis).catch(() => {});
    shim.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (argv[0] === "skill") {
    return runSkillCommand(argv.slice(1));
  }

  if (argv[0] === "plugins") {
    return runPluginsCommand(argv.slice(1));
  }

  if (argv[0] === "run") {
    return runWorkflowCommand(argv.slice(1));
  }

  // `ego-browser nodejs ...` or bare `ego-browser <<'JS'`.
  const explicitNodejs = argv[0] === "nodejs";
  if (explicitNodejs) argv.shift();

  if (!explicitNodejs) {
    if (argv[0] === "--status") {
      process.stdout.write(`${JSON.stringify(await browserStatus(), null, 2)}\n`);
      return 0;
    }
    if (argv[0] === "--stop") {
      const external = Boolean(process.env.EGO_LINUX_CDP_URL);
      const stopped = await stopBrowser();
      if (!external) {
        process.stdout.write(
          stopped
            ? "backing browser stopped; the next run launches a fresh one\n"
            : "no backing browser was running; profile lock cleared\n",
        );
      }
      return 0;
    }
    if (argv[0] === "--import-chrome-profile") {
      return importChromeProfile();
    }
    if (argv[0] === "--prune-spaces") {
      return pruneSpaces();
    }
    if (argv[0] === "--console") {
      return runConsoleForeground(argv.slice(1));
    }
    if (argv[0] === "--serve") {
      return serveSpacesForeground();
    }
    if (argv[0] === "--spaces") {
      return openSpaces();
    }
    if (argv[0] === "--spaces-daemon") {
      return runSpacesDaemon();
    }
    if (argv[0] === "--install-desktop-entry") {
      const { entryPath, iconPath } = await installDesktopEntry();
      process.stdout.write(`installed ${entryPath}\n         ${iconPath}\n`);
      return 0;
    }
    if (argv[0] === "--open") {
      const status = await browserStatus();
      if (status.running && status.headless) {
        process.stderr.write("replacing the headless browser with a visible one\n");
        await stopBrowser();
      }
      const shim = await createEgoShim({ headless: false });
      try {
        const { targetInfos = [] } = await shim.cdp.call("Target.getTargets");
        const pages = targetInfos.filter(
          (t) => t.type === "page" && !String(t.url || "").startsWith("devtools://"),
        );
        let targetId = pages[0]?.targetId;
        if (!targetId) {
          ({ targetId } = await shim.cdp.call("Target.createTarget", { url: "about:blank" }));
        }
        await shim.cdp.call("Target.activateTarget", { targetId }).catch(() => {});
        const { sessionId } = await shim.cdp.call("Target.attachToTarget", {
          targetId,
          flatten: true,
        });
        await shim.cdp.call("Page.bringToFront", {}, sessionId).catch(() => {});
      } finally {
        shim.close();
      }
      return 0;
    }
  }

  let headless = !["", "0", "false", "no"].includes(
    (process.env.EGO_LINUX_HEADLESS ?? "").toLowerCase(),
  );
  let harness = HARNESS.href;
  let evalCode;
  const pluginPaths = [];
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--headless") {
      headless = true;
      continue;
    }
    if (arg === "--plugin") {
      const next = argv[i + 1];
      if (!next) {
        process.stderr.write("--plugin requires a path\n");
        return 2;
      }
      pluginPaths.push(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--plugin=")) {
      const next = arg.slice("--plugin=".length);
      if (!next) {
        process.stderr.write("--plugin requires a path\n");
        return 2;
      }
      pluginPaths.push(next);
      continue;
    }
    if (arg === "--sdk-path") {
      const path = argv[i + 1];
      if (!path) {
        process.stderr.write("--sdk-path requires a path\n");
        return 2;
      }
      harness = pathToFileURL(resolve(path)).href;
      i += 1;
      continue;
    }
    if (arg.startsWith("--sdk-path=")) {
      const path = arg.slice("--sdk-path=".length);
      if (!path) {
        process.stderr.write("--sdk-path requires a path\n");
        return 2;
      }
      harness = pathToFileURL(resolve(path)).href;
      continue;
    }
    if (arg === "-e" || arg === "--eval") {
      const code = argv[i + 1];
      if (code === undefined) {
        process.stderr.write(`${arg} requires code\n`);
        return 2;
      }
      evalCode = code;
      i += 1;
      continue;
    }
    if (arg.startsWith("-e=") || arg.startsWith("--eval=")) {
      evalCode = arg.slice(arg.indexOf("=") + 1);
      continue;
    }
    rest.push(arg);
  }

  ensureAgentWorkspaceEnv();

  const shim = await createEgoShim({ headless });
  globalThis.ego = shim.ego;

  const { runMain, disposeEgoSdk } = await import(harness);
  await loadPlugins({ extraPaths: pluginPaths, target: globalThis });
  try {
    return await runMain({
      argv: rest,
      ...(evalCode !== undefined ? { stdinText: evalCode } : {}),
    });
  } finally {
    await disposeEgoSdk?.(globalThis).catch(() => {});
    shim.close();
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
