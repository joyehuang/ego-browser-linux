import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { browserInstanceId } from "../src/chrome.mjs";

// The SDK's page ledger keeps only these characters in its file names.
const LEDGER_SCOPE = /^[A-Za-z0-9_-]+$/;

describe("browserInstanceId", () => {
  it("takes the browser target id from the DevTools WebSocket URL", () => {
    const id = browserInstanceId(
      "ws://127.0.0.1:19222/devtools/browser/7884c084-dba4-4dba-a16a-cf6a03d01f41",
    );
    assert.equal(id, "chrome-7884c084-dba4-4dba-a16a-cf6a03d01f41");
    assert.match(id, LEDGER_SCOPE);
  });

  it("is the same for every call against one browser and differs after a restart", () => {
    const before = "ws://127.0.0.1:41000/devtools/browser/aaaa-1111";
    const restarted = "ws://127.0.0.1:41001/devtools/browser/bbbb-2222";
    assert.equal(browserInstanceId(before), browserInstanceId(before));
    assert.notEqual(browserInstanceId(before), browserInstanceId(restarted));
  });

  it("ignores the host and port, which an external endpoint may proxy", () => {
    assert.equal(
      browserInstanceId("wss://cdp.example.test/prefix/devtools/browser/abc-123"),
      browserInstanceId("ws://127.0.0.1:9222/devtools/browser/abc-123"),
    );
  });

  it("keeps the id within the ledger's file-name alphabet", () => {
    const id = browserInstanceId("ws://127.0.0.1:9222/devtools/browser/a.b%20c");
    assert.match(id, LEDGER_SCOPE);
  });

  it("returns null when there is no browser id to read", () => {
    assert.equal(browserInstanceId(undefined), null);
    assert.equal(browserInstanceId("not a url"), null);
    assert.equal(browserInstanceId("ws://127.0.0.1:9222/devtools/page/abc"), null);
    assert.equal(browserInstanceId("ws://127.0.0.1:9222/devtools/browser/"), null);
  });
});
