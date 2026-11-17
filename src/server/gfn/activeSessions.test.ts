import { describe, expect, it, vi } from "vitest";

import { getActiveSessions } from "./cloudmatch";
import type { ActiveSessionInfo } from "@shared/gfn";

/**
 * The launcher decides "the account has no session, create one" from this list.
 * A session living on a base we did not query is therefore not a cosmetic
 * problem — it becomes `DuplicateSessionDetected` on the next launch, which is
 * the failure the visitor saw while the home screen showed nothing running.
 */

function session(sessionId: string, appId: number, status = 2): ActiveSessionInfo {
  return {
    sessionId,
    appId,
    status,
    serverIp: "1.2.3.4",
    streamingBaseUrl: "https://cloudmatchprod-jp.nvidiagrid.net",
  };
}

const TOKEN = "token";
const BASE = "https://prod.cloudmatchbeta.nvidiagrid.net";
const ZONE = "https://cloudmatchprod-jp.nvidiagrid.net";

describe("getActiveSessions", () => {
  it("merges sessions found on the default base and on a zone base", async () => {
    const fetchSessions = vi.fn(async (base: string) => {
      if (base === BASE) return [session("queued-on-default", 100, 1)];
      if (base === ZONE) return [session("running-in-zone", 200, 3)];
      return [];
    });

    const sessions = await getActiveSessions(TOKEN, BASE, {
      fetchSessions,
      discoverBases: async () => [ZONE],
    });

    // Both are visible; neither hides the other.
    expect(sessions.map((entry) => entry.sessionId).sort())
      .toEqual(["queued-on-default", "running-in-zone"]);
    expect(fetchSessions).toHaveBeenCalledTimes(2);
  });

  it("does not stop at the first base that answers", async () => {
    // The old implementation returned as soon as the first base returned a
    // list — even an empty one — which made the zone session unknowable.
    const fetchSessions = vi.fn(async (base: string) => (base === ZONE ? [session("only-in-zone", 300)] : []));
    const sessions = await getActiveSessions(TOKEN, BASE, {
      fetchSessions,
      discoverBases: async () => [ZONE],
    });
    expect(sessions.map((entry) => entry.sessionId)).toEqual(["only-in-zone"]);
  });

  it("de-duplicates a session reported by more than one base", async () => {
    const shared = session("same", 42);
    const sessions = await getActiveSessions(TOKEN, BASE, {
      fetchSessions: async () => [shared],
      discoverBases: async () => [ZONE],
    });
    expect(sessions).toHaveLength(1);
  });

  it("survives a base that fails without hiding the other base's sessions", async () => {
    const sessions = await getActiveSessions(TOKEN, BASE, {
      fetchSessions: async (base: string) => {
        if (base === BASE) throw new Error("network down");
        return [session("running-in-zone", 200, 3)];
      },
      discoverBases: async () => [ZONE],
    }).catch(() => "threw");
    // A throwing base must not abort the lookup: the launch path would then
    // assume "no sessions" and create a duplicate.
    expect(sessions).toEqual([session("running-in-zone", 200, 3)]);
  });

  it("returns an empty list only when every base reports nothing", async () => {
    const sessions = await getActiveSessions(TOKEN, BASE, {
      fetchSessions: async () => [],
      discoverBases: async () => [ZONE],
    });
    expect(sessions).toEqual([]);
  });

  it("refuses to answer without a token", async () => {
    await expect(getActiveSessions("", BASE)).rejects.toThrow(/token/i);
  });
});
