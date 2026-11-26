import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";

import { agentHostLabel, agentIdentity } from "./agent-identity.mjs";
import { STATE_DIR, TASK_SPACE_FILE } from "./paths.mjs";
import { resolveProfile } from "./profiles.mjs";
import { withFileLock, withFileLockSync } from "./state-lock.mjs";

/**
 * Task spaces backed by persistent Default profile or isolated Chromium
 * BrowserContexts, synchronized across concurrent CLI processes via file lock.
 */

function emptyState() {
  return { spaces: [], selectedId: null, nextId: 1, closedSpaces: [] };
}
const TASK_SPACE_LOCK = `${TASK_SPACE_FILE}.lock`;
const REMEMBERED_CLOSURES = 20;
const ABANDONED_AFTER_MS = 120000;

export function invalidArgumentError(message) {
  const error = new TypeError(message);
  error.error_code = "EGO_INVALID_ARGUMENT";
  return error;
}

export function egoErrorObject(error, error_code) {
  return { error, error_code };
}

export function egoRejectedError(message, error_code) {
  const error = new Error(message);
  error.error_code = error_code;
  return error;
}

function isolateContextsEnabled() {
  return ["1", "true", "yes", "on"].includes(
    (process.env.EGO_LINUX_ISOLATE_CONTEXTS || "0").trim().toLowerCase(),
  );
}

function isValidSpaceId(id) {
  return typeof id === "number" && Number.isFinite(id) && Number.isInteger(id) && id >= 0;
}

function validateSpaceId(id, op) {
  if (!isValidSpaceId(id)) {
    throw invalidArgumentError(`${op} requires a numeric task space id`);
  }
}

