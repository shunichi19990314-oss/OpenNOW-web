import { describe, expect, it } from "vitest";

import { ERROR_MESSAGES, SessionError } from "./errorCodes";

/**
 * The launch error overlay prints `SessionError.title` / `.message` verbatim.
 * Both used to be English ("Session Limit Exceeded", "Please log in again."),
 * so a failed launch showed an entirely English modal inside the Japanese UI.
 *
 * A source scan cannot catch this: the strings live in a `Map` keyed by numeric
 * codes and reach the screen through the API response, not through a component.
 * These assertions run over the catalogue itself.
 */

const JAPANESE = /[\u3040-\u30ff\u4e00-\u9fff]/;

describe("GFN error catalogue is Japanese", () => {
  it("surveys a realistic number of codes", () => {
    // Guards against the map silently becoming empty, which would make every
    // assertion below pass without checking anything.
    expect(ERROR_MESSAGES.size).toBeGreaterThan(60);
  });

  it("has a Japanese title and description for every known code", () => {
    const offenders = [...ERROR_MESSAGES.entries()]
      .filter(([, entry]) => !JAPANESE.test(entry.title) || !JAPANESE.test(entry.description))
      .map(([code, entry]) => `${code}: ${entry.title} / ${entry.description}`);
    expect(offenders).toEqual([]);
  });

  it("never exposes a camel-case or caps enum in the title", () => {
    const offenders = [...ERROR_MESSAGES.values()]
      .map((entry) => entry.title)
      .filter((title) => /^[A-Za-z][A-Za-z0-9 ]*$/.test(title));
    expect(offenders).toEqual([]);
  });

  it("translates the statusDescription and HTTP fallbacks", () => {
    const cases = [
      SessionError.fromResponse(500, JSON.stringify({ requestStatus: { statusCode: 40, statusDescription: "INSUFFICIENT_PLAYABILITY" } })),
      SessionError.fromResponse(500, JSON.stringify({ requestStatus: { statusCode: 41, statusDescription: "MAINTENANCE_WINDOW" } })),
      SessionError.fromResponse(401, "{}"),
      SessionError.fromResponse(429, "{}"),
      SessionError.fromResponse(503, "{}"),
      SessionError.fromResponse(418, "{}"),
    ];

    for (const error of cases) {
      expect(JAPANESE.test(error.title)).toBe(true);
      expect(JAPANESE.test(error.message)).toBe(true);
      // The raw upstream description stays available for support, but it must
      // not be the copy the visitor reads.
      expect(error.message).not.toMatch(/INSUFFICIENT_PLAYABILITY|MAINTENANCE_WINDOW/);
    }
  });
});
