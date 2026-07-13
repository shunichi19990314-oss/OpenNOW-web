import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const GFN_DEVICE_ID_FILENAME = "gfn-device-id.json";
let cachedStableDeviceId: string | null = null;
export function getStableDeviceId(): string {
  if (cachedStableDeviceId) {
    return cachedStableDeviceId;
  }

  try {
    const path = join(resolve(process.env.OPENNOW_DATA_DIR ?? ".opennow-data"), GFN_DEVICE_ID_FILENAME);
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as { deviceId?: unknown };
      if (typeof parsed.deviceId === "string" && parsed.deviceId.length > 0) {
        cachedStableDeviceId = parsed.deviceId;
        return parsed.deviceId;
      }
    }

    const deviceId = crypto.randomUUID();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ deviceId }, null, 2), "utf-8");
    cachedStableDeviceId = deviceId;
    return deviceId;
  } catch (error) {
    const fallback = crypto.randomUUID();
    cachedStableDeviceId = fallback;
    console.warn("[DeviceId] Failed to load persisted device ID, using in-memory fallback:", error);
    return fallback;
  }
}
