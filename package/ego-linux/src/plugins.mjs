import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CONFIG_DIR } from "./paths.mjs";

const SKIP_EXPORT_KEYS = new Set(["default", "plugin", "helpers", "workflows"]);
const KNOWN_SDK_HELPERS = [
  "taskSpace",
  "profiles",
  "listTaskSpaces",
  "claimTaskSpace",
  "takeOverTaskSpace",
  "cdp",
  "js",
  "help",
  "runSiteTool",
  "runSiteBrowserTool",
  "learnContext",
  "cliLog",
];

let importSeq = 0;

export function pluginsDir() {
  return process.env.EGO_BROWSER_PLUGINS_DIR || join(CONFIG_DIR, "plugins");
}

export function extensionsDir() {
  return process.env.EGO_BROWSER_EXTENSIONS_DIR || join(CONFIG_DIR, "extensions");
}

export function envPluginPaths() {
  const raw = process.env.EGO_BROWSER_PLUGINS || "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPluginScriptName(name) {
  return name.endsWith(".mjs") || name.endsWith(".js");
}

function shouldIgnoreName(name) {
  return !name || name.startsWith(".") || name.startsWith("_");
}

function findDirIndex(dirPath) {
  for (const candidate of ["index.mjs", "index.js"]) {
    const full = join(dirPath, candidate);
    if (existsSync(full)) {
      try {
        if (statSync(full).isFile()) return full;
      } catch {
        // Ignore broken symlink or inaccessible entry.
      }
    }
  }
  return null;
}

function scanDirectory(dirPath, { allowSubdirs = true } = {}) {
  const found = [];
  if (!dirPath || !existsSync(dirPath)) return found;

  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (shouldIgnoreName(entry.name)) continue;
    const fullPath = join(dirPath, entry.name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isFile() && isPluginScriptName(entry.name)) {
      found.push({
        filePath: resolve(fullPath),
        defaultName: entry.name.replace(/\.(mjs|js)$/i, ""),
      });
    } else if (allowSubdirs && stats.isDirectory()) {
      const indexPath = findDirIndex(fullPath);
      if (indexPath) {
        found.push({
          filePath: resolve(indexPath),
          defaultName: entry.name,
        });
      }
    }
  }

  return found;
}

/**
 * Discover plugin entry files from directories (`plugins/`, `extensions/`) and
 * explicit paths (`EGO_BROWSER_PLUGINS`, CLI `--plugin <path>`).
 */
