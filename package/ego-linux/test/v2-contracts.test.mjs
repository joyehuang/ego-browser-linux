import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "bin", "ego-browser.mjs");

const SANDBOX = await mkdtemp(join(tmpdir(), "ego-v2-contracts-"));
process.env.XDG_STATE_HOME = join(SANDBOX, "state");
process.env.XDG_CONFIG_HOME = join(SANDBOX, "config");
process.env.EGO_LINUX_SPACE_IDLE_MIN = "0";
delete process.env.EGO_LINUX_ISOLATE_CONTEXTS;
delete process.env.EGO_LINUX_CDP_URL;
delete process.env.EGO_CONSOLE_PORT;
delete process.env.EGO_CONSOLE_PUBLIC_URL;
delete process.env.EGO_CONSOLE_TOKEN;
delete process.env.EGO_CONSOLE_INCLUDE_TOKEN_IN_URL;

const { loadDefaultEnv, parseEnvContent } = await import("../src/env-loader.mjs");
const { clearSessionRestore, parseExtraArgs, resolveCdpEndpoint, stopBrowser, browserStatus } =
  await import("../src/chrome.mjs");
const {
  consoleUrlForSpace,
  createTaskSpacesApi,
  egoRejectedError,
  formatHandoffNotice,
} = await import("../src/task-spaces.mjs");
const { allProfiles, listProfiles, resolveProfile } = await import("../src/profiles.mjs");
const { createTabsApi } = await import("../src/tabs.mjs");
const { createSnapshotApi } = await import("../src/snapshot.mjs");
const { TASK_SPACE_FILE, STATE_DIR } = await import("../src/paths.mjs");

describe("env-loader", () => {
  it("loads $XDG_CONFIG_HOME/ego-browser/env without overriding existing vars", async () => {
    const dir = join(SANDBOX, "env-cfg", "ego-browser");
    await mkdir(dir, { recursive: true });
    const envPath = join(dir, "env");
    await writeFile(
      envPath,
      [
        "# comment",
        "DISPLAY=:99",
        "export EGO_LINUX_CDP_URL=\"http://127.0.0.1:19222\"",
        "ALREADY_SET='from-file'",
      ].join("\n"),
    );

    const env = { ALREADY_SET: "from-shell", XDG_CONFIG_HOME: join(SANDBOX, "env-cfg") };
    const res = loadDefaultEnv({ env });
    assert.equal(res.loaded, true);
    assert.equal(env.DISPLAY, ":99");
    assert.equal(env.EGO_LINUX_CDP_URL, "http://127.0.0.1:19222");
    assert.equal(env.ALREADY_SET, "from-shell");
    assert.deepEqual(parseEnvContent("FOO=bar\n# x\nexport BAZ=\"qux\""), [
      ["FOO", "bar"],
      ["BAZ", "qux"],
    ]);
  });
});

describe("chrome external CDP discovery and standalone helpers", () => {
  it("resolves http:// CDP URL via /json/version and ws:// URL directly", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/json/version") {
        const { port } = server.address();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            Browser: "Chrome/158.0.0.0",
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/test-id`,
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const httpEp = await resolveCdpEndpoint(`http://127.0.0.1:${port}`);
      assert.equal(httpEp.port, port);
      assert.equal(httpEp.wsUrl, `ws://127.0.0.1:${port}/devtools/browser/test-id`);
      assert.equal(httpEp.external, true);

      const wsEp = await resolveCdpEndpoint(`ws://127.0.0.1:${port}/devtools/browser/direct`);
      assert.equal(wsEp.port, port);
      assert.equal(wsEp.wsUrl, `ws://127.0.0.1:${port}/devtools/browser/direct`);

      process.env.EGO_LINUX_CDP_URL = `http://127.0.0.1:${port}`;
      const status = await browserStatus();
      assert.equal(status.running, true);
      assert.equal(status.external, true);
      assert.equal(status.port, port);

      const stopped = await stopBrowser();
      assert.equal(stopped, false);
    } finally {
      delete process.env.EGO_LINUX_CDP_URL;
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });

  it("clearSessionRestore removes only Default/Sessions and parseExtraArgs splits quoted args", async () => {
    const profile = join(SANDBOX, "sess-profile");
    await mkdir(join(profile, "Default", "Sessions"), { recursive: true });
    await writeFile(join(profile, "Default", "Sessions", "Session_1"), "x");
    await writeFile(join(profile, "Default", "Cookies"), "keep-me");
    await clearSessionRestore(profile);
    assert.equal(existsSync(join(profile, "Default", "Sessions")), false);
    assert.equal(await readFile(join(profile, "Default", "Cookies"), "utf8"), "keep-me");

    assert.deepEqual(
      parseExtraArgs(`--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1" --lang=en-US`),
      ["--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1", "--lang=en-US"],
    );
  });
});

