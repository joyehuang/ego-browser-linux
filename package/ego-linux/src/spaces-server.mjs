import { timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";

import { CURSOR_PROBE_EXPRESSION } from "./cursor.mjs";
import { SPACES_HTML } from "./spaces-ui.mjs";

const ACTIVE_WINDOW_MS = 30_000;
const FOLLOW = { width: 760, aspect: 16 / 10 };
const CAST = { format: "jpeg", quality: 55, maxWidth: 960, maxHeight: 600 };

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

async function readCursor(cdp, sessionId) {
  try {
    const { result } = await cdp.call(
      "Runtime.evaluate",
      { expression: CURSOR_PROBE_EXPRESSION, returnByValue: true },
      sessionId,
    );
    return result?.value ?? null;
  } catch {
    return null;
  }
}

function createCastPool(cdp) {
  const casts = new Map();
  const opening = new Map();
  let closed = false;

  cdp.onShimEvent("Page.screencastFrame", (params, sessionId) => {
    for (const cast of casts.values()) {
      if (cast.sessionId !== sessionId) continue;
      cast.frame = params.data || null;
      cast.seq += 1;
      break;
    }
    cdp
      .call("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionId)
      .catch(() => {});
  });

  async function open(targetId) {
    const { sessionId } = await cdp.call("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    cdp.claimSession(sessionId);
    if (closed) {
      cdp.releaseSession(sessionId);
      cdp.call("Target.detachFromTarget", { sessionId }).catch(() => {});
      throw new Error("cast pool is closed");
    }
    const cast = { sessionId, frame: null, seq: 0 };
    casts.set(targetId, cast);
    try {
      await cdp.call("Page.startScreencast", { ...CAST, everyNthFrame: 1 }, sessionId);
    } catch (error) {
      casts.delete(targetId);
      cdp.releaseSession(sessionId);
      cdp.call("Target.detachFromTarget", { sessionId }).catch(() => {});
      throw error;
    }
    try {
      const shot = await cdp.call(
        "Page.captureScreenshot",
        { format: CAST.format, quality: CAST.quality, captureBeyondViewport: false },
        sessionId,
      );
      if (shot.data && !cast.frame) cast.frame = shot.data;
    } catch {
      // Filled by next screencast frame.
    }
    return cast;
  }

  return {
    async frameFor(targetId) {
      const existing = casts.get(targetId);
      if (existing) return existing;
      const inFlight = opening.get(targetId);
      if (inFlight) return inFlight.catch(() => null);

      const attempt = open(targetId).finally(() => opening.delete(targetId));
      opening.set(targetId, attempt);
      return attempt.catch(() => null);
    },

    async retain(liveTargetIds) {
      for (const [targetId, cast] of [...casts.entries()]) {
        if (liveTargetIds.has(targetId)) continue;
        casts.delete(targetId);
        cdp.releaseSession(cast.sessionId);
        try {
          await Promise.resolve(
            cdp.call("Target.detachFromTarget", { sessionId: cast.sessionId }),
          ).catch(() => {});
        } catch {}
      }
    },

    closeAll() {
      closed = true;
      for (const cast of casts.values()) {
        try {
          Promise.resolve(
            cdp.call("Target.detachFromTarget", { sessionId: cast.sessionId }),
          ).catch(() => {});
        } catch {}
        cdp.releaseSession(cast.sessionId);
      }
      casts.clear();
    },
  };
}

async function captureCard(cdp, targetId, pool) {
  try {
    const cast = await pool.frameFor(targetId);
    if (!cast) return { thumbnail: null, activity: null, trail: [] };

    const cursor = await readCursor(cdp, cast.sessionId);
    const active = Boolean(cursor) && cursor.ageMs < ACTIVE_WINDOW_MS;
    return {
      thumbnail: cast.frame ? `data:image/jpeg;base64,${cast.frame}` : null,
      activity: active
        ? {
            name: cursor.name,
            label: cursor.label,
            ageMs: Math.round(cursor.ageMs),
            fx: cursor.viewportWidth ? cursor.x / cursor.viewportWidth : null,
            fy: cursor.viewportHeight ? cursor.y / cursor.viewportHeight : null,
          }
        : null,
      trail: cursor?.trail?.slice(-3).reverse() ?? [],
    };
  } catch {
    return { thumbnail: null, activity: null, trail: [] };
  }
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function tokensEqual(a, b) {
  const ab = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function parseUpstream(upstream) {
  if (!upstream) return null;
  const trimmed = String(upstream).trim().replace(/^https?:\/\//, "");
  const colon = trimmed.lastIndexOf(":");
  if (colon <= 0) return null;
  const host = trimmed.slice(0, colon);
  const port = Number(trimmed.slice(colon + 1));
  if (!host || !Number.isInteger(port) || port <= 0) return null;
  return { host, port };
}

function isAllowedOrigin(origin, publicOrigin, requestHost) {
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const normalized = parsed.origin.toLowerCase();
  if (
    normalized === "http://127.0.0.1" ||
    normalized === "http://localhost" ||
    normalized.startsWith("http://127.0.0.1:") ||
    normalized.startsWith("http://localhost:")
  ) {
    return true;
  }
  if (publicOrigin && normalized === publicOrigin.toLowerCase()) return true;
  if (requestHost) {
    const hostHeader = String(requestHost).trim().toLowerCase();
    if (hostHeader) {
      if (normalized === `http://${hostHeader}` || normalized === `https://${hostHeader}`) {
        return true;
      }
      for (const scheme of ["http", "https"]) {
        try {
          if (normalized === new URL(`${scheme}://${hostHeader}`).origin.toLowerCase()) {
            return true;
          }
        } catch {
          // Ignore malformed Host header.
        }
      }
    }
  }
  return false;
}

const TOKEN_LOGIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ego-browser console</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1117;color:#e6edf3;font:14px/1.5 system-ui,sans-serif}
  form{width:340px;padding:24px;border-radius:12px;background:#161b22;border:1px solid #30363d}
  h1{margin:0 0 8px;font-size:16px}
  p{margin:0 0 14px;color:#8b949e;font-size:13px}
  input{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;margin-bottom:12px}
  button{width:100%;padding:9px;border-radius:8px;border:0;background:#d97757;color:#fff;font-weight:600;cursor:pointer}
</style></head>
<body><form method="GET" action="/">
  <h1>ego-browser console</h1>
  <p>Enter your console token to connect.</p>
  <input type="password" name="token" placeholder="EGO_CONSOLE_TOKEN" autofocus required />
  <button type="submit">Unlock Console</button>
</form></body></html>`;

/**
 * Start the unified TaskSpace + noVNC console server.
 * Supports legacy `startSpacesServer(shim)` and `--console` mode options.
 */
export async function startSpacesServer(initialShim, options = {}) {
  const host = options.host || "127.0.0.1";
  const port = Number(options.port ?? 0);
  const token = (options.token ?? process.env.EGO_CONSOLE_TOKEN ?? "").trim();
  const publicUrl = (options.publicUrl ?? process.env.EGO_CONSOLE_PUBLIC_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  let publicOrigin = null;
  if (publicUrl) {
    try {
      publicOrigin = new URL(publicUrl).origin;
    } catch {
      publicOrigin = null;
    }
  }
  const vnc = parseUpstream(options.vncUpstream ?? process.env.EGO_VNC_UPSTREAM ?? "");
  const reconnectFn = typeof options.reconnect === "function" ? options.reconnect : null;

  let currentShim = initialShim || null;
  let currentPool = currentShim ? createCastPool(currentShim.cdp) : null;
  let reconnectInflight = null;
  const activeUpgradeSockets = new Set();

  function resetShim() {
    const pool = currentPool;
    const shim = currentShim;
    currentPool = null;
    currentShim = null;
    if (pool) {
      try { pool.closeAll(); } catch {}
    }
    if (shim) {
      try { shim.close(); } catch {}
    }
  }

  async function getActiveRuntime() {
    if (currentShim && currentPool) {
      return { shim: currentShim, pool: currentPool };
    }
    if (!reconnectFn) return null;
    if (!reconnectInflight) {
      reconnectInflight = (async () => {
        try {
          const next = await reconnectFn();
          currentShim = next;
          currentPool = createCastPool(next.cdp);
          return { shim: currentShim, pool: currentPool };
        } finally {
          reconnectInflight = null;
        }
      })();
    }
    return reconnectInflight;
  }

  async function withShim(fn) {
    const active = await getActiveRuntime();
    if (!active) throw new Error("browser CDP is not connected");
    try {
      return await fn(active);
    } catch (error) {
      const msg = String(error?.message || "");
      if (
        reconnectFn &&
        /browser connection closed|CDP channel is not open|WebSocket/i.test(msg)
      ) {
        resetShim();
        const fresh = await getActiveRuntime();
        return await fn(fresh);
      }
      throw error;
    }
  }

  function isAuthorized(request, url) {
    if (!token) return true;
    const auth = request.headers.authorization || "";
    if (auth.startsWith("Bearer ") && tokensEqual(auth.slice(7).trim(), token)) {
      return true;
    }
    const cookies = parseCookies(request.headers.cookie);
    if (cookies.ego_console_token && tokensEqual(cookies.ego_console_token, token)) {
      return true;
    }
    const queryToken = url?.searchParams?.get("token");
    if (queryToken && tokensEqual(queryToken, token)) {
      return true;
    }
    return false;
  }

  function proxyVncHttp(request, response, upstreamPath) {
    const upstreamReq = httpRequest(
      {
        host: vnc.host,
        port: vnc.port,
        method: request.method,
        path: upstreamPath,
        headers: {
          ...request.headers,
          host: `${vnc.host}:${vnc.port}`,
        },
      },
      (upstreamRes) => {
        response.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(response);
      },
    );
    upstreamReq.on("error", () => {
      if (!response.headersSent) {
        json(response, 502, { error: "noVNC upstream unavailable" });
      } else {
        response.destroy();
      }
    });
    request.on("aborted", () => upstreamReq.destroy());
    response.on("close", () => {
      if (!response.writableEnded) upstreamReq.destroy();
    });
    if (request.readableEnded) upstreamReq.end();
    else request.pipe(upstreamReq);
  }

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin, publicOrigin, request.headers.host)) {
      json(response, 403, { error: "cross-origin request refused" });
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");

    // Token bootstrap via GET /?token=... sets an HttpOnly cookie and redirects cleanly.
    if (token && request.method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
      if (!tokensEqual(url.searchParams.get("token"), token)) {
        response.writeHead(401, { "content-type": "text/html; charset=utf-8" });
        response.end(TOKEN_LOGIN_HTML);
        return;
      }
      url.searchParams.delete("token");
      const cleanPath = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "");
      const forwardedProto = String(request.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        .trim()
        .toLowerCase();
      const secureFlag =
        publicUrl.startsWith("https://") || forwardedProto === "https" ? "; Secure" : "";
      response.writeHead(302, {
        "Set-Cookie": `ego_console_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/${secureFlag}`,
        Location: cleanPath || "/",
      });
      response.end();
      return;
    }

    if (!isAuthorized(request, url)) {
      if (url.pathname === "/") {
        response.writeHead(401, { "content-type": "text/html; charset=utf-8" });
        response.end(TOKEN_LOGIN_HTML);
        return;
      }
      json(response, 401, { error: "unauthorized" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      const html = SPACES_HTML.replace(
        "__EGO_CONSOLE_CONFIG__",
        JSON.stringify({ vncEnabled: Boolean(vnc) }),
      );
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(html),
        "cache-control": "no-store",
      });
      response.end(html);
      return;
    }

    if (vnc && (url.pathname === "/vnc" || url.pathname.startsWith("/vnc/"))) {
      if (url.pathname === "/vnc") {
        response.writeHead(302, { Location: "/vnc/vnc.html?autoconnect=true&resize=scale&path=vnc/websockify" });
        response.end();
        return;
      }
      const stripped = url.pathname.slice(4) + url.search;
      proxyVncHttp(request, response, stripped || "/");
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      let chromeConnected = false;
      let cdpUrl = null;
      let pageCount = 0;
      try {
        await withShim(async ({ shim }) => {
          await shim.cdp.call("Browser.getVersion");
          chromeConnected = true;
          cdpUrl = shim.wsUrl || null;
          try {
            const { targetInfos = [] } = await shim.cdp.call("Target.getTargets");
            pageCount = targetInfos.filter(
              (target) =>
                target.type === "page" && !String(target.url || "").startsWith("devtools://"),
            ).length;
          } catch {
            pageCount = 0;
          }
        });
      } catch {
        chromeConnected = false;
      }
      json(response, 200, {
        ok: true,
        chromeConnected,
        cdpUrl,
        pageCount,
        vncEnabled: Boolean(vnc),
        authEnabled: Boolean(token),
        publicUrl: publicUrl || null,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/browser/reopen") {
      try {
        const result = await withShim(async ({ shim }) => {
          if (shim.panel?.reopenBrowser) {
            return shim.panel.reopenBrowser();
          }
          const created = await shim.cdp.call("Target.createTarget", {
            url: "about:blank",
            newWindow: true,
          });
          return { done: true, action: "created", targetId: created?.targetId || null };
        });
        json(response, 200, result);
      } catch (error) {
        json(response, 503, { error: error?.message || "failed to reopen browser window" });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/profiles") {
      try {
        const result = await withShim(({ shim }) => shim.ego.listProfiles());
        json(response, 200, result);
      } catch (error) {
        json(response, 503, { error: error?.message || "profiles unavailable" });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/spaces") {
      try {
        const spaces = await withShim(async ({ shim, pool }) => {
          const { ego, cdp, panel } = shim;
          const detailed = panel?.listDetailed
            ? await panel.listDetailed()
            : (await ego.listTaskSpaces()).taskSpaces || [];
          const { targetInfos = [] } = await cdp.call("Target.getTargets");
          const byTarget = new Map(
            targetInfos
              .filter((target) => target.type === "page")
              .map((target) => [target.targetId, target]),
          );
          await pool.retain(new Set(byTarget.keys()));

          return Promise.all(
            detailed.map(async (space) => {
              const liveIds = (space.targetIds || space.tabs?.map((t) => t.targetId) || []).filter(
                (id) => byTarget.has(id),
              );
              const tabs =
                space.tabs ||
                liveIds.map((id, idx) => ({
                  targetId: id,
                  title: byTarget.get(id)?.title || "",
                  url: byTarget.get(id)?.url || "",
                  active: space.activeTargetId ? id === space.activeTargetId : idx === 0,
                }));
              const activeTab = tabs.find((t) => t.active) || tabs[0] || null;
              const activeTargetId =
                activeTab?.targetId || space.activeTargetId || liveIds[0] || null;
              const lead =
                activeTargetId && byTarget.has(activeTargetId) ? activeTargetId : liveIds[0];
              const card = lead
                ? await captureCard(cdp, lead, pool)
                : { thumbnail: null, activity: null, trail: [] };
              return {
                id: space.id,
                name: space.name,
                ownership: space.ownership,
                profile: space.profile || null,
                profileId: space.profileId || "Default",
                profileName: space.profileName || "Default",
                profileKind: space.profileKind || "persistent",
                agent: space.agent || null,
                session: space.session || null,
                activeTargetId,
                tabCount: tabs.length,
                tabs,
                title: activeTab?.title || "",
                url: activeTab?.url || "",
                thumbnail: card.thumbnail,
                activity: card.activity,
                trail: card.trail,
              };
            }),
          );
        });
        json(response, 200, { spaces });
      } catch (error) {
        json(response, 503, { error: error?.message || "browser unavailable", spaces: [] });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/spaces") {
      try {
        const { name, profileId } = await readBody(request);
        const cleanName = typeof name === "string" ? name.trim() : "";
        const space = await withShim(async ({ shim }) => {
          if (shim.panel?.create) {
            return shim.panel.create(cleanName, profileId);
          }
          return shim.ego.createTaskSpace(cleanName || "Space", profileId);
        });
        json(response, 200, { space });
      } catch (error) {
        json(response, 400, { error: error?.message || "failed to create space" });
      }
      return;
    }

    const createTabMatch = /^\/api\/spaces\/(\d+)\/tabs$/.exec(url.pathname);
    if (request.method === "POST" && createTabMatch) {
      const id = Number(createTabMatch[1]);
      const body = await readBody(request);
      try {
        const tab = await withShim(async ({ shim }) => {
          if (!shim.panel?.createTab) throw new Error("createTab is not supported");
          return shim.panel.createTab(id, body.url);
        });
        json(response, 200, { tab });
      } catch (error) {
        json(response, 400, { error: error?.message || "failed to create tab" });
      }
      return;
    }

    const closeTabMatch = /^\/api\/spaces\/(\d+)\/tabs\/close$/.exec(url.pathname);
    if (request.method === "POST" && closeTabMatch) {
      const id = Number(closeTabMatch[1]);
      const body = await readBody(request);
      try {
        const result = await withShim(async ({ shim }) => {
          if (!shim.panel?.closeTab) throw new Error("closeTab is not supported");
          return shim.panel.closeTab(id, body.targetId);
        });
        json(response, 200, result || { done: true });
      } catch (error) {
        json(response, 400, { error: error?.message || "failed to close tab" });
      }
      return;
    }

    const navigateMatch = /^\/api\/spaces\/(\d+)\/navigate$/.exec(url.pathname);
    if (request.method === "POST" && navigateMatch) {
      const id = Number(navigateMatch[1]);
      const body = await readBody(request);
      if (!body.url && !body.action) {
        json(response, 400, { error: "url or action is required" });
        return;
      }
      try {
        const result = await withShim(async ({ shim }) => {
          if (!shim.panel?.navigate) throw new Error("navigate is not supported");
          return shim.panel.navigate(id, {
            targetId: body.targetId,
            url: body.url,
            action: body.action,
          });
        });
        json(response, 200, result || { done: true });
      } catch (error) {
        json(response, 400, { error: error?.message || "navigation failed" });
      }
      return;
    }

    const keyMatch = /^\/api\/spaces\/(\d+)\/key$/.exec(url.pathname);
    if (request.method === "POST" && keyMatch) {
      const id = Number(keyMatch[1]);
      const body = await readBody(request);
      if (!body.key && !body.command) {
        json(response, 400, { error: "key is required" });
        return;
      }
      try {
        const result = await withShim(async ({ shim }) => {
          if (!shim.panel?.sendKey) throw new Error("sendKey is not supported");
          return shim.panel.sendKey(id, {
            targetId: body.targetId,
            key: body.key,
            code: body.code,
            ctrl: body.ctrl,
            alt: body.alt,
            shift: body.shift,
            meta: body.meta,
            command: body.command,
          });
        });
        json(response, 200, result || { done: true });
      } catch (error) {
        json(response, 400, { error: error?.message || "key dispatch failed" });
      }
      return;
    }

    const match = /^\/api\/spaces\/(\d+)\/(use|focus|close|stop|takeover)$/.exec(url.pathname);
    if (request.method === "POST" && match) {
      const id = Number(match[1]);
      const action = match[2];
      const body = action === "focus" || action === "use" ? await readBody(request) : {};
      try {
        await withShim(async ({ shim }) => {
          const { ego, panel } = shim;
          if (action === "focus" || action === "use") {
            if (panel?.focus) await panel.focus(id, body.targetId);
            else if (panel?.use) await panel.use(id);
            else ego.useTaskSpace(id);
          } else if (action === "stop") {
            if (panel?.handOff) await panel.handOff(id);
            else {
              ego.useTaskSpace(id);
              await ego.handOffTaskSpace();
            }
          } else if (action === "takeover") {
            if (panel?.takeOver) await panel.takeOver(id);
            else {
              ego.useTaskSpace(id);
              await ego.takeOverTaskSpace();
            }
          } else {
            if (panel?.close) await panel.close(id);
            else {
              ego.useTaskSpace(id);
              await ego.closeTaskSpace();
            }
          }
        });
        json(response, 200, { done: true });
      } catch (error) {
        json(response, 400, { error: error?.message || "operation failed" });
      }
      return;
    }

    json(response, 404, { error: "not found" });
  });

  if (vnc) {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (!url.pathname.startsWith("/vnc/")) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      if (!isAllowedOrigin(request.headers.origin, publicOrigin, request.headers.host)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      if (!isAuthorized(request, url)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const upstreamPath = url.pathname.slice(4) + url.search;
      const upstream = netConnect(vnc.port, vnc.host, () => {
        const lines = [`${request.method} ${upstreamPath || "/"} HTTP/${request.httpVersion}`];
        for (let i = 0; i < request.rawHeaders.length; i += 2) {
          const name = request.rawHeaders[i];
          const value = request.rawHeaders[i + 1];
          if (name.toLowerCase() === "host") {
            lines.push(`Host: ${vnc.host}:${vnc.port}`);
          } else {
            lines.push(`${name}: ${value}`);
          }
        }
        lines.push("", "");
        upstream.write(lines.join("\r\n"));
        if (head?.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });

      activeUpgradeSockets.add(socket);
      activeUpgradeSockets.add(upstream);

      const cleanup = () => {
        activeUpgradeSockets.delete(socket);
        activeUpgradeSockets.delete(upstream);
        if (!socket.destroyed) socket.destroy();
        if (!upstream.destroyed) upstream.destroy();
      };
      socket.on("end", cleanup);
      upstream.on("end", () => {
        if (!socket.destroyed) socket.end();
      });
      socket.on("finish", () => {
        if (!socket.destroyed) socket.destroy();
      });
      upstream.on("error", cleanup);
      socket.on("error", cleanup);
      upstream.on("close", cleanup);
      socket.on("close", cleanup);
    });
  }

  await new Promise((resolve) => server.listen(port, host, resolve));
  return {
    port: server.address().port,
    close: () => {
      resetShim();
      for (const sock of activeUpgradeSockets) {
        try { sock.destroy(); } catch {}
      }
      activeUpgradeSockets.clear();
      server.closeAllConnections?.();
      server.close();
    },
  };
}
