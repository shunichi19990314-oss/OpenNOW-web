import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSubscription } from "./subscription";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchSubscription", () => {
  it("treats MES active-entitlement 404 as an empty FREE subscription", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "not_found",
          message: "User Doesn't Have Active Entitlement",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(fetchSubscription("token", "user-1", "NP-AMS-08")).resolves.toMatchObject({
      membershipTier: "FREE",
      serverRegionId: "NP-AMS-08",
      state: "INACTIVE",
      isGamePlayAllowed: false,
      totalHours: 0,
      remainingHours: 0,
      entitledResolutions: [],
    });
  });

  it("does not hide unrelated 404 responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not_found", message: "Unknown endpoint" }), { status: 404 }),
    );

    await expect(fetchSubscription("token", "user-1")).rejects.toThrow(
      "Subscription API failed with status 404",
    );
  });
});
