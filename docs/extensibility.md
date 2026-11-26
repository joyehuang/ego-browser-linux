# Extending `ego-browser-linux`

`ego-browser-linux` is intentionally layered so you can add custom helpers, project-local E2E workflows, site learnings, and Linux host features **without creating painful merge conflicts against upstream `ego-lite`**.

---

## Part A: Architecture & Upstream Sync Boundaries

| Layer | Path | Purpose | Upstream Sync Policy |
| --- | --- | --- | --- |
| **Upstream SDK** | `package/ego-browser/` | Core v2 `TaskSpace` / `Page` model, snapshot compaction, element resolver, `help()`, guide renderer | Keep minimal Linux deltas (`xclip` clipboard + `linux` guide block) so rebasing/syncing with `citrolabs/ego-lite` stays trivial |
| **Linux Host Runtime** | `package/ego-linux/` | Chrome/CDP bridge, file-locked TaskSpaces, profile contexts, Unified Web Console, Plugin & Workflow runtime, CLI | Owned by `ego-browser-linux`; extend freely here |
| **Plugins & Workflows** | `~/.config/ego-browser/plugins/` or `--plugin <path>` | User helpers and repo-local E2E test workflows | Zero repo forks required; drop in or commit inside your app's own repo |
| **Site Learnings** | `skills/ego-browser/learnings/<site>/` | Reusable site-specific notes, Node tools, and browser tools | Validated by `npm run validate:site-skills` |

**Rule of thumb:**
- Need reusable assertions, auth helpers, or automated E2E suites for your app? Write a **Plugin** (Part B).
- Need site-specific scraping notes or selectors? Add a **Site Learning** (Part C).
- Need a new Linux host capability (Console UI, profile management, CLI subcommand)? Extend **`package/ego-linux/`** (Part D).
- Only touch **`package/ego-browser/`** when changing the cross-platform v2 SDK contract itself.

---

## Part B: Plugin & E2E Workflow System

Plugins let you register both **reusable script helpers** (auto-injected into `ego-browser nodejs`) and **structured E2E workflows** (runnable from the CLI via `ego-browser run`, CI pipelines, or AI agents).

### 1. Discovery Order & Layouts

`loadPlugins()` discovers plugins in deterministic order (later entries override earlier ones of the same `name`):

1. `~/.config/ego-browser/plugins/` (override via `EGO_BROWSER_PLUGINS_DIR`)
   - Single files: `*.mjs` or `*.js`
   - Folder plugins: `<subdir>/index.mjs` or `<subdir>/index.js`
   - Files and directories starting with `.` or `_` are ignored.
2. `~/.config/ego-browser/extensions/` (override via `EGO_BROWSER_EXTENSIONS_DIR`) — backward-compatible location for simple helper scripts.
3. `EGO_BROWSER_PLUGINS` environment variable — comma-separated list of explicit file or directory paths.
4. CLI `--plugin <path>` (repeatable) — ideal for keeping E2E plugins right inside your application's own repository (e.g. `./e2e/app.ego-plugin.mjs`).

### 2. Authoring a Helper Plugin

Simple helper module (`~/.config/ego-browser/plugins/table-helpers.mjs`):

```js
// Any top-level named export (except `plugin`, `helpers`, `workflows`, or `_`-prefixed)
// is automatically injected into `ego-browser nodejs` without clobbering builtins.
export async function extractTableRows(page, selector = "table tr") {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((tr) =>
      [...tr.querySelectorAll("th,td")].map((cell) => cell.innerText.trim()),
    );
  }, selector);
}
```

Use it directly in `ego-browser nodejs`:

```bash
ego-browser nodejs <<'JS'
const task = await taskSpace("scrape-table");
const page = task.page("p1");
await page.goto("https://example.com/report");
console.log(await extractTableRows(page));
await task.finish({ keep: [] });
JS
```

### 3. Authoring an E2E Workflow Plugin

Structured plugins export a `default` object (or named `plugin`, `helpers`, `workflows` exports):

```js
// ./e2e/checkout.ego-plugin.mjs
function assertText(haystack, needle, label = "page") {
  if (!String(haystack ?? "").includes(needle)) {
    throw new Error(`Expected ${label} to contain ${JSON.stringify(needle)}`);
  }
  return true;
}

export default {
  name: "checkout",
  version: "1.0.0",
  description: "Isolated checkout flow E2E checks",
  helpers: { assertText },
  workflows: {
    async smoke(ctx, opts = {}) {
      const baseUrl = opts.url || "http://127.0.0.1:3000";
      return ctx.withSpace(
        "checkout-smoke",
        { profileId: opts.profileId || "isolated", keepOpen: opts.keepOpen },
        async (task, page) => {
          ctx.log(`opening ${baseUrl}`);
          await page.goto(baseUrl);
          const snap = await page.snapshot();
          assertText(snap, opts.expect || "Checkout");
          return {
            spaceId: task.spaceId,
            url: await page.url(),
            title: await page.title(),
          };
        },
      );
    },
  },
};
```