describe("task spaces v2.2.1 contract & strict scoping", () => {
  function mockCdp(targets) {
    let nextTarget = 1;
    const closed = [];
    const calls = [];
    return {
      closed,
      calls,
      async call(method, params) {
        calls.push({ method, params });
        if (method === "Target.getTargets") return { targetInfos: targets };
        if (method === "Target.createTarget") {
          const id = `created-${nextTarget++}`;
          targets.push({
            type: "page",
            targetId: id,
            url: params.url || "about:blank",
            title: "",
            browserContextId: params.browserContextId,
          });
          return { targetId: id };
        }
        if (method === "Target.closeTarget") {
          closed.push(params.targetId);
          const idx = targets.findIndex((t) => t.targetId === params.targetId);
          if (idx >= 0) targets.splice(idx, 1);
          return {};
        }
        if (method === "Target.createBrowserContext") return { browserContextId: "ctx-iso" };
        return {};
      },
    };
  }

  it("validates arguments, creates persistent-profile space by default, and supports lifecycle", async () => {
    await rm(TASK_SPACE_FILE, { force: true });
    const targets = [{ type: "page", targetId: "unrelated-1", url: "https://unrelated.test", title: "Other" }];
    const cdp = mockCdp(targets);
    const ts = createTaskSpacesApi(cdp);
    const tabs = createTabsApi(cdp, {
      getScope: () => ts.selectedScope(),
      checkControl: () => ts.checkControl(),
      onAdoptTargets: (sid, ids) => ts.adoptTargets(sid, ids),
    });

    // Before selection: EGO_TASK_SPACE_NOT_SELECTED
    assert.deepEqual(await tabs.listTabs(), {
      error: "Task space not selected",
      error_code: "EGO_TASK_SPACE_NOT_SELECTED",
    });

    // Invalid args -> TypeError with EGO_INVALID_ARGUMENT
    await assert.rejects(
      () => ts.createTaskSpace(""),
      (err) => err instanceof TypeError && err.error_code === "EGO_INVALID_ARGUMENT",
    );
    assert.throws(
      () => ts.useTaskSpace("1"),
      (err) => err instanceof TypeError && err.error_code === "EGO_INVALID_ARGUMENT",
    );

    // Unknown profileId -> EGO_PROFILE_NOT_FOUND
    assert.deepEqual(await ts.createTaskSpace("bad-prof", "Profile 99"), {
      error: "Profile not found",
      error_code: "EGO_PROFILE_NOT_FOUND",
    });

    // Default EGO_LINUX_ISOLATE_CONTEXTS=0 -> no BrowserContext created
    const created = await ts.createTaskSpace("alpha", "Default");
    assert.equal(created.id, 1);
    assert.equal(created.taskId, "alpha");
    assert.equal(created.name, "alpha");
    assert.equal(created.ownership, "agent");
    assert.equal(created.createdBy, "agent");
    assert.equal(created.profileId, "Default");
    assert.equal(created.profileKind, "persistent");
    assert.equal(
      cdp.calls.some((c) => c.method === "Target.createBrowserContext"),
      false,
    );

    // Still unselected until useTaskSpace(id)
    assert.deepEqual(await tabs.listTabs(), {
      error: "Task space not selected",
      error_code: "EGO_TASK_SPACE_NOT_SELECTED",
    });

    assert.equal(ts.useTaskSpace(created.id), created.id);
    const listed = await tabs.listTabs();
    assert.equal(listed.tabs.length, 1);
    assert.equal(listed.tabs[0].url, "about:blank");

    // Opener child target is adopted into the space; unrelated-1 is excluded!
    targets.push({
      type: "page",
      targetId: "popup-1",
      openerId: listed.tabs[0].targetId,
      url: "https://popup.test",
      title: "Popup",
    });
    const withPopup = await tabs.listTabs();
    assert.deepEqual(
      withPopup.tabs.map((t) => t.targetId).sort(),
      [listed.tabs[0].targetId, "popup-1"].sort(),
    );

    // Hand off -> blocks mutations with EGO_TASK_SPACE_USER_IN_CONTROL
    process.env.EGO_NOVNC_PORT = "6080";
    process.env.EGO_SSH_HOST = "vps.example";
    const handoffMsg = await ts.handOffTaskSpace();
    assert.match(handoffMsg, /^1 has been handed off to the user\. Open: http:\/\/127\.0\.0\.1:6080\/\?space=1$/);
    assert.deepEqual(await tabs.listTabs(), {
      error: "manual_takeover",
      error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
    });
    assert.deepEqual(await ts.createTabInSelectedSpace(tabs, "https://example.com"), {
      error: "manual_takeover",
      error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
    });
    assert.deepEqual(await ts.closeTaskSpace(), {
      error: "manual_takeover",
      error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
    });
    assert.equal(ts.checkControlSync().error_code, "EGO_TASK_SPACE_USER_IN_CONTROL");

    // Take over -> restores agent control
    assert.equal(await ts.takeOverTaskSpace(), "1 is now under agent control.");
    assert.equal(ts.checkControlSync(), null);

    // Complete -> ownership user; claimTaskSpace reclaims and renames
    assert.equal(await ts.completeTaskSpace(), "1 task space completed.");
    const claimed = await ts.claimTaskSpace(1, "alpha-reclaimed");
    assert.equal(claimed.name, "alpha-reclaimed");
    assert.equal(claimed.taskId, "alpha-reclaimed");
    assert.equal(claimed.ownership, "agent");

    assert.equal(await ts.closeTaskSpace(), "1 task space closed.");
    assert.ok(targets.some((t) => t.targetId === "unrelated-1"), "unrelated tab untouched");
  });

  it("supports opt-in EGO_LINUX_ISOLATE_CONTEXTS=1", async () => {
    await mkdir(STATE_DIR, { recursive: true });
    await rm(TASK_SPACE_FILE, { force: true });
    process.env.EGO_LINUX_ISOLATE_CONTEXTS = "1";
    try {
      const cdp = mockCdp([]);
      const ts = createTaskSpacesApi(cdp);
      await ts.createTaskSpace("isolated");
      assert.equal(
        cdp.calls.some((c) => c.method === "Target.createBrowserContext"),
        true,
      );
    } finally {
      delete process.env.EGO_LINUX_ISOLATE_CONTEXTS;
    }
  });
});

