import { describe, expect, it } from "vitest";

import {
  filterMediaItems,
  formatMediaDuration,
  formatMediaSize,
  toMediaItems,
} from "./mediaLibrary";

const screenshot = {
  id: "s1",
  fileName: "OpenNOW-1.png",
  filePath: "blob:s1",
  createdAtMs: 1000,
  sizeBytes: 2048,
  dataUrl: "data:image/png;base64,xx",
};

const recording = {
  id: "r1",
  fileName: "OpenNOW-2.webm",
  filePath: "blob:r1",
  createdAtMs: 2000,
  sizeBytes: 5 * 1024 * 1024,
  durationMs: 65_000,
  gameTitle: "Cyberpunk 2077",
  thumbnailDataUrl: "data:image/png;base64,yy",
};

describe("media library", () => {
  it("merges screenshots and recordings newest first", () => {
    const items = toMediaItems([screenshot], [recording]);
    expect(items.map((item) => item.id)).toEqual(["recording:r1", "screenshot:s1"]);
    expect(items[0]).toMatchObject({ kind: "recording", gameTitle: "Cyberpunk 2077", durationMs: 65_000 });
    expect(items[1]).toMatchObject({ kind: "screenshot", thumbnailUrl: screenshot.dataUrl });
  });

  it("filters by kind and by game", () => {
    const items = toMediaItems([screenshot], [recording]);
    expect(filterMediaItems(items, "screenshot").map((item) => item.id)).toEqual(["screenshot:s1"]);
    expect(filterMediaItems(items, "all")).toHaveLength(2);
  });

  it("formats durations without leaking a locale", () => {
    expect(formatMediaDuration(65_000)).toBe("1:05");
    expect(formatMediaDuration(3_725_000)).toBe("1:02:05");
    expect(formatMediaDuration(undefined)).toBeNull();
    expect(formatMediaDuration(0)).toBeNull();
  });

  it("formats sizes in binary units", () => {
    expect(formatMediaSize(2048)).toBe("2 KB");
    expect(formatMediaSize(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatMediaSize(0)).toBe("0 KB");
  });
});