#### Workflow `ctx` Reference

Every workflow function receives `(ctx, opts)`:

- **SDK & plugin helpers**: `ctx.taskSpace`, `ctx.profiles`, `ctx.cdp`, `ctx.js`, `ctx.ego`, `ctx.plugins`, plus all loaded plugin helpers.
- **`ctx.consoleUrl(spaceId)`**: returns the live Web Console URL for `spaceId` (respecting `EGO_CONSOLE_PUBLIC_URL` / `EGO_CONSOLE_PORT`).
- **`ctx.log(...args)`**: writes timestamped diagnostic lines to `stderr` so `stdout` stays pure JSON in `ego-browser run`.
- **`await ctx.withSpace(name, [spaceOpts], fn)`**:
  - Creates a TaskSpace defaulting to `{ profileId: "isolated" }` (overridable via `spaceOpts.profileId` or CLI `--profile`).
  - Logs the live Console URL to `stderr` so humans or agents can watch live in noVNC.
  - Invokes `await fn(task, page)` with the initial managed `Page` (`p1`).
  - Automatically cleans up via `await task.finish({ keep: [] })` in `finally` unless `keepOpen: true` (`--keep-open`) is set.

### 4. Inspecting & Running Workflows from the CLI

See the bundled runnable example at [examples/plugins/e2e-smoke-demo.mjs](../examples/plugins/e2e-smoke-demo.mjs):

```bash
# List discovered plugins (offline, does not require Chrome)
ego-browser plugins --plugin examples/plugins/e2e-smoke-demo.mjs
ego-browser plugins --plugin examples/plugins/e2e-smoke-demo.mjs --json

# Run an E2E workflow in an isolated profile; prints structured JSON to stdout
ego-browser run smoke-demo.checkPage \
  --plugin examples/plugins/e2e-smoke-demo.mjs \
  --arg url=https://example.com \
  --arg expect="Example Domain"

# Single-workflow shorthand + keep space open for visual inspection in Console
ego-browser run smoke-demo \
  --plugin examples/plugins/e2e-smoke-demo.mjs \
  --profile isolated \
  --keep-open

# Pass typed JSON arguments
ego-browser run checkout.smoke \
  --plugin ./e2e/checkout.ego-plugin.mjs \
  --json '{"url":"http://127.0.0.1:3000","retries":2}'
```

`ego-browser run` prints a structured JSON envelope to `stdout` and exits `0` on success or `1` on failure:

```json
{
  "ok": true,
  "plugin": "smoke-demo",
  "workflow": "checkPage",
  "durationMs": 842,
  "result": {
    "url": "https://example.com/",
    "title": "Example Domain",
    "matched": true,
    "spaceId": 12
  }
}
```

You can also invoke workflows programmatically inside `ego-browser nodejs`:

```js
const res = await plugins.run("smoke-demo.checkPage", { url: "https://example.com" });
console.log(res);
```

---

## Part C: Raw CDP & Site Learnings

### Raw Chrome DevTools Protocol (`page.cdp()`)

Anything Chromium exposes over CDP—PDF export, network interception, cookie inspection, coverage, emulation—is available directly via `page.cdp()`:

```js
const { data } = await page.cdp("Page.printToPDF", { printBackground: true });
const { cookies } = await page.cdp("Network.getAllCookies");
```

### Site Learnings (`skills/ego-browser/learnings/<site>/`)

Site-specific knowledge packs let agents skip DOM trial-and-error on recurring sites:

- `manifest.json`: domain matching rules + typed tool declarations
- `notes/*.md`: DOM quirks, lazy-loading patterns, durable selector hints
- `tools/*.js`: reusable Node-side helpers (`await runSiteTool("github", "...")`)
- `browser-tools/*.js`: in-page helpers (`await runSiteBrowserTool("github", "...")`)

Validate after editing learnings:

```bash
cd package/ego-browser
npm run validate:site-skills
```

---

## Part D: Extending `package/ego-linux` & Core SDK

1. **Linux runtime (`package/ego-linux/src/`)**:
   - Add native bindings in `shim.mjs`, TaskSpace/panel operations in `task-spaces.mjs`, Console endpoints/UI in `spaces-server.mjs` & `spaces-ui.mjs`, or CLI commands in `bin/ego-browser.mjs`.
   - Test with `node --test package/ego-linux/test/*.test.mjs`.
2. **Core v2 SDK (`package/ego-browser/src/`)**:
   - Register new methods & option schemas in `public-api-schema.ts`, implement in `page-model.ts` / `helpers.ts`, update `skill-body/SKILL.md` (staying under the 25,000-character rendered guide budget), and verify with:
     ```bash
     cd package/ego-browser && npm test
     ```