describe("snapshot v2.2.1 locators, subtree, and OOPIF refs", () => {
  function oopifCdp({ collideBackendIds = false, blocked = false } = {}) {
    const mainDoc = {
      strings: [
        "", "HTML", "BODY", "DIV", "BUTTON", "INPUT", "A", "IFRAME", "#text",
        "Submit", "https://main.test", "/next", "data-testid", "submit-btn",
        "id", "email", "name", "user_email", "placeholder", "Enter email",
        "href", "title", "Child Frame",
      ],
      documents: [
        {
          documentURL: 10,
          nodes: {
            //            0:html 1:body 2:div  3:btn  4:txt  5:input 6:link 7:ltxt 8:iframe
            parentIndex: [-1, 0, 1, 2, 3, 2, 2, 6, 1],
            nodeType: [1, 1, 1, 1, 3, 1, 1, 3, 1],
            nodeName: [1, 2, 3, 4, 8, 5, 6, 8, 7],
            nodeValue: [0, 0, 0, 0, 9, 0, 0, 9, 0],
            backendNodeId: [1, 2, 10, 11, 12, 13, 14, 15, 16],
            attributes: [
              [], [], [],
              [12, 13],
              [],
              [14, 15, 16, 17, 18, 19],
              [20, 11],
              [],
              [21, 22],
            ],
          },
          layout: {
            nodeIndex: [2, 3, 4, 5, 6, 7, 8],
            bounds: [
              [0, 0, 500, 500],
              [10, 10, 100, 30],
              [10, 10, 100, 30],
              [10, 50, 200, 30],
              [10, 90, 100, 20],
              [10, 90, 100, 20],
              [10, 130, 300, 200],
            ],
            text: [0, 0, 9, 0, 0, 9, 0],
          },
        },
      ],
    };

    const oopifDoc = {
      strings: ["", "HTML", "BODY", "BUTTON", "#text", "Frame Action", "https://frame.test"],
      documents: [
        {
          documentURL: 6,
          nodes: {
            parentIndex: [-1, 0, 1, 2],
            nodeType: [1, 1, 1, 1],
            nodeName: [1, 2, 3, 3],
            nodeValue: [0, 0, 0, 0],
            // Note: backendNodeId 11 collides with mainDoc button 11 when collideBackendIds=true!
            backendNodeId: [1, 2, collideBackendIds ? 11 : 21, 22],
            attributes: [[], [], [], []],
          },
          layout: {
            nodeIndex: [2, 3],
            bounds: [
              [0, 0, 100, 30],
              [0, 0, 100, 30],
            ],
            text: [0, 0],
          },
        },
      ],
    };
    // Fix text node inside oopifDoc button
    oopifDoc.documents[0].nodes.nodeName[3] = 4; // #text
    oopifDoc.documents[0].nodes.nodeType[3] = 3;
    oopifDoc.documents[0].nodes.nodeValue[3] = 5;
    oopifDoc.documents[0].layout.text[1] = 5;

    const cdp = {
      attachedHint: () => "page-1",
      async call(method, params, sessionId) {
        if (method === "Target.attachToTarget") {
          return { sessionId: params.targetId === "oopif-1" ? "sess-oopif" : "sess-main" };
        }
        if (method === "Target.getTargets") {
          return {
            targetInfos: [
              { type: "page", targetId: "page-1", url: "https://main.test" },
              { type: "iframe", targetId: "oopif-1", parentFrameId: "frame-root", url: "https://frame.test" },
            ],
          };
        }
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { id: "frame-root" }, childFrames: [{ frame: { id: "oopif-1" } }] } };
        }
        if (method === "DOM.describeNode" && params.backendNodeId === 16) {
          return { node: { frameId: "oopif-1" } };
        }
        if (method === "DOMSnapshot.captureSnapshot") {
          return sessionId === "sess-oopif" ? oopifDoc : mainDoc;
        }
        return {};
      },
    };
    return createSnapshotApi(cdp, {
      listTabs: async () => ({ tabs: [{ targetId: "page-1", active: true }] }),
      checkControl: blocked
        ? async () => ({ error: "manual_takeover", error_code: "EGO_TASK_SPACE_USER_IN_CONTROL" })
        : async () => null,
    });
  }

  it("starts with root, emits only valid locators, attaches OOPIFs with unique refIds", async () => {
    const api = oopifCdp({ collideBackendIds: true });
    const snap = await api.snapshot({ scope: "full_page", includeStableLocator: true });
    assert.ok(snap.content.startsWith("root\n"), "content starts with root");
    assert.ok(snap.content.includes(`loc=css:[data-testid="submit-btn"]`));
    assert.ok(snap.content.includes("loc=css:#email"));
    assert.ok(snap.content.includes("loc=href:/next"));
    assert.doesNotMatch(snap.content, /\bloc=testid:/);
    assert.doesNotMatch(snap.content, /\bloc=placeholder:/);

    const frameRef = snap.refs.find((r) => r.frameId === "oopif-1");
    assert.ok(frameRef, "OOPIF node is included in refs");
    assert.equal(frameRef.backendNodeId, 11);
    assert.notEqual(frameRef.refId, 11, "colliding backendNodeId receives a unique refId");
    const uniqueRefIds = new Set(snap.refs.map((r) => r.refId));
    assert.equal(uniqueRefIds.size, snap.refs.length, "all refIds in snapshot are unique");
  });

  it("supports subtree, interactiveOnly, maxResultLength, and rejects under user control", async () => {
    const api = oopifCdp({ collideBackendIds: false });
    const sub = await api.snapshot({ scope: "subtree", root: 10, interactiveOnly: true });
    assert.ok(sub.content.startsWith("root\n"));
    assert.ok(sub.content.includes("Submit"));
    assert.ok(!sub.content.includes("Child Frame"));

    const probe = await api.snapshot({ maxResultLength: 1 });
    assert.equal(probe.content.length, 1);

    await assert.rejects(
      () => api.snapshot({ scope: "subtree", root: 9999 }),
      (err) => err instanceof Error && err.error_code === "EGO_SNAPSHOT_FAILED",
    );
    await assert.rejects(
      () => oopifCdp({ collideBackendIds: true }).snapshot({ scope: "subtree", root: 11 }),
      (err) => err instanceof Error && err.error_code === "EGO_SNAPSHOT_FAILED",
    );

    const blockedApi = oopifCdp({ blocked: true });
    await assert.rejects(
      () => blockedApi.snapshot(),
      (err) => err instanceof Error && err.error_code === "EGO_TASK_SPACE_USER_IN_CONTROL",
    );
  });
});

