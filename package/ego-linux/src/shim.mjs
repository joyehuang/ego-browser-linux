import { ensureBrowser } from "./chrome.mjs";
import { connectCdp } from "./transport.mjs";
import { createTabsApi } from "./tabs.mjs";
import { createSnapshotApi } from "./snapshot.mjs";
import {
  consoleUrlForSpace,
  createTaskSpacesApi,
  egoErrorObject,
  invalidArgumentError,
} from "./task-spaces.mjs";
import { createCursorApi } from "./cursor.mjs";
import { createWindowFit } from "./window-fit.mjs";
import { listProfiles } from "./profiles.mjs";

/**
 * Build the `globalThis.ego` object the ego-browser harness expects, backed by a
 * real Chromium/Chrome over CDP instead of the closed-source desktop app.
 */
export async function createEgoShim({ headless = false } = {}) {
  const { wsUrl, port } = await ensureBrowser({ headless });
  const cdp = await connectCdp(wsUrl);

  const taskSpaces = createTaskSpacesApi(cdp);
  cdp.setDownloadContext(() => taskSpaces.selectedContextIdSync());

  const tabs = createTabsApi(cdp, {
    port,
    getScope: () => taskSpaces.selectedScope(),
    checkControl: () => taskSpaces.checkControl(),
    onAdoptTargets: (spaceId, ids) => taskSpaces.adoptTargets(spaceId, ids),
  });
  const snapshot = createSnapshotApi(cdp, {
    listTabs: tabs.listTabs,
    checkControl: () => taskSpaces.checkControl(),
  });
  const cursor = createCursorApi(cdp, { listTabs: tabs.listTabs });

  cdp.watchMouse((params) => {
    if (params.type === "mouseWheel") return;
    if (params.type === "mousePressed") cursor.press(params.x, params.y);
    else if (params.type === "mouseReleased") cursor.release(params.x, params.y);
    else cursor.moveTo(params.x, params.y);
  });

  cdp.watchKeys(() => cursor.typed());

  const windowFit = createWindowFit(cdp);
  cdp.watchViewport((metrics) => {
    void windowFit.follow(metrics, cdp.attachedHint()).catch(() => {});
  });

  cdp.watchNavigation(() => {
    void taskSpaces.noteContent().catch(() => {});
    void cursor.watchPage().catch(() => {});
  });

  function emitSendCdpError(message, errorCode) {
    queueMicrotask(() => {
      ego.onSendCDPMessageError?.(message, errorCode);
    });
  }

  const ego = {
    // --- CDP transport: exact passthrough with control-boundary gate --------
    sendCDPMessage(payload) {
      const blocked = taskSpaces.checkControlSync();
      if (blocked) {
        emitSendCdpError(blocked.error, blocked.error_code);
        return;
      }
      try {
        cdp.sendRaw(payload);
      } catch (error) {
        emitSendCdpError(
          error?.message || "CDP send failed",
          "EGO_CDP_CHANNEL_UNAVAILABLE",
        );
      }
    },
    onCDPMessage: null,
    onSendCDPMessageError: null,

    // --- Profiles -----------------------------------------------------------
    async listProfiles(...args) {
      if (args.length > 0) {
        throw invalidArgumentError("listProfiles takes no arguments");
      }
      return listProfiles();
    },

    // --- Tabs ---------------------------------------------------------------
    listTabs: tabs.listTabs,
    createTab: (url) => taskSpaces.createTabInSelectedSpace(tabs, url),

    // --- Observation --------------------------------------------------------
    async snapshot(options) {
      cursor.reading();
      return snapshot.snapshot(options);
    },

    // --- Task spaces --------------------------------------------------------
    listTaskSpaces: taskSpaces.listTaskSpaces,
    createTaskSpace: taskSpaces.createTaskSpace,
    useTaskSpace(...args) {
      const id = taskSpaces.useTaskSpace(...args);
      void cursor.watchPage().catch(() => {});
      return id;
    },
    claimTaskSpace: taskSpaces.claimTaskSpace,
    async handOffTaskSpace(...args) {
      const result = await taskSpaces.handOffTaskSpace(...args);
      if (typeof result === "string") cursor.hide();
      return result;
    },
    async takeOverTaskSpace(...args) {
      const result = await taskSpaces.takeOverTaskSpace(...args);
      if (typeof result === "string") cursor.show();
      return result;
    },
    completeTaskSpace: taskSpaces.completeTaskSpace,
    closeTaskSpace: taskSpaces.closeTaskSpace,

    // --- UI & Console helpers -----------------------------------------------
    async animationHighlightMouseToPosition(x, y, ...rest) {
      if (rest.length > 0 || typeof x !== "number" || typeof y !== "number") {
        throw invalidArgumentError(
          "animationHighlightMouseToPosition requires numeric (x, y)",
        );
      }
      const blocked = await taskSpaces.checkControl();
      if (blocked) return blocked;
      return cursor.moveTo(x, y);
    },
    async setAgentTaskState(taskState, ...rest) {
      if (rest.length > 0 || typeof taskState !== "string") {
        throw invalidArgumentError("setAgentTaskState requires a string state");
      }
      const blocked = await taskSpaces.checkControl();
      if (blocked) return blocked;
      return cursor.setTaskState(taskState);
    },
    consoleUrl(spaceId) {
      return consoleUrlForSpace(spaceId);
    },

    highlight: (target, options) => cursor.highlight(target, options),
    clearHighlight: () => cursor.clearHighlight(),
    hideCursor: () => cursor.hide(),
    showCursor: () => cursor.show(),

    // --- App lifecycle ------------------------------------------------------
    async getBrowserVersion(...args) {
      if (args.length > 0) {
        throw invalidArgumentError("getBrowserVersion takes no arguments");
      }
      const version = await cdp.call("Browser.getVersion").catch(() => ({}));
      return {
        currentVersion: "2.2.1-linux",
        updateAvailable: false,
        product: version.product,
        revision: version.revision,
        linuxPort: true,
      };
    },
    async upgradeBrowser() {
      return { done: false, reason: "not applicable on the Linux port" };
    },
  };

  cdp.bind(ego);
  return {
    ego,
    cdp,
    panel: taskSpaces.panel,
    close: () => cdp.close(),
    port,
    wsUrl,
  };
}

export { egoErrorObject, invalidArgumentError };
