import { describe, expect, it } from "vitest";

import { getNextAdReportAction } from "./queueAds";

describe("getNextAdReportAction", () => {
  it("starts a fresh report sequence after a cancelled playback is retried", () => {
    expect(getNextAdReportAction("cancel", "playing")).toBe("start");
  });

  it("does not duplicate a start report while already playing", () => {
    expect(getNextAdReportAction("start", "playing")).toBeNull();
  });

  it("resumes a paused ad", () => {
    expect(getNextAdReportAction("pause", "playing")).toBe("resume");
  });
});