describe("CLI skill and help commands", () => {
  function runCli(args) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [BIN, ...args], {
        env: { ...process.env, XDG_CONFIG_HOME: join(SANDBOX, "no-cfg") },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  it("prints help listing required commands and handles ego-browser skill", async () => {
    const helpRes = await runCli(["help"]);
    assert.equal(helpRes.code, 0);
    for (const cmd of ["nodejs", "skill", "--status", "--stop", "--open", "--prune-spaces", "--serve"]) {
      assert.ok(helpRes.stdout.includes(cmd), `help lists ${cmd}`);
    }

    const sdkDir = join(SANDBOX, "fake-sdk");
    await mkdir(join(sdkDir, "ego-browser"), { recursive: true });
    await writeFile(join(sdkDir, "index.js"), "export async function runMain() { return 0; }\n");
    await writeFile(join(sdkDir, "ego-browser", "SKILL.md"), "ALL PLATFORM GUIDE\n");

    const fallback = await runCli(["skill", "--sdk-path", join(sdkDir, "index.js")]);
    assert.equal(fallback.code, 0);
    assert.match(fallback.stdout, /\[ego-browser:skill\] source=sdk-path/);
    assert.match(fallback.stdout, /ALL PLATFORM GUIDE/);

    await writeFile(join(sdkDir, "ego-browser", "SKILL.linux.md"), "LINUX GUIDE\n");
    const linuxGuide = await runCli(["skill", "--sdk-path", join(sdkDir, "index.js")]);
    assert.equal(linuxGuide.code, 0);
    assert.match(linuxGuide.stdout, /LINUX GUIDE/);

    const extraArg = await runCli(["skill", "unexpected"]);
    assert.notEqual(extraArg.code, 0);
  });
});

import { createHash } from "node:crypto";

describe("shim.mjs v2.2.1 profiles, version, and sendCDPMessage control gate", () => {
  it("exposes listProfiles, getBrowserVersion, and gates sendCDPMessage/cursor under user control", async () => {
    await rm(TASK_SPACE_FILE, { force: true });
    const sentToWs = [];
    const sockets = new Set();
    const server = createServer((req, res) => {
      if (req.url === "/json/version") {
        const { port } = server.address();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/ws` }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.on("upgrade", (req, socket) => {
      sockets.add(socket);
      const key = req.headers["sec-websocket-key"];
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      const sendFrame = (obj) => {
        const payload = Buffer.from(JSON.stringify(obj), "utf8");
        const header =
          payload.length < 126
            ? Buffer.from([0x81, payload.length])
            : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
        socket.write(Buffer.concat([header, payload]));
      };
      let buf = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const lenByte = buf[1] & 0x7f;
          const masked = (buf[1] & 0x80) !== 0;
          let offset = 2;
          let len = lenByte;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            offset = 4;
          }
          const maskLen = masked ? 4 : 0;
          if (buf.length < offset + maskLen + len) return;
          const mask = masked ? buf.subarray(offset, offset + 4) : null;
          const body = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
          if (mask) {
            for (let i = 0; i < body.length; i += 1) body[i] ^= mask[i % 4];
          }
          buf = buf.subarray(offset + maskLen + len);
          if ((buf.length >= 0) && (body.length > 0)) {
            let msg;
            try { msg = JSON.parse(body.toString("utf8")); } catch { continue; }
            sentToWs.push(msg);
            if (msg.method === "Browser.getVersion") {
              sendFrame({ id: msg.id, result: { product: "Chrome/158.0.0.0", revision: "r1" } });
            } else if (msg.method === "Target.createTarget") {
              sendFrame({ id: msg.id, result: { targetId: "t-shim-1" } });
            } else if (msg.method === "Target.getTargets") {
              sendFrame({ id: msg.id, result: { targetInfos: [{ type: "page", targetId: "t-shim-1", url: "about:blank" }] } });
            } else {
              sendFrame({ id: msg.id, result: {} });
            }
          }
        }
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    process.env.EGO_LINUX_CDP_URL = `http://127.0.0.1:${port}`;
    const { createEgoShim } = await import("../src/shim.mjs");
    const shim = await createEgoShim();
    try {
      const prof = await shim.ego.listProfiles();
      assert.deepEqual(
        prof.profiles.map((x) => x.id),
        ["Default", "isolated", "isolated-seeded"],
      );
      assert.equal(prof.profiles[0].isDefault, true);
      const ver = await shim.ego.getBrowserVersion();
      assert.equal(ver.currentVersion, "2.2.1-linux");
      assert.equal(ver.updateAvailable, false);
      assert.equal(ver.linuxPort, true);
      assert.equal(ver.product, "Chrome/158.0.0.0");

      const errors = [];
      shim.ego.onSendCDPMessageError = (message, code) => errors.push({ message, code });

      // Before selecting a space: sendCDPMessage fails asynchronously without sending to WS
      shim.ego.sendCDPMessage(JSON.stringify({ id: 1, method: "Browser.getVersion" }));
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(errors.at(-1)?.code, "EGO_TASK_SPACE_NOT_SELECTED");

      const task = await shim.ego.createTaskSpace("shim-gate");
      assert.equal(shim.ego.useTaskSpace(task.id), task.id);

      await shim.ego.handOffTaskSpace();
      shim.ego.sendCDPMessage(JSON.stringify({ id: 2, method: "Browser.getVersion" }));
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(errors.at(-1)?.code, "EGO_TASK_SPACE_USER_IN_CONTROL");
      assert.equal(
        sentToWs.some((m) => m.id === 2 && m.method === "Browser.getVersion"),
        false,
        "blocked send never reached WebSocket",
      );

      assert.deepEqual(await shim.ego.setAgentTaskState("working"), {
        error: "manual_takeover",
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      });
      assert.deepEqual(await shim.ego.animationHighlightMouseToPosition(10, 20), {
        error: "manual_takeover",
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      });
      await assert.rejects(
        () => shim.ego.snapshot(),
        (err) => err instanceof Error && err.error_code === "EGO_TASK_SPACE_USER_IN_CONTROL",
      );
    } finally {
      shim.close();
      delete process.env.EGO_LINUX_CDP_URL;
      for (const sock of sockets) sock.destroy();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });
});

describe("runtime-core regressions, panel browser control, profiles & access modes", () => {
  function panelMockCdp({ failNavigate = false, failSendKey = false } = {}) {
    let nextTarget = 1;
    let nextSession = 1;
    const targets = [];
    const calls = [];
    const attached = new Set();
    const disposed = [];
    const historyByTarget = new Map();

    return {
      targets,
      calls,
      attached,
      disposed,
      historyByTarget,
      async call(method, params = {}, sessionId) {
        calls.push({ method, params, sessionId });
        if (method === "Target.getTargets") {
          return { targetInfos: targets };
        }
        if (method === "Target.createBrowserContext") {
          return { browserContextId: "ctx-panel-1" };
        }
        if (method === "Target.disposeBrowserContext") {
          disposed.push(params.browserContextId);
          return {};
        }
        if (method === "Target.createTarget") {
          const targetId = `pt-${nextTarget++}`;
          targets.push({
            type: "page",
            targetId,
            url: params.url || "about:blank",
            title: params.url && params.url !== "about:blank" ? `Title:${params.url}` : "",
            browserContextId: params.browserContextId,
          });
          return { targetId };
        }
        if (method === "Target.closeTarget") {
          const idx = targets.findIndex((t) => t.targetId === params.targetId);
          if (idx >= 0) targets.splice(idx, 1);
          return {};
        }
        if (method === "Target.attachToTarget") {
          const sid = `sess-${nextSession++}`;
          attached.add(sid);
          return { sessionId: sid };
        }
        if (method === "Target.detachFromTarget") {
          attached.delete(params.sessionId);
          return {};
        }
        if (method === "Page.navigate") {
          if (failNavigate) throw new Error("simulated navigate failure");
          const attachCall = [...calls]
            .reverse()
            .find((c) => c.method === "Target.attachToTarget");
          const t = targets.find((x) => x.targetId === attachCall?.params?.targetId);
          if (t) {
            t.url = params.url;
            t.title = `Title:${params.url}`;
          }
          return { frameId: "f1" };
        }
        if (method === "Page.getNavigationHistory") {
          const attachCall = [...calls]
            .reverse()
            .find((c) => c.method === "Target.attachToTarget");
          return (
            historyByTarget.get(attachCall?.params?.targetId) || {
              currentIndex: 1,
              entries: [
                { id: 101, url: "https://prev.example" },
                { id: 102, url: "https://curr.example" },
                { id: 103, url: "https://next.example" },
              ],
            }
          );
        }
        if (method === "Input.dispatchKeyEvent") {
          if (failSendKey) throw new Error("simulated key failure");
          return {};
        }
        return {};
      },
    };
  }

  it("re-exports egoRejectedError and preserves space fields in decorate()", async () => {
    const err = egoRejectedError("boom", "EGO_SNAPSHOT_FAILED");
    assert.ok(err instanceof Error);
    assert.equal(err.message, "boom");
    assert.equal(err.error_code, "EGO_SNAPSHOT_FAILED");

    await rm(TASK_SPACE_FILE, { force: true });
    const cdp = panelMockCdp();
    const ts = createTaskSpacesApi(cdp);
    const created = await ts.createTaskSpace("decorate-check");
    cdp.targets[0].title = "Home Page";
    cdp.targets[0].url = "https://home.example";

    const { taskSpaces } = await ts.listTaskSpaces();
    const listed = taskSpaces.find((s) => s.id === created.id);
    assert.ok(listed);
    assert.equal(typeof listed.createdAt, "number");
    assert.equal(typeof listed.touchedAt, "number");
    assert.equal(typeof listed.lastContentAt, "number");
    assert.deepEqual(listed.targetIds, ["pt-1"]);
    assert.deepEqual(listed.urls, ["https://home.example"]);
    assert.deepEqual(listed.recentTabTitles, ["Home Page"]);
    assert.equal(listed.profileId, "Default");
    assert.equal(listed.profileKind, "persistent");
    assert.ok(listed.agent);
  });

  it("supports panel createTab, activeTargetId tracking, focus, navigate, sendKey, and closeTab", async () => {
    await rm(TASK_SPACE_FILE, { force: true });
    const cdp = panelMockCdp();
    const ts = createTaskSpacesApi(cdp);

    const space = await ts.panel.create("console-space", "isolated");
    assert.equal(space.profileId, "isolated");
    assert.equal(space.profileKind, "isolated");

    // createTab normalizes bare host, defaults blank, sets activeTargetId & lastContentAt
    const tab2 = await ts.panel.createTab(space.id, "example.com/docs");
    assert.deepEqual(tab2, { targetId: "pt-2", url: "https://example.com/docs" });
    const tab3 = await ts.panel.createTab(space.id);
    assert.deepEqual(tab3, { targetId: "pt-3", url: "about:blank" });

    // Confirm isolated browserContextId was passed to Target.createTarget
    const createCalls = cdp.calls.filter((c) => c.method === "Target.createTarget");
    assert.equal(createCalls.length, 3);
    assert.ok(createCalls.every((c) => c.params.browserContextId === "ctx-panel-1"));

    // listDetailed surfaces activeTargetId and marks matching tab active
    let detailed = await ts.panel.listDetailed();
    assert.equal(detailed.length, 1);
    assert.equal(detailed[0].activeTargetId, "pt-3");
    assert.deepEqual(
      detailed[0].tabs.map((t) => ({ id: t.targetId, active: t.active })),
      [
        { id: "pt-1", active: false },
        { id: "pt-2", active: false },
        { id: "pt-3", active: true },
      ],
    );

    // focus switches activeTargetId persistently
    assert.deepEqual(await ts.panel.focus(space.id, "pt-2"), { done: true });
    detailed = await ts.panel.listDetailed();
    assert.equal(detailed[0].activeTargetId, "pt-2");
    assert.equal(detailed[0].tabs.find((t) => t.active)?.targetId, "pt-2");
    assert.equal(detailed[0].tabs.find((t) => t.active)?.url, "https://example.com/docs");

    // navigate: url normalization, reload, back, forward — all detach temp session
    const navUrl = await ts.panel.navigate(space.id, { url: "news.example/today" });
    assert.deepEqual(navUrl, { done: true, url: "https://news.example/today" });
    assert.ok(
      cdp.calls.some(
        (c) => c.method === "Page.navigate" && c.params.url === "https://news.example/today",
      ),
    );
    assert.equal(cdp.attached.size, 0, "temporary session detached after navigate");

    assert.deepEqual(await ts.panel.navigate(space.id, { action: "reload" }), {
      done: true,
      url: null,
    });
    assert.ok(
      cdp.calls.some(
        (c) => c.method === "Page.reload" && c.params.ignoreCache === false,
      ),
    );

    assert.deepEqual(await ts.panel.navigate(space.id, { action: "back" }), {
      done: true,
      url: null,
    });
    assert.ok(
      cdp.calls.some(
        (c) => c.method === "Page.navigateToHistoryEntry" && c.params.entryId === 101,
      ),
    );

    assert.deepEqual(await ts.panel.navigate(space.id, { action: "forward" }), {
      done: true,
      url: null,
    });
    assert.ok(
      cdp.calls.some(
        (c) => c.method === "Page.navigateToHistoryEntry" && c.params.entryId === 103,
      ),
    );

    // Boundary check: back at index 0 should not call navigateToHistoryEntry
    cdp.historyByTarget.set("pt-2", {
      currentIndex: 0,
      entries: [{ id: 201, url: "https://first.example" }],
    });
    const navCountBefore = cdp.calls.filter(
      (c) => c.method === "Page.navigateToHistoryEntry",
    ).length;
    await ts.panel.navigate(space.id, { action: "back" });
    assert.equal(
      cdp.calls.filter((c) => c.method === "Page.navigateToHistoryEntry").length,
      navCountBefore,
    );
    assert.equal(cdp.attached.size, 0, "temporary session detached after history actions");

    // sendKey computes CDP modifier bitmask (alt=1|ctrl=2|meta=4|shift=8) + command
    const keyRes = await ts.panel.sendKey(space.id, {
      key: "a",
      code: "KeyA",
      ctrl: true,
      shift: true,
      command: "selectAll",
    });
    assert.deepEqual(keyRes, { done: true });
    const keyCalls = cdp.calls.filter((c) => c.method === "Input.dispatchKeyEvent");
    assert.equal(keyCalls.length, 2);
    assert.deepEqual(keyCalls[0].params, {
      type: "rawKeyDown",
      key: "a",
      code: "KeyA",
      modifiers: 10,
      commands: ["selectAll"],
    });
    assert.deepEqual(keyCalls[1].params, {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 10,
    });
    assert.equal(cdp.attached.size, 0, "temporary session detached after sendKey");

    // closeTab with remaining tabs updates activeTargetId to first remaining tab
    const close1 = await ts.panel.closeTab(space.id, "pt-2");
    assert.deepEqual(close1, { done: true, spaceClosed: false, activeTargetId: "pt-1" });
    const close2 = await ts.panel.closeTab(space.id, "pt-3");
    assert.deepEqual(close2, { done: true, spaceClosed: false, activeTargetId: "pt-1" });

    // closeTab on last tab (omitting targetId uses activeTargetId) disposes context & removes space
    const closeLast = await ts.panel.closeTab(space.id);
    assert.deepEqual(closeLast, { done: true, spaceClosed: true });
    assert.deepEqual(cdp.disposed, ["ctx-panel-1"]);
    assert.deepEqual(await ts.panel.listDetailed(), []);
  });

  it("always detaches temporary CDP session even when navigate or sendKey throws", async () => {
    await rm(TASK_SPACE_FILE, { force: true });
    const cdp = panelMockCdp({ failNavigate: true, failSendKey: true });
    const ts = createTaskSpacesApi(cdp);
    const space = await ts.panel.create("err-space");

    await assert.rejects(
      () => ts.panel.navigate(space.id, { url: "example.com" }),
      /simulated navigate failure/,
    );
    assert.equal(cdp.attached.size, 0, "session detached on navigate error");

    await assert.rejects(
      () => ts.panel.sendKey(space.id, { key: "Escape" }),
      /simulated key failure/,
    );
    assert.equal(cdp.attached.size, 0, "session detached on sendKey error");
  });

  it("cleans up custom profiles.json entries to isolated/isolated-seeded presets without unused fields", async () => {
    const profilesPath = join(SANDBOX, "custom-profiles.json");
    await writeFile(
      profilesPath,
      JSON.stringify({
        profiles: [
          {
            id: "qa-clean",
            name: "QA Clean",
            description: "Fresh test session",
            cdpUrl: "http://127.0.0.1:9999",
            userDataDir: "/tmp/unused",
          },
          {
            id: "qa-seeded",
            name: "QA Seeded",
            kind: "isolated-seeded",
            description: "Seeded from Default",
          },
          { id: "Default", name: "Ignored Builtin Override" },
        ],
      }),
    );
    process.env.EGO_LINUX_PROFILES_FILE = profilesPath;
    try {
      const full = allProfiles();
      const qaClean = full.find((p) => p.id === "qa-clean");
      const qaSeeded = full.find((p) => p.id === "qa-seeded");
      assert.equal(qaClean.kind, "isolated");
      assert.equal(qaClean.description, "Fresh test session");
      assert.equal("cdpUrl" in qaClean, false);
      assert.equal("userDataDir" in qaClean, false);
      assert.equal(qaSeeded.kind, "isolated-seeded");
      assert.equal(qaSeeded.description, "Seeded from Default");
      assert.equal(resolveProfile("Default").kind, "persistent");

      const listed = listProfiles();
      assert.deepEqual(
        listed.profiles.map((p) => Object.keys(p).sort()),
        listed.profiles.map(() => ["id", "isDefault", "name"]),
      );
    } finally {
      delete process.env.EGO_LINUX_PROFILES_FILE;
    }
  });

  it("formats consoleUrlForSpace and formatHandoffNotice across all 3 access modes", () => {
    const saved = {
      EGO_CONSOLE_PORT: process.env.EGO_CONSOLE_PORT,
      EGO_NOVNC_PORT: process.env.EGO_NOVNC_PORT,
      EGO_SSH_HOST: process.env.EGO_SSH_HOST,
      EGO_CONSOLE_PUBLIC_URL: process.env.EGO_CONSOLE_PUBLIC_URL,
      EGO_CONSOLE_TOKEN: process.env.EGO_CONSOLE_TOKEN,
      EGO_CONSOLE_INCLUDE_TOKEN_IN_URL: process.env.EGO_CONSOLE_INCLUDE_TOKEN_IN_URL,
    };
    const reset = () => {
      for (const k of Object.keys(saved)) delete process.env[k];
    };
    try {
      // Mode 1: SSH tunnel default
      reset();
      process.env.EGO_CONSOLE_PORT = "6090";
      process.env.EGO_SSH_HOST = "vps.example";
      assert.equal(consoleUrlForSpace(7), "http://127.0.0.1:6090/?space=7");
      const localNotice = formatHandoffNotice(7);
      assert.ok(localNotice.includes("Console URL: http://127.0.0.1:6090/?space=7"));
      assert.ok(localNotice.includes("SSH forward: ssh -N -L 6090:127.0.0.1:6090 vps.example"));

      // Mode 2: Tailscale / Direct LAN
      reset();
      process.env.EGO_CONSOLE_PUBLIC_URL = "http://100.64.0.10:6080/";
      assert.equal(consoleUrlForSpace(8), "http://100.64.0.10:6080/?space=8");
      const directNotice = formatHandoffNotice(8);
      assert.ok(directNotice.includes("Console URL: http://100.64.0.10:6080/?space=8"));
      assert.doesNotMatch(directNotice, /SSH forward:/);

      // Mode 3: Public reverse proxy + token (hidden by default, opt-in via env)
      reset();
      process.env.EGO_CONSOLE_PUBLIC_URL = "https://console.example.test///";
      process.env.EGO_CONSOLE_TOKEN = "tok-abc";
      assert.equal(consoleUrlForSpace(9), "https://console.example.test/?space=9");
      assert.doesNotMatch(formatHandoffNotice(9), /SSH forward:/);

      process.env.EGO_CONSOLE_INCLUDE_TOKEN_IN_URL = "1";
      assert.equal(consoleUrlForSpace(9), "https://console.example.test/?space=9&token=tok-abc");
      assert.equal(consoleUrlForSpace(), "https://console.example.test/?token=tok-abc");
      assert.doesNotMatch(formatHandoffNotice(9), /SSH forward:/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("auto-names blank panel spaces, opens with newWindow when 0 windows exist, and supports reopenBrowser", async () => {
    const createCalls = [];
    const targets = [];
    let nextT = 1;
    let ctxSeq = 1;
    let firstCreateRejected = false;
    const cdp = {
      async call(method, params = {}) {
        if (method === "Target.getTargets") return { targetInfos: targets };
        if (method === "Target.createBrowserContext") return { browserContextId: `ctx-${ctxSeq++}` };
        if (method === "Target.createTarget") {
          createCalls.push({ ...params });
          if (!params.newWindow && targets.length === 0 && !firstCreateRejected) {
            firstCreateRejected = true;
            throw new Error("no open browser window");
          }
          const targetId = `t-${nextT++}`;
          targets.push({ type: "page", targetId, url: params.url || "about:blank", title: "New Tab", browserContextId: params.browserContextId });
          return { targetId };
        }
        if (method === "Target.attachToTarget") return { sessionId: `sess-${nextT}` };
        if (method === "Browser.getWindowForTarget") return { windowId: 7, bounds: { windowState: "minimized" } };
        return {};
      },
    };
    const ts = createTaskSpacesApi(cdp);

    // 1) Empty name with Default -> auto-named Space #N + newWindow: true
    const s1 = await ts.panel.create("", "Default");
    assert.match(s1.name, /^Space #\d+$/);
    assert.equal(createCalls.at(-1).newWindow, true);

    // 2) Empty name with isolated -> auto-named Isolated #N
    const s2 = await ts.panel.create("   ", "isolated");
    assert.match(s2.name, /^Isolated #\d+$/);

    // 3) Simulate user closing every Chrome window (targets emptied) -> reopenBrowser restores one
    targets.length = 0;
    const reopened = await ts.panel.reopenBrowser();
    assert.equal(reopened.done, true);
    assert.equal(reopened.action, "created");
    assert.match(reopened.space.name, /^Space #\d+$/);
    assert.equal(targets.length, 1);
  });
});
