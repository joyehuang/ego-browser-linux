import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadUserExtensions } from "../src/extensions.mjs";
import { discoverPluginFiles, loadPlugins } from "../src/plugins.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const CLI_BIN = resolve(__dirname, "../bin/ego-browser.mjs");
const SMOKE_DEMO_PATH = resolve(REPO_ROOT, "examples/plugins/e2e-smoke-demo.mjs");

const SANDBOX = mkdtempSync(join(tmpdir(), "ego-plugins-test-"));
after(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
});

function createFakeRuntime({ pageTitle = "Example Domain", pageSnapshot = "root\n  heading \"Example Domain\"" } = {}) {
  const createdSpaces = [];
  const finishedSpaces = [];
  let nextId = 10;

  const target = {
    existingBuiltin: () => "original-builtin",
    ego: {
      consoleUrl: (id) => `http://127.0.0.1:6080/?space=${id}`,
      helpers: {},
    },
  };

  async function taskSpace(name, opts = {}) {
    const id = nextId++;
    const record = { id, name, opts, visited: [] };
    createdSpaces.push(record);
    const makePage = (label) => ({
      label,
      async goto(url) {
        record.visited.push(url);
        record.lastUrl = url;
      },
      async snapshot() {
        return pageSnapshot;
      },
      async title() {
        return pageTitle;
      },
      async url() {
        return record.lastUrl || "about:blank";
      },
    });
    const p1 = makePage("p1");
    return {
      id,
      spaceId: id,
      name,
      async pages() {
        return [p1];
      },
      page(label) {
        return makePage(label);
      },
      async finish(finishOpts) {
        finishedSpaces.push({ id, finishOpts });
        return { closedSpace: true };
      },
    };
  }

  target.taskSpace = taskSpace;
  target.ego.helpers.taskSpace = taskSpace;

  return { target, createdSpaces, finishedSpaces };
}

