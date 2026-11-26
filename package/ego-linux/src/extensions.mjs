import { extensionsDir, loadPlugins } from "./plugins.mjs";

export { extensionsDir };

/**
 * Backward-compatible loader for `~/.config/ego-browser/extensions/*.mjs`.
 * Delegates to the unified plugin system in `plugins.mjs`.
 */
export async function loadUserExtensions({
  dir = extensionsDir(),
  target = globalThis,
} = {}) {
  if (!dir) return {};
  const registry = await loadPlugins({
    dirs: [dir],
    extraPaths: [],
    includeEnv: false,
    allowSubdirs: false,
    target,
  });
  return registry.helpers;
}
