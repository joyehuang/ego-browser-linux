import { invalidArgumentError } from "./task-spaces.mjs";

/**
 * listTabs() + createTab().
 *
 * `Target.getTargets` has no tab ordering and no active flag — Chrome's target
 * list comes back in creation order rather than focus order. `/json/list`
 * comes straight from Chrome's TabStripModel in MRU order, so index 0 there is
 * the tab the user or agent actually last activated. Joining the two gives us
 * accurate `active` and `index` fields; when `/json/list` is unreachable (e.g.
 * a `ws://` `EGO_LINUX_CDP_URL` with no port), we fall back cleanly to target
 * creation order and `cdp.activeHint()`.
 */
export function createTabsApi(
  cdp,
  { port, getScope, checkControl, onAdoptTargets } = {},
) {
  /** Tab ids in Chrome's MRU order, or null if the HTTP endpoint isn't reachable. */
  async function mruOrder() {
    if (!port) return null;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok) return null;
      const entries = await response.json();
      return entries.filter((entry) => entry.type === "page").map((entry) => entry.id);
    } catch {
      return null;
    }
  }

  return {
    async listTabs(...args) {
      if (args.length > 0) {
        throw invalidArgumentError("listTabs takes no arguments");
      }
      if (checkControl) {
        const blocked = await checkControl();
        if (blocked) return blocked;
      }

      const { targetInfos = [] } = await cdp.call("Target.getTargets");
      let pages = targetInfos.filter(
        (target) => target.type === "page" && !target.url.startsWith("devtools://"),
      );

      const scope = getScope ? await getScope() : null;
      if (scope) {
        const scoped = [];
        const adopted = [];
        let progress = true;
        const remaining = [...pages];
        while (progress) {
          progress = false;
          for (let i = 0; i < remaining.length; i += 1) {
            const target = remaining[i];
            if (!target) continue;
            let matches = false;
            if (scope.browserContextId) {
              matches = target.browserContextId === scope.browserContextId;
            } else if (scope.targetIds.has(target.targetId)) {
              matches = true;
            } else if (target.openerId && scope.targetIds.has(target.openerId)) {
              matches = true;
              scope.targetIds.add(target.targetId);
              adopted.push(target.targetId);
            }
            if (matches) {
              scoped.push(target);
              remaining[i] = null;
              progress = true;
            }
          }
        }
        if (adopted.length > 0 && onAdoptTargets && scope.spaceId !== undefined) {
          await onAdoptTargets(scope.spaceId, adopted);
        }
        pages = scoped;
      }

      const order = await mruOrder();
      if (order) {
        const rank = new Map(order.map((id, index) => [id, index]));
        pages.sort(
          (a, b) =>
            (rank.get(a.targetId) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(b.targetId) ?? Number.MAX_SAFE_INTEGER),
        );
      }

      const hinted = cdp.activeHint?.();
      const activeId =
        hinted && pages.some((target) => target.targetId === hinted)
          ? hinted
          : pages[0]?.targetId;
      return {
        tabs: pages.map((target, index) => ({
          targetId: target.targetId,
          title: target.title || "",
          url: target.url || "",
          active: target.targetId === activeId,
          index,
        })),
      };
    },

    async createTab(url = "about:blank", browserContextId = undefined) {
      if (typeof url !== "string") {
        throw invalidArgumentError("createTab requires a string url");
      }
      const { targetId } = await cdp.call("Target.createTarget", {
        url,
        ...(browserContextId ? { browserContextId } : {}),
      });
      if (!targetId) throw new Error("Target.createTarget returned no targetId");
      await cdp.call("Target.activateTarget", { targetId }).catch(() => {});
      return { targetId };
    },
  };
}
