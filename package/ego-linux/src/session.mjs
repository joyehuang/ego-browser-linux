/**
 * Which page the shim's own CDP calls should act on.
 */
export function createSessionResolver(cdp, { listTabs, op }) {
  let session = { targetId: null, sessionId: null };

  return async function sessionForActiveTab() {
    let targetId = cdp.attachedHint?.();

    if (!targetId) {
      const result = await listTabs();
      if (result?.error) {
        const err = new Error(result.error);
        if (result.error_code) err.error_code = result.error_code;
        throw err;
      }
      const tabs = result?.tabs || [];
      const active = tabs.find((tab) => tab.active) || tabs[tabs.length - 1];
      if (!active) throw new Error(`${op}: no page tab to attach to`);
      targetId = active.targetId;
    }

    if (session.targetId === targetId && session.sessionId) {
      return session.sessionId;
    }
    const { sessionId } = await cdp.call("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    session = { targetId, sessionId };
    return sessionId;
  };
}
