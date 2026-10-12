import { describe, expect, it } from "vitest";

import { WebAuthSession } from "./webAuth";

describe("WebAuthSession cookie hygiene", () => {
  it("starts clean so empty sessions never overwrite existing cookies", () => {
    // A request whose cookies failed to load must not write an empty snapshot
    // back over the browser's (possibly still valid) auth cookies.
    expect(new WebAuthSession().isDirty()).toBe(false);
  });

  it("restores from snapshot without marking dirty", () => {
    const session = WebAuthSession.fromSnapshot({
      version: 1,
      auth: null,
      attempts: [],
      activeSessionIds: ["stream-a"],
    });
    expect(session.isDirty()).toBe(false);
    expect(session.ownsActiveSession("stream-a")).toBe(true);
  });

  it("caps active session ids (FIFO) to bound cookie growth", () => {
    const session = new WebAuthSession();
    for (let index = 0; index < 25; index += 1) {
      session.addActiveSession(`stream-${index}`);
    }
    const snapshot = session.toSnapshot();
    expect(snapshot.activeSessionIds).toHaveLength(16);
    expect(snapshot.activeSessionIds[0]).toBe("stream-9");
    expect(snapshot.activeSessionIds[15]).toBe("stream-24");
    expect(session.isDirty()).toBe(true);
  });

  it("keeps newest ids when re-adding an already tracked id", () => {
    const session = new WebAuthSession();
    session.addActiveSession("stream-a");
    session.addActiveSession("stream-b");
    session.addActiveSession("stream-a"); // duplicate: no reorder, no growth
    expect(session.toSnapshot().activeSessionIds).toEqual(["stream-a", "stream-b"]);
  });

  it("reduceVolatileState keeps only the newest few ids", () => {
    const session = new WebAuthSession();
    for (let index = 0; index < 10; index += 1) {
      session.addActiveSession(`s-${index}`);
    }
    session.reduceVolatileState();
    expect(session.toSnapshot().activeSessionIds).toEqual(["s-6", "s-7", "s-8", "s-9"]);
  });
});