describe("plugin and E2E workflow system", () => {
  it("discovers single files, subdir index.mjs, extensions/, extraPaths, and ignores _ / . prefixes", async () => {
    const pluginsDir = join(SANDBOX, "disc-plugins");
    const extDir = join(SANDBOX, "disc-ext");
    const subDir = join(pluginsDir, "folder-plugin");
    const ignoredDir = join(pluginsDir, "_disabled-plugin");
    mkdirSync(subDir, { recursive: true });
    mkdirSync(ignoredDir, { recursive: true });
    mkdirSync(extDir, { recursive: true });

    writeFileSync(
      join(pluginsDir, "alpha.mjs"),
      `export default {
        name: "alpha",
        version: "1.2.3",
        description: "Alpha plugin",
        helpers: {
          alphaHelper: (x) => "alpha:" + x,
          existingBuiltin: () => "should-not-clobber",
        },
        workflows: {
          ping: async (ctx, opts) => ({ pong: opts.msg || "hi", h: ctx.alphaHelper("ok") }),
        },
      };\n`,
    );
    writeFileSync(
      join(pluginsDir, "_ignored.mjs"),
      `export function hiddenHelper() { return 1; }\n`,
    );
    writeFileSync(
      join(pluginsDir, ".dotfile.mjs"),
      `export function dotHelper() { return 2; }\n`,
    );
    writeFileSync(
      join(subDir, "index.mjs"),
      `export const plugin = { name: "folder-plug", version: "0.2.0", description: "Folder plugin" };
       export const helpers = { folderHelper: () => "from-folder" };
       export const workflows = {
         default: async (ctx) => ({ ok: ctx.folderHelper() }),
         second: async () => ({ step: 2 }),
       };\n`,
    );
    writeFileSync(
      join(ignoredDir, "index.mjs"),
      `export default { name: "should-not-load" };\n`,
    );
    writeFileSync(
      join(extDir, "legacy.mjs"),
      `export function legacyGreet(name) { return "hello " + name; }
       export const _secret = "skip";\n`,
    );

    const discovered = discoverPluginFiles({
      dirs: [pluginsDir, extDir],
      extraPaths: [SMOKE_DEMO_PATH],
      includeEnv: false,
    });
    const paths = discovered.map((d) => d.filePath);
    assert.ok(paths.includes(join(pluginsDir, "alpha.mjs")));
    assert.ok(paths.includes(join(subDir, "index.mjs")));
    assert.ok(paths.includes(join(extDir, "legacy.mjs")));
    assert.ok(paths.includes(SMOKE_DEMO_PATH));
    assert.ok(!paths.some((p) => p.includes("_ignored") || p.includes(".dotfile") || p.includes("_disabled")));

    const { target } = createFakeRuntime();
    const registry = await loadPlugins({
      dirs: [pluginsDir, extDir],
      extraPaths: [SMOKE_DEMO_PATH],
      includeEnv: false,
      target,
    });

    // Helper injection without clobbering builtins
    assert.equal(target.alphaHelper("x"), "alpha:x");
    assert.equal(target.folderHelper(), "from-folder");
    assert.equal(target.legacyGreet("world"), "hello world");
    assert.equal(target._secret, undefined);
    assert.equal(target.existingBuiltin(), "original-builtin");
    assert.equal(target.plugins, registry);
    assert.equal(target.ego.plugins, registry);
    assert.equal(typeof target.ego.extensions.legacyGreet, "function");

    const list = registry.list();
    assert.deepEqual(
      list.map((p) => p.name),
      ["alpha", "folder-plug", "legacy", "smoke-demo"],
    );
    assert.equal(registry.get("alpha").version, "1.2.3");
    assert.equal(registry.get("missing"), null);

    // Shorthand single-workflow and default-workflow resolution
    const r1 = await registry.run("alpha", { msg: "test" });
    assert.equal(r1.ok, true);
    assert.equal(r1.plugin, "alpha");
    assert.equal(r1.workflow, "ping");
    assert.deepEqual(r1.result, { pong: "test", h: "alpha:ok" });

    const r2 = await registry.run("folder-plug");
    assert.equal(r2.ok, true);
    assert.equal(r2.workflow, "default");
    assert.deepEqual(r2.result, { ok: "from-folder" });

    const r3 = await registry.run("folder-plug:second");
    assert.equal(r3.ok, true);
    assert.equal(r3.workflow, "second");
    assert.deepEqual(r3.result, { step: 2 });
  });

  it("keeps loadUserExtensions backward-compatible", async () => {
    const extDir = join(SANDBOX, "compat-ext");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(extDir, "tools.mjs"),
      `export function doubleNum(n) { return n * 2; }\nexport const _priv = true;\n`,
    );
    writeFileSync(
      join(extDir, "_skip.mjs"),
      `export function nope() { return 0; }\n`,
    );
    const scope = { ego: {} };
    const loaded = await loadUserExtensions({ dir: extDir, target: scope });
    assert.equal(scope.doubleNum(21), 42);
    assert.equal(loaded.doubleNum(5), 10);
    assert.equal(scope._priv, undefined);
    assert.equal(scope.nope, undefined);
    assert.equal(scope.ego.extensions.doubleNum(3), 6);
  });

  it("runs smoke-demo workflow with isolated profile, logs console URL to stderr, and handles cleanup vs keepOpen", async () => {
    const stderrLines = [];
    const fakeStderr = { write: (s) => stderrLines.push(s) };

    const rt1 = createFakeRuntime();
    const reg1 = await loadPlugins({
      dirs: [],
      extraPaths: [SMOKE_DEMO_PATH],
      includeEnv: false,
      target: rt1.target,
    });

    const okRes = await reg1.run("smoke-demo.checkPage", {
      url: "https://example.com/check",
      expect: "Example Domain",
      stderr: fakeStderr,
    });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.plugin, "smoke-demo");
    assert.equal(okRes.workflow, "checkPage");
    assert.equal(typeof okRes.durationMs, "number");
    assert.deepEqual(okRes.result, {
      url: "https://example.com/check",
      title: "Example Domain",
      matched: true,
      spaceId: 10,
    });
    assert.equal(rt1.createdSpaces[0].opts.profileId, "isolated");
    assert.equal(rt1.finishedSpaces.length, 1);
    assert.deepEqual(rt1.finishedSpaces[0].finishOpts, { keep: [] });
    assert.ok(stderrLines.some((line) => line.includes("http://127.0.0.1:6080/?space=10")));

    // keepOpen: true skips finish()
    const rt2 = createFakeRuntime();
    const reg2 = await loadPlugins({
      dirs: [],
      extraPaths: [SMOKE_DEMO_PATH],
      includeEnv: false,
      target: rt2.target,
    });
    const keptRes = await reg2.run("smoke-demo", {
      keepOpen: true,
      profileId: "isolated-seeded",
      stderr: fakeStderr,
    });
    assert.equal(keptRes.ok, true);
    assert.equal(rt2.createdSpaces[0].opts.profileId, "isolated-seeded");
    assert.equal(rt2.finishedSpaces.length, 0);

    // Failing workflow returns structured { ok: false, error, stack } and still cleans up space
    const rt3 = createFakeRuntime({ pageTitle: "Wrong Title", pageSnapshot: "root\n  text \"Other\"" });
    const reg3 = await loadPlugins({
      dirs: [],
      extraPaths: [SMOKE_DEMO_PATH],
      includeEnv: false,
      target: rt3.target,
    });
    const failRes = await reg3.run("smoke-demo.checkPage", {
      expect: "Must Exist",
      stderr: fakeStderr,
    });
    assert.equal(failRes.ok, false);
    assert.equal(failRes.plugin, "smoke-demo");
    assert.equal(failRes.workflow, "checkPage");
    assert.match(failRes.error, /Must Exist/);
    assert.ok(typeof failRes.stack === "string" && failRes.stack.length > 0);
    assert.equal(rt3.finishedSpaces.length, 1);

    // 2-arg withSpace(name, fn) defaults profileId to "isolated"
    const twoArgFile = join(SANDBOX, "two-arg.mjs");
    writeFileSync(
      twoArgFile,
      `export default {
        name: "two-arg",
        workflows: {
          go: (ctx) => ctx.withSpace("quick", async (task, page) => ({ id: task.id, label: page.label })),
        },
      };\n`,
    );
    const rt4 = createFakeRuntime();
    const reg4 = await loadPlugins({
      dirs: [],
      extraPaths: [twoArgFile],
      includeEnv: false,
      target: rt4.target,
    });
    const twoArgRes = await reg4.run("two-arg.go", { stderr: fakeStderr });
    assert.equal(twoArgRes.ok, true);
    assert.equal(rt4.createdSpaces[0].opts.profileId, "isolated");
    assert.equal(rt4.finishedSpaces.length, 1);
  });

  it("handles CLI `ego-browser plugins --plugin ... --json` without Chrome", () => {
    const emptyDir = join(SANDBOX, "empty-cfg");
    mkdirSync(emptyDir, { recursive: true });
    const env = {
      ...process.env,
      EGO_BROWSER_PLUGINS_DIR: emptyDir,
      EGO_BROWSER_EXTENSIONS_DIR: emptyDir,
      EGO_BROWSER_PLUGINS: "",
    };

    const jsonOut = execFileSync(
      process.execPath,
      [CLI_BIN, "plugins", "--plugin", SMOKE_DEMO_PATH, "--json"],
      { encoding: "utf8", env },
    );
    const parsed = JSON.parse(jsonOut);
    assert.equal(Array.isArray(parsed.plugins), true);
    assert.equal(parsed.plugins.length, 1);
    assert.equal(parsed.plugins[0].name, "smoke-demo");
    assert.deepEqual(parsed.plugins[0].helpers, ["assertText"]);
    assert.deepEqual(parsed.plugins[0].workflows, ["checkPage"]);

    const tableOut = execFileSync(
      process.execPath,
      [CLI_BIN, "plugins", "--plugin", SMOKE_DEMO_PATH],
      { encoding: "utf8", env },
    );
    assert.match(tableOut, /PLUGIN/);
    assert.match(tableOut, /smoke-demo/);
    assert.match(tableOut, /checkPage/);
  });
});