export function discoverPluginFiles({
  dirs = [pluginsDir(), extensionsDir()],
  extraPaths = [],
  includeEnv = true,
  allowSubdirs = true,
} = {}) {
  const seen = new Set();
  const discovered = [];

  const pushUnique = (item) => {
    const key = resolve(item.filePath);
    if (seen.has(key)) return;
    seen.add(key);
    discovered.push({ ...item, filePath: key });
  };

  for (const dir of dirs || []) {
    for (const item of scanDirectory(dir, { allowSubdirs })) {
      pushUnique(item);
    }
  }

  const explicit = [
    ...(includeEnv ? envPluginPaths() : []),
    ...(Array.isArray(extraPaths) ? extraPaths : []),
  ];

  for (const rawPath of explicit) {
    if (!rawPath || typeof rawPath !== "string") continue;
    const resolvedPath = resolve(rawPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Plugin path not found: ${rawPath} (resolved: ${resolvedPath})`);
    }
    const stats = statSync(resolvedPath);
    if (stats.isFile()) {
      const base = basename(resolvedPath);
      const defaultName =
        base === "index.mjs" || base === "index.js"
          ? basename(dirname(resolvedPath))
          : base.replace(/\.(mjs|js)$/i, "");
      pushUnique({ filePath: resolvedPath, defaultName });
    } else if (stats.isDirectory()) {
      const indexPath = findDirIndex(resolvedPath);
      if (indexPath) {
        pushUnique({ filePath: indexPath, defaultName: basename(resolvedPath) });
      } else {
        for (const item of scanDirectory(resolvedPath, { allowSubdirs })) {
          pushUnique(item);
        }
      }
    }
  }

  return discovered;
}

function normalizePluginModule(mod, { filePath, defaultName }) {
  const defFromDefault = isPlainObject(mod.default) ? mod.default : null;
  const defFromNamed = isPlainObject(mod.plugin) ? mod.plugin : null;
  const def =
    defFromDefault || defFromNamed
      ? { ...(defFromDefault || {}), ...(defFromNamed || {}) }
      : null;

  const name =
    typeof def?.name === "string" && def.name.trim()
      ? def.name.trim()
      : defaultName;
  const version =
    typeof def?.version === "string" && def.version.trim()
      ? def.version.trim()
      : null;
  const description =
    typeof def?.description === "string" ? def.description.trim() : "";

  const workflows = {};
  const addWorkflows = (source) => {
    if (!isPlainObject(source)) return;
    for (const [key, value] of Object.entries(source)) {
      if (!key || key.startsWith("_") || typeof value !== "function") continue;
      workflows[key] = value;
    }
  };

  addWorkflows(def?.workflows);
  addWorkflows(mod.workflows);

  const helpers = {};
  const addHelpers = (source) => {
    if (!isPlainObject(source)) return;
    for (const [key, value] of Object.entries(source)) {
      if (!key || key.startsWith("_")) continue;
      helpers[key] = value;
    }
  };

  addHelpers(def?.helpers);
  addHelpers(mod.helpers);

  for (const [key, value] of Object.entries(mod)) {
    if (SKIP_EXPORT_KEYS.has(key) || key.startsWith("_") || key in workflows) continue;
    helpers[key] = value;
  }

  return {
    name,
    version,
    description,
    source: filePath,
    helpers,
    workflows,
  };
}

function formatLogArg(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveTargetSpec(spec, byName) {
  const trimmed = typeof spec === "string" ? spec.trim() : "";
  if (!trimmed) {
    return { error: "Workflow target must be a non-empty string (<plugin>[.<workflow>])" };
  }

  if (byName.has(trimmed)) {
    return { plugin: byName.get(trimmed), pluginName: trimmed, workflowName: null };
  }

  // Try matching `<plugin>:<workflow>` or `<plugin>.<workflow>` against registered names first.
  for (const sep of [":", "."]) {
    let idx = trimmed.indexOf(sep);
    while (idx > 0) {
      const candidatePlugin = trimmed.slice(0, idx);
      const candidateWorkflow = trimmed.slice(idx + 1);
      if (candidateWorkflow && byName.has(candidatePlugin)) {
        return {
          plugin: byName.get(candidatePlugin),
          pluginName: candidatePlugin,
          workflowName: candidateWorkflow,
        };
      }
      idx = trimmed.indexOf(sep, idx + 1);
    }
  }

  const colonIdx = trimmed.indexOf(":");
  const dotIdx = trimmed.indexOf(".");
  const sepIdx =
    colonIdx > 0 && dotIdx > 0
      ? Math.min(colonIdx, dotIdx)
      : Math.max(colonIdx, dotIdx);

  if (sepIdx > 0) {
    return {
      plugin: null,
      pluginName: trimmed.slice(0, sepIdx),
      workflowName: trimmed.slice(sepIdx + 1) || null,
      error: `Plugin "${trimmed.slice(0, sepIdx)}" not found`,
    };
  }

  return {
    plugin: null,
    pluginName: trimmed,
    workflowName: null,
    error: `Plugin "${trimmed}" not found`,
  };
}

function collectSdkHelpers(target) {
  const collected = {};
  if (!target || typeof target !== "object") return collected;

  if (isPlainObject(target.ego?.helpers)) {
    for (const [key, value] of Object.entries(target.ego.helpers)) {
      if (typeof value === "function") collected[key] = value;
    }
  }

  for (const key of KNOWN_SDK_HELPERS) {
    if (typeof target[key] === "function" && !(key in collected)) {
      collected[key] = target[key];
    }
  }

  if (target !== globalThis) {
    for (const [key, value] of Object.entries(target)) {
      if (key === "ego" || key === "plugins") continue;
      if (typeof value === "function" && !(key in collected)) {
        collected[key] = value;
      }
    }
  }

  return collected;
}

/**
 * Discover and load plugins & extensions, inject helpers onto `target` without
 * clobbering builtins, and expose the `plugins` runtime (`list`, `get`, `run`).
 */
export async function loadPlugins({
  dirs = [pluginsDir(), extensionsDir()],
  extraPaths = [],
  includeEnv = true,
  allowSubdirs = true,
  target = globalThis,
} = {}) {
  const discovered = discoverPluginFiles({
    dirs,
    extraPaths,
    includeEnv,
    allowSubdirs,
  });

  const byName = new Map();
  const allHelpers = {};

  for (const item of discovered) {
    importSeq += 1;
    const mod = await import(`${pathToFileURL(item.filePath).href}?t=${Date.now()}-${importSeq}`);
    const record = normalizePluginModule(mod, item);
    byName.set(record.name, record);

    for (const [helperName, helperValue] of Object.entries(record.helpers)) {
      allHelpers[helperName] = helperValue;
      if (target && !(helperName in target)) {
        Object.defineProperty(target, helperName, {
          value: helperValue,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }
    }
  }

  const api = {
    helpers: allHelpers,

    list() {
      return [...byName.values()].map((record) => ({
        name: record.name,
        version: record.version,
        description: record.description,
        source: record.source,
        helpers: Object.keys(record.helpers),
        workflows: Object.keys(record.workflows),
      }));
    },

    get(name) {
      if (typeof name !== "string") return null;
      const record = byName.get(name);
      if (!record) return null;
      return {
        name: record.name,
        version: record.version,
        description: record.description,
        source: record.source,
        helpers: { ...record.helpers },
        workflows: { ...record.workflows },
      };
    },

    async run(targetSpec, options = {}) {
      const startedAt = Date.now();
      const opts = isPlainObject(options) ? options : {};
      const stderr = opts.stderr || process.stderr;

      const resolved = resolveTargetSpec(targetSpec, byName);
      if (!resolved.plugin) {
        return {
          ok: false,
          plugin: resolved.pluginName ?? null,
          workflow: resolved.workflowName ?? null,
          durationMs: Date.now() - startedAt,
          error: resolved.error || `Plugin not found: ${targetSpec}`,
          stack: undefined,
        };
      }

      const plugin = resolved.plugin;
      let workflowName = resolved.workflowName;

      if (!workflowName) {
        const names = Object.keys(plugin.workflows);
        if (typeof plugin.workflows.default === "function") {
          workflowName = "default";
        } else if (names.length === 1) {
          workflowName = names[0];
        } else if (names.length === 0) {
          return {
            ok: false,
            plugin: plugin.name,
            workflow: null,
            durationMs: Date.now() - startedAt,
            error: `Plugin "${plugin.name}" defines no workflows`,
            stack: undefined,
          };
        } else {
          return {
            ok: false,
            plugin: plugin.name,
            workflow: null,
            durationMs: Date.now() - startedAt,
            error: `Plugin "${plugin.name}" has multiple workflows (${names.join(", ")}); specify "${plugin.name}.<workflow>"`,
            stack: undefined,
          };
        }
      }

      const workflowFn = plugin.workflows[workflowName];
      if (typeof workflowFn !== "function") {
        const available = Object.keys(plugin.workflows);
        return {
          ok: false,
          plugin: plugin.name,
          workflow: workflowName,
          durationMs: Date.now() - startedAt,
          error: `Workflow "${workflowName}" not found on plugin "${plugin.name}"${
            available.length ? ` (available: ${available.join(", ")})` : ""
          }`,
          stack: undefined,
        };
      }

      const sdkHelpers = collectSdkHelpers(target);
      const log = (...args) => {
        const line = `[${new Date().toISOString()}] [${plugin.name}.${workflowName}] ${args
          .map(formatLogArg)
          .join(" ")}\n`;
        stderr.write(line);
      };
      const consoleUrl = (spaceId) =>
        typeof target?.ego?.consoleUrl === "function"
          ? target.ego.consoleUrl(spaceId)
          : null;

      const ctx = {
        ...sdkHelpers,
        ...allHelpers,
        ...plugin.helpers,
        ego: target?.ego ?? null,
        plugins: api,
        consoleUrl,
        log,
        async withSpace(name, spaceOptsOrFn, maybeFn) {
          let spaceOpts = {};
          let fn = maybeFn;
          if (typeof spaceOptsOrFn === "function") {
            fn = spaceOptsOrFn;
          } else if (isPlainObject(spaceOptsOrFn)) {
            spaceOpts = spaceOptsOrFn;
          }
          if (typeof fn !== "function") {
            throw new TypeError("withSpace requires a callback function");
          }
          const createSpace = ctx.taskSpace || target?.taskSpace;
          if (typeof createSpace !== "function") {
            throw new Error("taskSpace helper is not installed on runtime target");
          }

          const profileId = spaceOpts.profileId ?? opts.profileId ?? "isolated";
          const keepOpen = Boolean(spaceOpts.keepOpen ?? opts.keepOpen ?? false);
          const task = await createSpace(name, { profileId });
          const spaceId = task?.spaceId ?? task?.id;
          const liveUrl = consoleUrl(spaceId);
          if (liveUrl) {
            log(`space "${name}" (#${spaceId}, profile=${profileId}) console: ${liveUrl}`);
          } else {
            log(`space "${name}" (#${spaceId}, profile=${profileId}) started`);
          }

          let page = null;
          if (spaceOpts.pageLabel && typeof task?.page === "function") {
            page = task.page(spaceOpts.pageLabel);
          } else if (typeof task?.pages === "function") {
            const managed = await task.pages();
            page = managed?.[0] ?? null;
          }
          if (!page && typeof task?.page === "function") {
            page = task.page("p1");
          }

          try {
            return await fn(task, page);
          } finally {
            if (!keepOpen && typeof task?.finish === "function") {
              await task.finish({ keep: [] }).catch(() => {});
            }
          }
        },
      };

      try {
        const result = await workflowFn(ctx, opts);
        return {
          ok: true,
          plugin: plugin.name,
          workflow: workflowName,
          durationMs: Date.now() - startedAt,
          result,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
          ok: false,
          plugin: plugin.name,
          workflow: workflowName,
          durationMs: Date.now() - startedAt,
          error: err.message,
          stack: err.stack,
        };
      }
    },
  };

  if (target && typeof target === "object") {
    Object.defineProperty(target, "plugins", {
      value: api,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    if (target.ego && typeof target.ego === "object") {
      target.ego.plugins = api;
      target.ego.extensions = {
        ...(isPlainObject(target.ego.extensions) ? target.ego.extensions : {}),
        ...allHelpers,
      };
    }
  }

  return api;
}