function normalizePanelUrl(rawUrl, defaultUrl = "about:blank") {
  if (rawUrl === undefined || rawUrl === null) return defaultUrl;
  const trimmed = String(rawUrl).trim();
  if (!trimmed) return defaultUrl;
  if (trimmed.startsWith("about:") || trimmed.includes("://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function resolveActiveTargetId(space) {
  const ids = space?.targetIds || [];
  if (space?.activeTargetId && ids.includes(space.activeTargetId)) {
    return space.activeTargetId;
  }
  return ids[0] || null;
}

export function consoleUrlForSpace(spaceId) {
  const port = process.env.EGO_CONSOLE_PORT || process.env.EGO_NOVNC_PORT || "6080";
  const publicUrl = (process.env.EGO_CONSOLE_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  const query =
    spaceId !== undefined && spaceId !== null
      ? `?space=${encodeURIComponent(String(spaceId))}`
      : "";
  if (publicUrl) {
    const token = (process.env.EGO_CONSOLE_TOKEN || "").trim();
    const includeToken = process.env.EGO_CONSOLE_INCLUDE_TOKEN_IN_URL === "1";
    const tokenSuffix =
      token && includeToken && query
        ? `&token=${encodeURIComponent(token)}`
        : token && includeToken
          ? `?token=${encodeURIComponent(token)}`
          : "";
    return `${publicUrl}/${query}${tokenSuffix}`;
  }
  return `http://127.0.0.1:${port}/${query}`;
}

export function formatHandoffNotice(spaceId) {
  const port = process.env.EGO_CONSOLE_PORT || process.env.EGO_NOVNC_PORT || "6080";
  const host = process.env.EGO_SSH_HOST || hostname();
  const url = consoleUrlForSpace(spaceId);
  const publicUrl = (process.env.EGO_CONSOLE_PUBLIC_URL || "").trim();
  const isLocal =
    !publicUrl &&
    (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:"));
  if (isLocal) {
    return (
      `[ego-browser] Task space ${spaceId} handed off to user.\n` +
      `  Console URL: ${url}\n` +
      `  SSH forward: ssh -N -L ${port}:127.0.0.1:${port} ${host}\n`
    );
  }
  return `[ego-browser] Task space ${spaceId} handed off to user.\n  Console URL: ${url}\n`;
}

export function createTaskSpacesApi(cdp) {
  let pinnedSpaceId = null;

  function effectiveSelectedId(state) {
    if (pinnedSpaceId !== null) return pinnedSpaceId;
    return state.selectedId ?? null;
  }

  function readStateSync() {
    try {
      const parsed = JSON.parse(readFileSync(TASK_SPACE_FILE, "utf8"));
      return { ...emptyState(), ...parsed };
    } catch {
      return emptyState();
    }
  }

  let writeSeq = 0;

  function writeStateSync(state) {
    mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${TASK_SPACE_FILE}.${process.pid}.${++writeSeq}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
      renameSync(tmp, TASK_SPACE_FILE);
    } catch (err) {
      try { unlinkSync(tmp); } catch {}
      throw err;
    }
  }

  async function livePageTargets() {
    const { targetInfos = [] } = await cdp.call("Target.getTargets");
    const live = new Map();
    for (const target of targetInfos) {
      if (target.type === "page" && !target.url.startsWith("devtools://")) {
        live.set(target.targetId, target);
      }
    }
    return live;
  }

  function readoptRestoredPages(state, live) {
    if (state.spaces.length === 0) return false;
    if (
      state.spaces.some((space) => (space.targetIds || []).some((id) => live.has(id)))
    ) {
      return false;
    }

    const claimed = new Set();
    let changed = false;
    for (const space of state.spaces) {
      const wanted = new Set(space.urls || []);
      if (wanted.size === 0) continue;
      const matches = [...live.values()].filter(
        (target) => !claimed.has(target.targetId) && wanted.has(target.url),
      );
      if (matches.length === 0) continue;
      for (const target of matches) claimed.add(target.targetId);
      space.targetIds = matches.map((target) => target.targetId);
      space.activeTargetId = space.targetIds[0] || null;
      if (space.browserContextId) space.browserContextId = null;
      space.restored = true;
      changed = true;
    }
    return changed;
  }

  function adoptOpenerChildren(state, live) {
    const claimed = new Set();
    for (const space of state.spaces) {
      for (const id of space.targetIds || []) claimed.add(id);
    }

    let changed = false;
    let progress = true;
    while (progress) {
      progress = false;
      for (const space of state.spaces) {
        const owned = new Set(space.targetIds || []);
        for (const [targetId, target] of live.entries()) {
          if (claimed.has(targetId)) continue;
          if (space.browserContextId) {
            if (target.browserContextId !== space.browserContextId) continue;
          } else if (!target.openerId || !owned.has(target.openerId)) {
            continue;
          }
          space.targetIds.push(targetId);
          owned.add(targetId);
          claimed.add(targetId);
          changed = true;
          progress = true;
        }
      }
    }
    return changed;
  }

  async function pruneAbandoned(state, live) {
    const doomed = state.spaces.filter((space) => {
      if (space.id === effectiveSelectedId(state)) return false;
      if (space.ownership === "user" || space.ownership === "agentDelegatedToUser") {
        return false;
      }
      if (space.lastContentAt) return false;
      if (!space.createdAt || Date.now() - space.createdAt < ABANDONED_AFTER_MS) return false;
      const tabs = (space.targetIds || []).map((id) => live.get(id)).filter(Boolean);
      if (tabs.length === 0) return false;
      return tabs.every((target) => target.url === "about:blank");
    });
    if (doomed.length === 0) return false;

    for (const space of doomed) {
      for (const targetId of space.targetIds) {
        await cdp.call("Target.closeTarget", { targetId }).catch(() => {});
      }
      if (space.browserContextId) await disposeContext(space.browserContextId);
    }
    const gone = new Set(doomed.map((space) => space.id));
    state.spaces = state.spaces.filter((space) => !gone.has(space.id));
    return true;
  }

  async function pruneIdle(state) {
    const idleMinutes = Number(process.env.EGO_LINUX_SPACE_IDLE_MIN ?? 30);
    const idleAfterMs =
      Number.isFinite(idleMinutes) && idleMinutes > 0 ? idleMinutes * 60000 : 0;
    if (!idleAfterMs) return false;
    const now = Date.now();
    let stamped = false;
    const doomed = state.spaces.filter((space) => {
      if (space.id === effectiveSelectedId(state)) return false;
      if (
        space.ownership === "user" ||
        space.ownership === "agentDelegatedToUser"
      ) {
        return false;
      }
      if (!space.touchedAt) {
        space.touchedAt = now;
        stamped = true;
        return false;
      }
      return now - space.touchedAt >= idleAfterMs;
    });
    if (doomed.length === 0) return stamped;

    for (const space of doomed) {
      for (const targetId of space.targetIds || []) {
        await cdp.call("Target.closeTarget", { targetId }).catch(() => {});
      }
      if (space.browserContextId) await disposeContext(space.browserContextId);
    }

    const closures = state.closedSpaces || [];
    for (const space of doomed) {
      closures.unshift({
        name: space.name,
        urls: (space.urls || []).filter((url) => url && url !== "about:blank"),
        closedAt: now,
        idleMinutes: Math.round((now - space.touchedAt) / 60000),
      });
    }
    state.closedSpaces = closures.slice(0, REMEMBERED_CLOSURES);

    const gone = new Set(doomed.map((space) => space.id));
    state.spaces = state.spaces.filter((space) => !gone.has(space.id));
    return true;
  }

  async function reconcile(state) {
    const live = await livePageTargets();
    let changed = false;

    if (readoptRestoredPages(state, live)) changed = true;
    if (adoptOpenerChildren(state, live)) changed = true;

    for (const space of state.spaces) {
      const alive = (space.targetIds || []).filter((id) => live.has(id));
      if (alive.length !== (space.targetIds || []).length) {
        space.targetIds = alive;
        changed = true;
      }
      if (alive.length > 0) {
        if (!space.activeTargetId || !alive.includes(space.activeTargetId)) {
          space.activeTargetId = alive[0];
          changed = true;
        }
        const urls = alive.map((id) => live.get(id)?.url).filter(Boolean);
        if (!space.lastContentAt && urls.some((url) => url !== "about:blank")) {
          space.lastContentAt = Date.now();
          changed = true;
        }
        if (JSON.stringify(urls) !== JSON.stringify(space.urls || [])) {
          space.urls = urls;
          changed = true;
        }
      }
    }

    const before = state.spaces.length;
    const survivors = [];
    for (const space of state.spaces) {
      if ((space.targetIds || []).length > 0) {
        survivors.push(space);
      } else if (space.browserContextId) {
        await disposeContext(space.browserContextId);
      }
    }
    state.spaces = survivors;
    if (state.spaces.length !== before) changed = true;
    if (await pruneAbandoned(state, live)) changed = true;
    if (await pruneIdle(state)) changed = true;
    if (
      state.selectedId &&
      !state.spaces.some((space) => space.id === state.selectedId)
    ) {
      state.selectedId = null;
      changed = true;
    }

    if (changed) writeStateSync(state);
    return { state, live };
  }

  function spaceDescriptor(space) {
    return {
      id: space.id,
      taskId: space.name,
      name: space.name,
      ownership: space.ownership || "agent",
      createdBy: space.createdBy || "agent",
      profileId: space.profileId ?? "Default",
      profileName: space.profileName ?? "Default (Persistent)",
      profileKind: space.profileKind ?? (space.browserContextId ? "isolated" : "persistent"),
      ...(space.agent ? { agent: space.agent } : {}),
      ...(space.previously ? { previously: space.previously } : {}),
    };
  }

  function decorate(space, live) {
    const name = space.name ?? "";
    const recentTabTitles = (space.targetIds || [])
      .map((id) => live.get(id)?.title || "")
      .filter(Boolean);
    return {
      ...space,
      taskId: name,
      name,
      createdBy: space.createdBy ?? "agent",
      ownership: space.ownership ?? "agent",
      profileId: space.profileId ?? "Default",
      profileName: space.profileName ?? "Default (Persistent)",
      profileKind:
        space.profileKind ?? (space.browserContextId ? "isolated" : "persistent"),
      ...(space.agent ? { agent: space.agent } : {}),
      recentTabTitles,
    };
  }

  function inspectSelectionControl(state) {
    const selectedId = effectiveSelectedId(state);
    if (selectedId === null || selectedId === undefined) {
      return {
        error: egoErrorObject(
          "Task space not selected",
          "EGO_TASK_SPACE_NOT_SELECTED",
        ),
      };
    }
    const space = state.spaces.find((candidate) => candidate.id === selectedId);
    if (!space) {
      return {
        error: egoErrorObject(
          `Task space not found: ${selectedId}`,
          "EGO_TASK_SPACE_NOT_FOUND",
        ),
      };
    }
    if (
      space.ownership === "agentDelegatedToUser" ||
      space.ownership === "user"
    ) {
      return {
        error: egoErrorObject("manual_takeover", "EGO_TASK_SPACE_USER_IN_CONTROL"),
        space,
      };
    }
    return { space };
  }

  function defaultSpaceName(id, profile) {
    if (profile?.kind === "isolated") return `Isolated #${id}`;
    if (profile?.kind === "isolated-seeded") return `Seeded #${id}`;
    return `Space #${id}`;
  }

  async function ensureVisibleWindow(targetId) {
    try {
      const win = await cdp.call("Browser.getWindowForTarget", { targetId });
      if (win?.windowId && win?.bounds?.windowState === "minimized") {
        await cdp
          .call("Browser.setWindowBounds", {
            windowId: win.windowId,
            bounds: { windowState: "normal" },
          })
          .catch(() => {});
      }
    } catch {
      // mock CDP or older Chrome without Browser.getWindowForTarget
    }
  }

  async function createTargetSafe(params, { forceNewWindow = false } = {}) {
    if (forceNewWindow) {
      try {
        return await cdp.call("Target.createTarget", { ...params, newWindow: true });
      } catch (error) {
        if (/browser context/i.test(String(error?.message))) {
          throw error;
        }
        return await cdp.call("Target.createTarget", params);
      }
    }
    try {
      return await cdp.call("Target.createTarget", params);
    } catch (error) {
      if (/browser context/i.test(String(error?.message))) {
        throw error;
      }
      return await cdp.call("Target.createTarget", { ...params, newWindow: true });
    }
  }

  async function focusSpace(space, requestedTargetId = undefined, { bringToFront = false } = {}) {
    const targetId =
      requestedTargetId && (space.targetIds || []).includes(requestedTargetId)
        ? requestedTargetId
        : resolveActiveTargetId(space);
    if (!targetId) return;
    await cdp.call("Target.activateTarget", { targetId }).catch(() => {});
    if (bringToFront) {
      await ensureVisibleWindow(targetId);
      let sessionId = null;
      try {
        ({ sessionId } = await cdp.call("Target.attachToTarget", {
          targetId,
          flatten: true,
        }));
        if (sessionId) {
          await cdp.call("Page.bringToFront", {}, sessionId).catch(() => {});
        }
      } catch {
        // best-effort OS window raise
      } finally {
        if (sessionId) {
          await cdp.call("Target.detachFromTarget", { sessionId }).catch(() => {});
        }
      }
    }
  }

  function resolvePanelTarget(id, requestedTargetId) {
    const state = readStateSync();
    const space = state.spaces.find((candidate) => candidate.id === Number(id));
    if (!space) {
      throw new Error(`task space not found: ${id}`);
    }
    const ids = space.targetIds || [];
    const hasRequested =
      requestedTargetId !== undefined &&
      requestedTargetId !== null &&
      String(requestedTargetId).trim() !== "";
    const targetId = hasRequested
      ? ids.includes(String(requestedTargetId).trim())
        ? String(requestedTargetId).trim()
        : null
      : resolveActiveTargetId(space);
    if (!targetId) {
      throw new Error(
        `tab not found in task space ${id}: ${hasRequested ? requestedTargetId : "none"}`,
      );
    }
    return { space, targetId };
  }

  async function selectedContextId() {
    const state = readStateSync();
    const id = effectiveSelectedId(state);
    if (id === null || id === undefined) return null;
    const space = state.spaces.find((candidate) => candidate.id === id);
    return space?.browserContextId || null;
  }

  async function blankAnchor(space) {
    const ids = space.targetIds || [];
    if (ids.length !== 1) return null;
    const live = await livePageTargets().catch(() => new Map());
    const target = live.get(ids[0]);
    return target && target.url === "about:blank" ? target.targetId : null;
  }

  async function disposeContext(browserContextId) {
    await cdp
      .call("Target.disposeBrowserContext", { browserContextId })
      .catch(() => {});
  }

  async function createBrowserContextForProfile(profile) {
    if (profile.kind === "persistent") {
      // Legacy opt-in env flag still creates a seeded context when caller omits profileId.
      if (profile.id === "Default" && isolateContextsEnabled()) {
        return createSeededContext();
      }
      return null;
    }

    let browserContextId;
    try {
      ({ browserContextId } = await cdp.call("Target.createBrowserContext", {}));
    } catch {
      return null;
    }
    if (!browserContextId) return null;

    if (profile.kind === "isolated-seeded") {
      try {
        const { cookies } = await cdp.call("Storage.getCookies", {});
        if (cookies?.length) {
          await cdp.call("Storage.setCookies", { browserContextId, cookies });
        }
      } catch {
        // best effort cookie seeding
      }
    }
    return browserContextId;
  }

  async function createSeededContext() {
    return createBrowserContextForProfile({
      id: "isolated-seeded",
      kind: "isolated-seeded",
    });
  }

  async function createSpaceInternal(
    name,
    profileId,
    { select = false, focus = false, raise = false, newWindow = false } = {},
  ) {
    const profile = resolveProfile(profileId);
    if (!profile) {
      return { error: egoErrorObject("Profile not found", "EGO_PROFILE_NOT_FOUND") };
    }

    return withFileLock(TASK_SPACE_LOCK, async () => {
      const state = readStateSync();
      const live = await livePageTargets().catch(() => new Map());
      const resolvedName =
        typeof name === "string" && name.trim()
          ? name.trim()
          : defaultSpaceName(state.nextId, profile);
      const browserContextId = await createBrowserContextForProfile(profile);
      let targetId;
      try {
        ({ targetId } = await createTargetSafe(
          {
            url: "about:blank",
            ...(browserContextId ? { browserContextId } : {}),
          },
          { forceNewWindow: Boolean(newWindow) || live.size === 0 },
        ));
      } catch (err) {
        if (browserContextId) await disposeContext(browserContextId);
        return {
          error: egoErrorObject(
            err?.message || "No active browser",
            "EGO_BROWSER_UNAVAILABLE",
          ),
        };
      }
      if (focus) {
        await focusSpace({ targetIds: [targetId], activeTargetId: targetId }, targetId, {
          bringToFront: raise,
        });
      } else {
        await cdp.call("Target.activateTarget", { targetId }).catch(() => {});
      }

      const now = Date.now();
      const space = {
        id: state.nextId,
        taskId: resolvedName,
        name: resolvedName,
        createdAt: now,
        touchedAt: now,
        ownership: process.env.EGO_LINUX_PANEL === "1" ? "user" : "agent",
        createdBy: process.env.EGO_LINUX_PANEL === "1" ? "user" : "agent",
        profileId: profile.id,
        profileName: profile.name,
        profileKind: profile.kind,
        agent: agentHostLabel(),
        ...agentIdentity(),
        browserContextId,
        targetIds: [targetId],
        activeTargetId: targetId,
      };
      state.spaces.push(space);
      state.nextId += 1;
      if (select) {
        state.selectedId = space.id;
        pinnedSpaceId = space.id;
      }

      const closures = state.closedSpaces || [];
      const index = closures.findIndex((entry) => entry.name === space.name);
      if (index !== -1) {
        const [previous] = closures.splice(index, 1);
        state.closedSpaces = closures;
        space.previously = {
          closedAt: previous.closedAt,
          idleMinutes: previous.idleMinutes,
          urls: previous.urls,
          note:
            `a task space named ${JSON.stringify(space.name)} was closed after ` +
            `${previous.idleMinutes} minutes idle; this is a new, empty one. ` +
            (previous.urls.length
              ? `It had these pages open: ${previous.urls.join(", ")}`
              : "It had no pages open."),
        };
      }

      writeStateSync(state);
      return { space };
    });
  }

  return {
    selectedContextId,

    selectedContextIdSync() {
      const state = readStateSync();
      const id = effectiveSelectedId(state);
      if (id === null || id === undefined) return null;
      const space = state.spaces.find((candidate) => candidate.id === id);
      return space?.browserContextId || null;
    },

    checkControlSync() {
      const state = readStateSync();
      return inspectSelectionControl(state).error ?? null;
    },

    async checkControl() {
      const state = readStateSync();
      const check = inspectSelectionControl(state);
      if (check.error) return check.error;
      const now = Date.now();
      if (!check.space.touchedAt || now - check.space.touchedAt >= 5000) {
        await withFileLock(TASK_SPACE_LOCK, () => {
          const fresh = readStateSync();
          const current = fresh.spaces.find((candidate) => candidate.id === check.space.id);
          if (current && (!current.touchedAt || now - current.touchedAt >= 5000)) {
            current.touchedAt = now;
            writeStateSync(fresh);
          }
        });
      }
      return null;
    },

    async noteContent() {
      return withFileLock(TASK_SPACE_LOCK, () => {
        const state = readStateSync();
        const space = state.spaces.find(
          (candidate) => candidate.id === effectiveSelectedId(state),
        );
        if (!space || space.lastContentAt) return;
        space.lastContentAt = Date.now();
        writeStateSync(state);
      });
    },

    async touchSelected() {
      return withFileLock(TASK_SPACE_LOCK, () => {
        const state = readStateSync();
        const space = state.spaces.find(
          (candidate) => candidate.id === effectiveSelectedId(state),
        );
        if (!space) return;
        space.touchedAt = Date.now();
        writeStateSync(state);
      });
    },

    async listTaskSpaces(...args) {
      if (args.length > 0) {
        throw invalidArgumentError("listTaskSpaces takes no arguments");
      }
      const { state, live } = await withFileLock(TASK_SPACE_LOCK, () =>
        reconcile(readStateSync()),
      );
      return { taskSpaces: state.spaces.map((space) => decorate(space, live)) };
    },

    async createTaskSpace(...args) {
      if (args.length < 1 || args.length > 2) {
        throw invalidArgumentError(
          "createTaskSpace requires (name, profileId?)",
        );
      }
      const [name, profileId] = args;
      if (typeof name !== "string" || name.length === 0) {
        throw invalidArgumentError(
          "createTaskSpace requires a non-empty string name",
        );
      }
      if (profileId !== undefined && typeof profileId !== "string") {
        throw invalidArgumentError(
          "createTaskSpace profileId must be a string",
        );
      }

      const created = await createSpaceInternal(name, profileId);
      if (created.error) return created.error;
      return spaceDescriptor(created.space);
    },

    useTaskSpace(...args) {
      if (args.length !== 1) {
        throw invalidArgumentError("useTaskSpace requires a numeric id");
      }
      const [id] = args;
      validateSpaceId(id, "useTaskSpace");
      pinnedSpaceId = id;
      withFileLockSync(TASK_SPACE_LOCK, () => {
        const state = readStateSync();
        state.selectedId = id;
        writeStateSync(state);
      });
      return id;
    },

    async claimTaskSpace(...args) {
      if (args.length < 1 || args.length > 2) {
        throw invalidArgumentError("claimTaskSpace requires (id, name?)");
      }
      const [id, name] = args;
      validateSpaceId(id, "claimTaskSpace");
      if (name !== undefined && typeof name !== "string") {
        throw invalidArgumentError("claimTaskSpace name must be a string");
      }

      const space = await withFileLock(TASK_SPACE_LOCK, () => {
        const state = readStateSync();
        const match = state.spaces.find((candidate) => candidate.id === id);
        if (!match) return null;
        match.ownership = "agent";
        match.touchedAt = Date.now();
        if (name && name.length > 0) match.name = name;
        writeStateSync(state);
        return match;
      });
      if (!space) {
        return egoErrorObject(
          `Task space not found: ${id}`,
          "EGO_TASK_SPACE_NOT_FOUND",
        );
      }
      await focusSpace(space);
      return spaceDescriptor(space);
    },

    async handOffTaskSpace(...args) {
      if (args.length > 0) {
        throw invalidArgumentError("handOffTaskSpace takes no arguments");
      }
      const res = await withFileLock(TASK_SPACE_LOCK, () => {
        const state = readStateSync();
        const selectedId = effectiveSelectedId(state);
        if (selectedId === null || selectedId === undefined) {
          return {
            error: egoErrorObject(
              "Task space not selected",
              "EGO_TASK_SPACE_NOT_SELECTED",
            ),
          };
        }
        const space = state.spaces.find((candidate) => candidate.id === selectedId);
        if (!space) {
          return {
            error: egoErrorObject(
              `Task space not found: ${selectedId}`,
              "EGO_TASK_SPACE_NOT_FOUND",
            ),
          };
        }
        space.ownership = "agentDelegatedToUser";
        space.touchedAt = Date.now();
        writeStateSync(state);
        return { space };
      });
      if (res.error) return res.error;
      await focusSpace(res.space, undefined, { bringToFront: true });
      process.stderr.write(formatHandoffNotice(res.space.id));
      return `${res.space.id} has been handed off to the user. Open: ${consoleUrlForSpace(res.space.id)}`;
    },

    async takeOverTaskSpace(...args) {
      if (args.length > 0) {
        throw invalidArgumentError("takeOverTaskSpace takes no arguments");
      }
      const res = await withFileLock(TASK_SPACE_LOCK, () => {
        const state = readStateSync();
        const selectedId = effectiveSelectedId(state);
        if (selectedId === null || selectedId === undefined) {
          return {
            error: egoErrorObject(
              "Task space not selected",
              "EGO_TASK_SPACE_NOT_SELECTED",
            ),
          };
        }
        const space = state.spaces.find((candidate) => candidate.id === selectedId);
        if (!space) {
          return {
            error: egoErrorObject(
              `Task space not found: ${selectedId}`,
              "EGO_TASK_SPACE_NOT_FOUND",
            ),
          };
        }
        space.ownership = "agent";
        space.touchedAt = Date.now();
        state.selectedId = space.id;
        pinnedSpaceId = space.id;
        writeStateSync(state);
        return { space };
      });
      if (res.error) return res.error;
      await focusSpace(res.space);
      return `${res.space.id} is now under agent control.`;
    },

    async completeTaskSpace(...args) {
      if (args.length > 0) {
        throw invalidArgumentError("completeTaskSpace takes no arguments");
      }
      const res = await withFileLock(TASK_SPACE_LOCK, () => {
        const state = readStateSync();
        const check = inspectSelectionControl(state);
        if (check.error) return { error: check.error };
        check.space.ownership = "user";
        check.space.touchedAt = Date.now();
        writeStateSync(state);
        return { space: check.space };
      });
      if (res.error) return res.error;
      return `${res.space.id} task space completed.`;
    },

    async closeTaskSpace(...args) {
      if (args.length > 0) {
        throw invalidArgumentError("closeTaskSpace takes no arguments");
      }
      const res = await withFileLock(TASK_SPACE_LOCK, async () => {
        const state = readStateSync();
        const check = inspectSelectionControl(state);
        if (check.error) return { error: check.error };
        const { space } = check;
        for (const targetId of space.targetIds || []) {
          await cdp.call("Target.closeTarget", { targetId }).catch(() => {});
        }
        if (space.browserContextId) {
          await disposeContext(space.browserContextId);
        }
        state.spaces = state.spaces.filter((candidate) => candidate.id !== space.id);
        if (state.selectedId === space.id) state.selectedId = null;
        if (pinnedSpaceId === space.id) pinnedSpaceId = null;
        writeStateSync(state);
        return { space };
      });
      if (res.error) return res.error;
      return `${res.space.id} task space closed.`;
    },

    panel: {
      async listDetailed() {
        const { state, live } = await withFileLock(TASK_SPACE_LOCK, () =>
          reconcile(readStateSync()),
        );
        return state.spaces.map((space) => {
          const liveTargets = (space.targetIds || [])
            .map((id) => live.get(id))
            .filter(Boolean);
          const activeTargetId =
            space.activeTargetId &&
            liveTargets.some((target) => target.targetId === space.activeTargetId)
              ? space.activeTargetId
              : liveTargets[0]?.targetId || null;
          const tabs = liveTargets.map((target) => ({
            targetId: target.targetId,
            title: target.title || "",
            url: target.url || "",
            active: target.targetId === activeTargetId,
          }));
          return {
            ...decorate(space, live),
            activeTargetId,
            profile: space.profile || null,
            session: space.session || null,
            createdAt: space.createdAt || null,
            touchedAt: space.touchedAt || null,
            targetIds: space.targetIds || [],
            tabs,
          };
        });
      },

      async create(name, profileId) {
        const normalizedName = typeof name === "string" ? name.trim() : "";
        const created = await createSpaceInternal(
          normalizedName,
          profileId,
          { select: true, focus: true, raise: true, newWindow: true },
        );
        if (created.error) {
          throw new Error(created.error.error || "failed to create space");
        }
        return spaceDescriptor(created.space);
      },

      async reopenBrowser() {
        const { state, live } = await withFileLock(TASK_SPACE_LOCK, () =>
          reconcile(readStateSync()),
        );
        const existing = state.spaces.find((s) => (s.targetIds || []).some((id) => live.has(id)));
        if (existing) {
          const targetId = resolveActiveTargetId(existing);
          await withFileLock(TASK_SPACE_LOCK, () => {
            const fresh = readStateSync();
            const match = fresh.spaces.find((s) => s.id === existing.id);
            if (match) {
              if (targetId) match.activeTargetId = targetId;
              match.touchedAt = Date.now();
              fresh.selectedId = match.id;
              pinnedSpaceId = match.id;
              writeStateSync(fresh);
            }
          });
          await focusSpace(existing, targetId, { bringToFront: true });
          return { done: true, action: "focused", spaceId: existing.id };
        }
        const space = await this.create("", "Default");
        return { done: true, action: "created", space };
      },

      async focus(id, targetId = undefined) {
        const res = await withFileLock(TASK_SPACE_LOCK, () => {
          const state = readStateSync();
          const match = state.spaces.find((candidate) => candidate.id === Number(id));
          if (!match) return null;
          const resolvedTargetId =
            targetId && (match.targetIds || []).includes(targetId)
              ? targetId
              : resolveActiveTargetId(match);
          if (resolvedTargetId) {
            match.activeTargetId = resolvedTargetId;
          }
          match.touchedAt = Date.now();
          state.selectedId = match.id;
          pinnedSpaceId = match.id;
          writeStateSync(state);
          return { space: match, targetId: resolvedTargetId };
        });
        if (!res) throw new Error(`task space not found: ${id}`);
        await focusSpace(res.space, res.targetId, { bringToFront: true });
        return { done: true };
      },

      async use(id) {
        return this.focus(id);
      },

      async createTab(id, url = "about:blank") {
        const normalizedUrl = normalizePanelUrl(url, "about:blank");
        const res = await withFileLock(TASK_SPACE_LOCK, async () => {
          const state = readStateSync();
          const match = state.spaces.find((candidate) => candidate.id === Number(id));
          if (!match) return null;

          const live = await livePageTargets().catch(() => new Map());
          const forceNewWindow = live.size === 0;
          let targetId;
          try {
            ({ targetId } = await createTargetSafe(
              {
                url: normalizedUrl,
                ...(match.browserContextId ? { browserContextId: match.browserContextId } : {}),
              },
              { forceNewWindow },
            ));
          } catch (error) {
            if (!match.browserContextId || !/browser context/i.test(String(error?.message))) {
              throw error;
            }
            ({ targetId } = await createTargetSafe({ url: normalizedUrl }, { forceNewWindow }));
            match.browserContextId = null;
            match.restored = true;
          }

          const now = Date.now();
          match.targetIds = Array.isArray(match.targetIds) ? match.targetIds : [];
          if (targetId && !match.targetIds.includes(targetId)) {
            match.targetIds.push(targetId);
          }
          match.activeTargetId = targetId;
          match.touchedAt = now;
          if (normalizedUrl !== "about:blank") {
            match.lastContentAt = now;
          }
          state.selectedId = match.id;
          pinnedSpaceId = match.id;
          writeStateSync(state);
          return { space: match, targetId };
        });
        if (!res) throw new Error(`task space not found: ${id}`);
        await focusSpace(res.space, res.targetId, { bringToFront: true });
        return { targetId: res.targetId, url: normalizedUrl };
      },

      async closeTab(id, targetId = undefined) {
        const res = await withFileLock(TASK_SPACE_LOCK, async () => {
          const state = readStateSync();
          const match = state.spaces.find((candidate) => candidate.id === Number(id));
          if (!match) return { notFound: true };

          const ids = Array.isArray(match.targetIds) ? match.targetIds : [];
          const hasRequested =
            targetId !== undefined &&
            targetId !== null &&
            String(targetId).trim() !== "";
          const resolvedTargetId = hasRequested
            ? String(targetId).trim()
            : resolveActiveTargetId(match);
          if (!resolvedTargetId || !ids.includes(resolvedTargetId)) {
            return { targetNotFound: resolvedTargetId || "none" };
          }

          await cdp.call("Target.closeTarget", { targetId: resolvedTargetId }).catch(() => {});
          match.targetIds = ids.filter((tid) => tid !== resolvedTargetId);

          if (match.targetIds.length === 0) {
            if (match.browserContextId) await disposeContext(match.browserContextId);
            state.spaces = state.spaces.filter((candidate) => candidate.id !== match.id);
            if (state.selectedId === match.id) state.selectedId = null;
            if (pinnedSpaceId === match.id) pinnedSpaceId = null;
            writeStateSync(state);
            return { spaceClosed: true };
          }

          match.activeTargetId = match.targetIds[0];
          match.touchedAt = Date.now();
          writeStateSync(state);
          return {
            spaceClosed: false,
            space: match,
            activeTargetId: match.activeTargetId,
          };
        });
        if (res.notFound) throw new Error(`task space not found: ${id}`);
        if (res.targetNotFound !== undefined) {
          throw new Error(`tab not found in task space ${id}: ${res.targetNotFound}`);
        }
        if (res.spaceClosed) {
          return { done: true, spaceClosed: true };
        }
        await focusSpace(res.space, res.activeTargetId, { bringToFront: true });
        return { done: true, spaceClosed: false, activeTargetId: res.activeTargetId };
      },

      async navigate(id, { targetId, url, action } = {}) {
        const { space, targetId: resolvedTargetId } = resolvePanelTarget(id, targetId);
        const normalizedAction = typeof action === "string" ? action.trim() : "";
        if (
          normalizedAction &&
          !["reload", "back", "forward"].includes(normalizedAction)
        ) {
          throw new Error(`unsupported navigate action: ${normalizedAction}`);
        }
        const rawUrl = typeof url === "string" ? url.trim() : "";
        const normalizedUrl =
          !normalizedAction && rawUrl ? normalizePanelUrl(rawUrl) : null;
        if (!normalizedAction && !normalizedUrl) {
          throw new Error("navigate requires url or action");
        }

        const { sessionId } = await cdp.call("Target.attachToTarget", {
          targetId: resolvedTargetId,
          flatten: true,
        });
        try {
          if (normalizedAction === "reload") {
            await cdp.call("Page.reload", { ignoreCache: false }, sessionId);
          } else if (normalizedAction === "back" || normalizedAction === "forward") {
            const history = await cdp.call("Page.getNavigationHistory", {}, sessionId);
            const entries = Array.isArray(history?.entries) ? history.entries : [];
            const currentIndex = Number(history?.currentIndex);
            const nextIndex = currentIndex + (normalizedAction === "back" ? -1 : 1);
            if (
              Number.isInteger(nextIndex) &&
              nextIndex >= 0 &&
              nextIndex < entries.length
            ) {
              const entry = entries[nextIndex];
              if (entry && entry.id !== undefined) {
                await cdp.call(
                  "Page.navigateToHistoryEntry",
                  { entryId: entry.id },
                  sessionId,
                );
              }
            }
          } else if (normalizedUrl) {
            await cdp.call("Page.navigate", { url: normalizedUrl }, sessionId);
          }
        } finally {
          if (sessionId) {
            await cdp.call("Target.detachFromTarget", { sessionId }).catch(() => {});
          }
        }

        await withFileLock(TASK_SPACE_LOCK, () => {
          const fresh = readStateSync();
          const current = fresh.spaces.find((candidate) => candidate.id === space.id);
          if (!current) return;
          const now = Date.now();
          current.touchedAt = now;
          current.activeTargetId = resolvedTargetId;
          if (normalizedUrl && normalizedUrl !== "about:blank") {
            current.lastContentAt = now;
          }
          writeStateSync(fresh);
        });

        return { done: true, url: normalizedUrl || null };
      },

      async sendKey(id, { targetId, key, code, ctrl, alt, shift, meta, command } = {}) {
        const { targetId: resolvedTargetId } = resolvePanelTarget(id, targetId);
        if (!key && !command) {
          throw new Error("sendKey requires key or command");
        }
        const modifiers =
          (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);

        const { sessionId } = await cdp.call("Target.attachToTarget", {
          targetId: resolvedTargetId,
          flatten: true,
        });
        try {
          await cdp.call(
            "Input.dispatchKeyEvent",
            {
              type: "rawKeyDown",
              key,
              code: code || undefined,
              modifiers,
              ...(command ? { commands: [command] } : {}),
            },
            sessionId,
          );
          await cdp.call(
            "Input.dispatchKeyEvent",
            {
              type: "keyUp",
              key,
              code: code || undefined,
              modifiers,
            },
            sessionId,
          );
        } finally {
          if (sessionId) {
            await cdp.call("Target.detachFromTarget", { sessionId }).catch(() => {});
          }
        }

        return { done: true };
      },

      async handOff(id) {
        const space = await withFileLock(TASK_SPACE_LOCK, () => {
          const state = readStateSync();
          const match = state.spaces.find((candidate) => candidate.id === Number(id));
          if (!match) return null;
          match.ownership = "agentDelegatedToUser";
          match.touchedAt = Date.now();
          writeStateSync(state);
          return match;
        });
        if (!space) throw new Error(`task space not found: ${id}`);
        await focusSpace(space, undefined, { bringToFront: true });
        return { done: true };
      },

      async takeOver(id) {
        const space = await withFileLock(TASK_SPACE_LOCK, () => {
          const state = readStateSync();
          const match = state.spaces.find((candidate) => candidate.id === Number(id));
          if (!match) return null;
          match.ownership = "agent";
          match.touchedAt = Date.now();
          state.selectedId = match.id;
          pinnedSpaceId = match.id;
          writeStateSync(state);
          return match;
        });
        if (!space) throw new Error(`task space not found: ${id}`);
        await focusSpace(space);
        return { done: true };
      },

      async close(id) {
        const found = await withFileLock(TASK_SPACE_LOCK, async () => {
          const state = readStateSync();
          const match = state.spaces.find((candidate) => candidate.id === Number(id));
          if (!match) return false;
          for (const targetId of match.targetIds || []) {
            await cdp.call("Target.closeTarget", { targetId }).catch(() => {});
          }
          if (match.browserContextId) await disposeContext(match.browserContextId);
          state.spaces = state.spaces.filter((candidate) => candidate.id !== match.id);
          if (state.selectedId === match.id) state.selectedId = null;
          if (pinnedSpaceId === match.id) pinnedSpaceId = null;
          writeStateSync(state);
          return true;
        });
        if (!found) throw new Error(`task space not found: ${id}`);
        return { done: true };
      },
    },

    async selectedScope() {
      const state = readStateSync();
      const id = effectiveSelectedId(state);
      if (id === null || id === undefined) return null;
      const space = state.spaces.find((candidate) => candidate.id === id);
      if (!space) return null;
      return {
        spaceId: space.id,
        browserContextId: space.browserContextId || null,
        targetIds: new Set(space.targetIds || []),
      };
    },

    async adoptTargets(spaceId, targetIds) {
      if (!targetIds?.length) return;
      return withFileLock(TASK_SPACE_LOCK, () => {
        const state = readStateSync();
        const space = state.spaces.find((candidate) => candidate.id === spaceId);
        if (!space) return;
        const existing = new Set(space.targetIds || []);
        let changed = false;
        for (const targetId of targetIds) {
          if (!existing.has(targetId)) {
            space.targetIds.push(targetId);
            existing.add(targetId);
            changed = true;
          }
        }
        if (changed) writeStateSync(state);
      });
    },

    async createTabInSelectedSpace(tabs, url) {
      if (typeof url !== "string") {
        throw invalidArgumentError("createTab requires a string url");
      }
      const pre = await withFileLock(TASK_SPACE_LOCK, () => {
        const state = readStateSync();
        const check = inspectSelectionControl(state);
        if (check.error) return { error: check.error };
        check.space.touchedAt = Date.now();
        writeStateSync(state);
        return { space: check.space };
      });
      if (pre.error) return pre.error;
      const { space } = pre;

      const anchor = !space.lastContentAt ? await blankAnchor(space) : null;
      if (anchor && url && url !== "about:blank") {
        const { sessionId } = await cdp.call("Target.attachToTarget", {
          targetId: anchor,
          flatten: true,
        });
        try {
          await cdp.call("Page.navigate", { url }, sessionId);
        } finally {
          if (sessionId) {
            await cdp.call("Target.detachFromTarget", { sessionId }).catch(() => {});
          }
        }
        await cdp.call("Target.activateTarget", { targetId: anchor }).catch(() => {});
        return { targetId: anchor };
      }

      let result;
      try {
        result = await tabs.createTab(url, space.browserContextId);
      } catch (error) {
        if (!space.browserContextId || !/browser context/i.test(String(error?.message))) {
          throw error;
        }
        result = await tabs.createTab(url);
        await withFileLock(TASK_SPACE_LOCK, () => {
          const state = readStateSync();
          const current = state.spaces.find((candidate) => candidate.id === space.id);
          if (current) {
            current.browserContextId = null;
            current.restored = true;
            writeStateSync(state);
          }
        });
      }
      if (result.targetId) {
        await withFileLock(TASK_SPACE_LOCK, () => {
          const state = readStateSync();
          const current = state.spaces.find((candidate) => candidate.id === space.id);
          if (current) {
            if (!(current.targetIds || []).includes(result.targetId)) {
              current.targetIds.push(result.targetId);
            }
            current.activeTargetId = result.targetId;
            current.touchedAt = Date.now();
            writeStateSync(state);
          }
        });
      }
      return result;
    },
  };
}
