import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX = await mkdtemp(join(tmpdir(), "ego-console-test-"));
process.env.XDG_STATE_HOME = join(SANDBOX, "state");
process.env.XDG_CONFIG_HOME = join(SANDBOX, "config");
process.env.EGO_LINUX_SPACE_IDLE_MIN = "0";
delete process.env.EGO_LINUX_CDP_URL;

const { listProfiles, resolveProfile } = await import("../src/profiles.mjs");
const { withFileLock, withFileLockSync } = await import("../src/state-lock.mjs");
const { loadUserExtensions } = await import("../src/extensions.mjs");
const { createTaskSpacesApi } = await import("../src/task-spaces.mjs");
const { startSpacesServer } = await import("../src/spaces-server.mjs");

after(async () => {
  await rm(SANDBOX, { recursive: true, force: true }).catch(() => {});
});

function rawHttpRequest({ port, method = "GET", path = "/", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("profiles, file locks, extensions & unified console", () => {
  it("lists built-in and custom profiles from profiles.json", async () => {
    const cfgDir = join(SANDBOX, "config", "ego-browser");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      join(cfgDir, "profiles.json"),
      JSON.stringify({
        profiles: [
          { id: "work", name: "Work Profile", kind: "isolated" },
          { id: "Default", name: "Should Not Override" },
        ],
      }),
    );

    const { profiles } = listProfiles();
    assert.deepEqual(
      profiles.map((p) => p.id),
      ["Default", "isolated", "isolated-seeded", "work"],
    );
    assert.equal(resolveProfile(undefined).id, "Default");
    assert.equal(resolveProfile("isolated").kind, "isolated");
    assert.equal(resolveProfile("isolated-seeded").kind, "isolated-seeded");
    assert.equal(resolveProfile("work").name, "Work Profile");
    assert.equal(resolveProfile("work").kind, "isolated");
    assert.equal(resolveProfile("nonexistent"), null);
  });

  it("creates clean isolated vs seeded contexts in taskSpaces", async () => {
    const calls = [];
    const targets = [];
    let nextTarget = 1;
    const cdp = {
      async call(method, params) {
        calls.push({ method, params });
        if (method === "Target.createBrowserContext") {
          return { browserContextId: `ctx-${calls.length}` };
        }
        if (method === "Storage.getCookies") {
          return { cookies: [{ name: "sid", value: "abc", domain: "example.com", path: "/" }] };
        }
        if (method === "Target.createTarget") {
          const id = `t-${nextTarget++}`;
          targets.push({ type: "page", targetId: id, url: "about:blank", browserContextId: params.browserContextId });
          return { targetId: id };
        }
        if (method === "Target.getTargets") return { targetInfos: targets };
        return {};
      },
    };
    const ts = createTaskSpacesApi(cdp);

    const iso = await ts.createTaskSpace("clean-e2e", "isolated");
    assert.equal(iso.profileId, "isolated");
    assert.equal(iso.profileKind, "isolated");
    assert.equal(
      calls.some((c) => c.method === "Storage.setCookies"),
      false,
      "isolated profile must not seed cookies from Default",
    );

    const seeded = await ts.createTaskSpace("seeded-e2e", "isolated-seeded");
    assert.equal(seeded.profileId, "isolated-seeded");
    assert.equal(seeded.profileKind, "isolated-seeded");
    assert.equal(
      calls.some((c) => c.method === "Storage.setCookies"),
      true,
      "isolated-seeded copies cookies into its BrowserContext",
    );
  });

  it("serializes file locks and breaks stale dead-PID locks", async () => {
    const lockPath = join(SANDBOX, "state.lock");
    const order = [];
    await Promise.all([
      withFileLock(lockPath, async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("a-end");
      }),
      withFileLock(lockPath, async () => {
        order.push("b-start");
        order.push("b-end");
      }),
    ]);
    assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);

    await writeFile(lockPath, JSON.stringify({ pid: 999999, createdAt: Date.now() - 60000 }));
    const res = withFileLockSync(lockPath, () => "ok", { staleMs: 1000 });
    assert.equal(res, "ok");
  });

  it("loads user extension modules and ignores underscore-prefixed files", async () => {
    const extDir = join(SANDBOX, "ext");
    await mkdir(extDir, { recursive: true });
    await writeFile(
      join(extDir, "helpers.mjs"),
      "export function greetTest(name) { return `hi:${name}`; }\nexport const _private = 1;\n",
    );
    await writeFile(
      join(extDir, "_ignored.mjs"),
      "export function shouldNotLoad() { return true; }\n",
    );
    const scope = { ego: {} };
    const loaded = await loadUserExtensions({ dir: extDir, target: scope });
    assert.equal(typeof scope.greetTest, "function");
    assert.equal(scope.greetTest("joye"), "hi:joye");
    assert.equal(scope._private, undefined);
    assert.equal(scope.shouldNotLoad, undefined);
    assert.equal(typeof loaded.greetTest, "function");
  });

  it("proxies /vnc/* HTTP + WebSocket, enforces token auth, origin & browser control APIs", async () => {
    // Fake upstream noVNC/websockify server
    const vncServer = createServer((req, res) => {
      if (req.url === "/vnc.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<h1>mock novnc</h1>");
        return;
      }
      res.writeHead(404);
      res.end("nope");
    });
    const vncSockets = new Set();
    vncServer.on("upgrade", (req, socket) => {
      vncSockets.add(socket);
      socket.on("close", () => vncSockets.delete(socket));
      socket.on("end", () => socket.end());
      socket.on("error", () => {});
      const accept = createHash("sha1")
        .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          `X-Upstream-Path: ${req.url}\r\n\r\n`,
      );
      socket.on("data", (chunk) => socket.write(chunk));
    });
    await new Promise((r) => vncServer.listen(0, "127.0.0.1", r));
    const vncPort = vncServer.address().port;

    const panelCalls = [];
    const fakeShim = {
      wsUrl: "ws://127.0.0.1:19222/devtools/browser/mock",
      cdp: {
        onShimEvent() {},
        async call(method) {
          if (method === "Browser.getVersion") return { product: "Chrome/158" };
          if (method === "Target.getTargets") return { targetInfos: [] };
          return {};
        },
      },
      ego: {
        listProfiles: () => listProfiles(),
        listTaskSpaces: async () => ({ taskSpaces: [] }),
      },
      panel: {
        listDetailed: async () => [
          {
            id: 7,
            name: "demo",
            ownership: "agent",
            profileId: "isolated",
            profileName: "Isolated",
            profileKind: "isolated",
            activeTargetId: "t-2",
            tabs: [
              { targetId: "t-1", title: "First", url: "https://first.example", active: false },
              { targetId: "t-2", title: "Second", url: "https://second.example", active: true },
            ],
          },
        ],
        createTab: async (id, url) => {
          panelCalls.push({ method: "createTab", id, url });
          return { targetId: "t-3", url: url || "about:blank" };
        },
        closeTab: async (id, targetId) => {
          panelCalls.push({ method: "closeTab", id, targetId });
          return { done: true, spaceClosed: false, activeTargetId: "t-1" };
        },
        navigate: async (id, opts) => {
          panelCalls.push({ method: "navigate", id, opts });
          return { done: true, url: opts.url || null };
        },
        sendKey: async (id, opts) => {
          panelCalls.push({ method: "sendKey", id, opts });
          return { done: true };
        },
      },
      close() {},
    };

    const consoleServer = await startSpacesServer(fakeShim, {
      host: "127.0.0.1",
      port: 0,
      vncUpstream: `127.0.0.1:${vncPort}`,
      token: "secret-token-123",
    });
    const base = `http://127.0.0.1:${consoleServer.port}`;

    try {
      // Unauthenticated API, VNC & new browser control endpoints rejected with 401
      for (const path of [
        "/api/profiles",
        "/vnc/vnc.html",
      ]) {
        const res = await fetch(`${base}${path}`);
        assert.equal(res.status, 401, `GET ${path} should require auth`);
        await res.text();
      }
      for (const [path, body] of [
        ["/api/spaces/7/tabs", { url: "https://example.com" }],
        ["/api/spaces/7/tabs/close", { targetId: "t-2" }],
        ["/api/spaces/7/navigate", { url: "https://example.com" }],
        ["/api/spaces/7/key", { key: "a", code: "KeyA", ctrl: true, command: "selectAll" }],
        ["/api/browser/reopen", {}],
      ]) {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        assert.equal(res.status, 401, `POST ${path} should require auth`);
        await res.text();
      }

      // Token query sets cookie (non-Secure on plain loopback) & redirects cleanly
      const bootstrap = await fetch(`${base}/?space=7&token=secret-token-123`, {
        redirect: "manual",
      });
      assert.equal(bootstrap.status, 302);
      assert.equal(bootstrap.headers.get("location"), "/?space=7");
      const setCookiePlain = bootstrap.headers.get("set-cookie");
      assert.doesNotMatch(setCookiePlain, /;\s*Secure/i);
      await bootstrap.text();
      const cookie = setCookiePlain.split(";")[0];

      // Reverse proxy with X-Forwarded-Proto: https sets ; Secure on cookie
      const proxiedBootstrap = await rawHttpRequest({
        port: consoleServer.port,
        path: "/?space=7&token=secret-token-123",
        headers: {
          host: "console.example.com",
          "x-forwarded-proto": "https",
        },
      });
      assert.equal(proxiedBootstrap.status, 302);
      const proxiedCookie = Array.isArray(proxiedBootstrap.headers["set-cookie"])
        ? proxiedBootstrap.headers["set-cookie"].join("; ")
        : String(proxiedBootstrap.headers["set-cookie"] || "");
      assert.match(proxiedCookie, /;\s*Secure/i);

      // Same-host Origin check (Tailscale / LAN direct access)
      const tailscaleSameOrigin = await rawHttpRequest({
        port: consoleServer.port,
        path: "/api/health",
        headers: {
          host: "100.64.0.10:6080",
          origin: "http://100.64.0.10:6080",
          cookie,
        },
      });
      assert.equal(tailscaleSameOrigin.status, 200);
      assert.deepEqual(JSON.parse(tailscaleSameOrigin.text), { ok: true });

      const tailscaleHttpsOrigin = await rawHttpRequest({
        port: consoleServer.port,
        path: "/api/health",
        headers: {
          host: "my-box.tailnet.ts.net",
          origin: "https://my-box.tailnet.ts.net",
          cookie,
        },
      });
      assert.equal(tailscaleHttpsOrigin.status, 200);

      const crossOrigin = await rawHttpRequest({
        port: consoleServer.port,
        path: "/api/health",
        headers: {
          host: "100.64.0.10:6080",
          origin: "https://evil.example",
          cookie,
        },
      });
      assert.equal(crossOrigin.status, 403);

      // Cookie authorizes Console HTML and exposes URL bar, Copy URL, + Tab & shortcuts
      const htmlRes = await fetch(`${base}/?space=7`, { headers: { cookie } });
      assert.equal(htmlRes.status, 200);
      const html = await htmlRes.text();
      assert.match(html, /ego-browser console/);
      assert.match(html, /id="url-bar"/);
      assert.match(html, /id="btn-copy-url"/);
      assert.match(html, /Copy URL/);
      assert.match(html, /id="btn-new-tab"/);
      assert.match(html, /\+ Tab/);
      assert.match(html, /function handleShortcut/);
      assert.match(html, /attachVncShortcuts/);
      assert.match(html, /execCommand\("copy"\)/);
      assert.match(html, /id="closed-overlay"/);
      assert.match(html, /id="btn-reopen-browser"/);
      assert.doesNotMatch(html, /id="new-name"[^>]*required/);

      // Ensure inline <script> parses cleanly as valid JS
      const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
      assert.ok(scriptMatch, "console HTML must include an inline script");
      assert.doesNotThrow(() => new Function(scriptMatch[1]), "inline console JS must parse cleanly");

      // GET /api/spaces surfaces the active tab's title, url & activeTargetId
      const spacesRes = await fetch(`${base}/api/spaces`, { headers: { cookie } });
      assert.equal(spacesRes.status, 200);
      const spacesJson = await spacesRes.json();
      assert.equal(spacesJson.spaces.length, 1);
      assert.equal(spacesJson.spaces[0].activeTargetId, "t-2");
      assert.equal(spacesJson.spaces[0].title, "Second");
      assert.equal(spacesJson.spaces[0].url, "https://second.example");

      // Authenticated browser control endpoints
      const createTabRes = await fetch(`${base}/api/spaces/7/tabs`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      assert.equal(createTabRes.status, 200);
      assert.deepEqual(await createTabRes.json(), {
        tab: { targetId: "t-3", url: "https://example.com" },
      });

      const closeTabRes = await fetch(`${base}/api/spaces/7/tabs/close`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ targetId: "t-2" }),
      });
      assert.equal(closeTabRes.status, 200);
      assert.deepEqual(await closeTabRes.json(), {
        done: true,
        spaceClosed: false,
        activeTargetId: "t-1",
      });

      const navRes = await fetch(`${base}/api/spaces/7/navigate`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ targetId: "t-1", url: "https://news.ycombinator.com" }),
      });
      assert.equal(navRes.status, 200);
      assert.deepEqual(await navRes.json(), {
        done: true,
        url: "https://news.ycombinator.com",
      });

      const navBackRes = await fetch(`${base}/api/spaces/7/navigate`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ targetId: "t-1", action: "back" }),
      });
      assert.equal(navBackRes.status, 200);
      assert.deepEqual(await navBackRes.json(), { done: true, url: null });

      const keyRes = await fetch(`${base}/api/spaces/7/key`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          targetId: "t-1",
          key: "a",
          code: "KeyA",
          ctrl: true,
          command: "selectAll",
        }),
      });
      assert.equal(keyRes.status, 200);
      assert.deepEqual(await keyRes.json(), { done: true });

      assert.deepEqual(
        panelCalls.map((c) => c.method),
        ["createTab", "closeTab", "navigate", "navigate", "sendKey"],
      );
      assert.equal(panelCalls[4].opts.command, "selectAll");
      assert.equal(panelCalls[4].opts.ctrl, true);

      const vncRes = await fetch(`${base}/vnc/vnc.html`, { headers: { cookie } });
      assert.equal(vncRes.status, 200);
      assert.equal(await vncRes.text(), "<h1>mock novnc</h1>");

      const statusRes = await fetch(`${base}/api/status`, { headers: { cookie } });
      assert.equal(statusRes.status, 200);
      const statusJson = await statusRes.json();
      assert.equal(statusJson.vncEnabled, true);
      assert.equal(statusJson.authEnabled, true);
      assert.equal(statusJson.chromeConnected, true);
      assert.equal(typeof statusJson.pageCount, "number");

      // WebSocket upgrade proxy through /vnc/websockify
      const wsAck = await new Promise((resolve, reject) => {
        const client = netConnect(consoleServer.port, "127.0.0.1", () => {
          const key = Buffer.from("ego-ws-test-key!").toString("base64");
          client.write(
            "GET /vnc/websockify HTTP/1.1\r\n" +
              `Host: 127.0.0.1:${consoleServer.port}\r\n` +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Key: ${key}\r\n` +
              "Sec-WebSocket-Version: 13\r\n" +
              `Cookie: ${cookie}\r\n\r\n`,
          );
        });
        let data = "";
        client.on("data", (chunk) => {
          data += chunk.toString("utf8");
          if (data.includes("\r\n\r\n")) {
            client.destroy();
            resolve(data);
          }
        });
        client.on("error", reject);
      });
      assert.match(wsAck, /^HTTP\/1\.1 101 Switching Protocols/);
      assert.match(wsAck, /X-Upstream-Path: \/websockify/);
    } finally {
      consoleServer.close();
      for (const sock of vncSockets) sock.destroy();
      vncSockets.clear();
      vncServer.closeAllConnections?.();
      await new Promise((r) => vncServer.close(r));
    }
  });

  it("recovers via reconnect() when stale shim holds an active cast and cdp.call throws synchronously", async () => {
    let staleClosed = false;
    let castSessionSeq = 0;
    const staleShim = {
      wsUrl: "ws://127.0.0.1:19222/devtools/browser/stale",
      cdp: {
        onShimEvent() {},
        claimSession() {},
        releaseSession() {},
        async call(method) {
          if (method === "Target.getTargets") {
            return { targetInfos: [{ type: "page", targetId: "t-stale", title: "Stale", url: "https://example.com" }] };
          }
          if (method === "Target.attachToTarget") {
            return { sessionId: `sess-${++castSessionSeq}` };
          }
          if (method === "Page.captureScreenshot") return { data: "" };
          if (method === "Runtime.evaluate") return { result: { value: null } };
          return {};
        },
      },
      ego: { listProfiles: () => listProfiles(), listTaskSpaces: async () => ({ taskSpaces: [] }) },
      panel: {
        async listDetailed() {
          return staleClosed
            ? Promise.reject(new Error("CDP channel is not open"))
            : [{ id: 1, name: "one", ownership: "agent", targetIds: ["t-stale"], tabs: [{ targetId: "t-stale", title: "Stale", url: "https://example.com", active: true }] }];
        },
      },
      close() {},
    };

    const freshShim = {
      wsUrl: "ws://127.0.0.1:19222/devtools/browser/fresh",
      cdp: {
        onShimEvent() {},
        claimSession() {},
        releaseSession() {},
        async call(method) {
          if (method === "Browser.getVersion") return { product: "Chrome/158" };
          if (method === "Target.getTargets") return { targetInfos: [] };
          return {};
        },
      },
      ego: { listProfiles: () => listProfiles(), listTaskSpaces: async () => ({ taskSpaces: [] }) },
      panel: { listDetailed: async () => [] },
      close() {},
    };

    let reconnectCalls = 0;
    const srv = await startSpacesServer(staleShim, {
      host: "127.0.0.1",
      port: 0,
      reconnect: async () => {
        reconnectCalls += 1;
        return freshShim;
      },
    });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      // Seed active cast inside currentPool before Chrome restarts
      const firstSpaces = await fetch(`${base}/api/spaces`);
      assert.equal(firstSpaces.status, 200);
      await firstSpaces.json();

      // Simulate Chrome dying: every cdp.call now throws synchronously
      staleClosed = true;
      staleShim.cdp.call = () => {
        throw new Error("CDP channel is not open");
      };

      const statusRes = await fetch(`${base}/api/status`);
      assert.equal(statusRes.status, 200);
      const statusJson = await statusRes.json();
      assert.equal(statusJson.chromeConnected, true);
      assert.equal(statusJson.cdpUrl, freshShim.wsUrl);

      const spacesRes = await fetch(`${base}/api/spaces`);
      assert.equal(spacesRes.status, 200);
      assert.equal(reconnectCalls, 1);
    } finally {
      srv.close();
    }
  });

  it("supports empty-name space creation and POST /api/browser/reopen", async () => {
    let reopenCount = 0;
    let createArgs = null;
    const mockShim = {
      wsUrl: "ws://127.0.0.1:19222/devtools/browser/reopen",
      cdp: {
        onShimEvent() {},
        claimSession() {},
        releaseSession() {},
        async call(method) {
          if (method === "Browser.getVersion") return { product: "Chrome/158" };
          if (method === "Target.getTargets") return { targetInfos: [] };
          return {};
        },
      },
      ego: { listProfiles: () => listProfiles(), listTaskSpaces: async () => ({ taskSpaces: [] }) },
      panel: {
        listDetailed: async () => [],
        async create(name, profileId) {
          createArgs = { name, profileId };
          return { id: 9, name: name || "Space #9", profileId: profileId || "Default" };
        },
        async reopenBrowser() {
          reopenCount += 1;
          return { done: true, action: "created", space: { id: 10, name: "Space #10" } };
        },
      },
      close() {},
    };
    const srv = await startSpacesServer(mockShim, { host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${srv.port}`;
    try {
      const statusRes = await fetch(`${base}/api/status`).then((r) => r.json());
      assert.equal(statusRes.pageCount, 0);

      const createRes = await fetch(`${base}/api/spaces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "", profileId: "isolated" }),
      });
      assert.equal(createRes.status, 200);
      assert.deepEqual(createArgs, { name: "", profileId: "isolated" });

      const reopenRes = await fetch(`${base}/api/browser/reopen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(reopenRes.status, 200);
      const reopenJson = await reopenRes.json();
      assert.equal(reopenJson.done, true);
      assert.equal(reopenJson.action, "created");
      assert.equal(reopenCount, 1);
    } finally {
      srv.close();
    }
  });
});
