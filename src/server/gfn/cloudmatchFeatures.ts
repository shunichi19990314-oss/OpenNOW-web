import type { AppLaunchMode, SessionCreateRequest, StreamSettings } from "@shared/gfn";
import { DEFAULT_MINIMUM_FPS_FOR_REFLEX_WITHOUT_VRR } from "@shared/cloudGsync";

import type { CloudMatchRequest } from "./types";

// Wire values used by cloudmatch session requests. Matches the official
// client's mapping: Default -> 1, GamepadFriendly -> 2, TouchFriendly -> 3.
const APP_LAUNCH_MODE_WIRE_VALUES: Record<AppLaunchMode, number> = {
  default: 1,
  gamepadFriendly: 2,
  touchFriendly: 3,
};

export function appLaunchModeWireValue(mode: AppLaunchMode | undefined): number {
  return APP_LAUNCH_MODE_WIRE_VALUES[mode ?? "default"];
}

/**
 * requestedStreamingFeatures for the createSession body.
 *
 * Values mirror the known-working OpenNOW-vita reference exactly: WebRTC seats
 * do not support Cloud G-Sync / Reflex / L4S (the OpenNOW WebRTC docs confirm
 * "Always SDR and stereo... no Cloud G-Sync"), and asking for them - or for the
 * all-zero prefilter block - risks CloudMatch refusing the WebRTC transport or
 * provisioning a mismatched pipeline. bitDepth uses the CloudMatch wire scale
 * (0 = 8-bit, 10 = 10-bit), NOT the 0/1 enum used elsewhere in this codebase.
 */
export function buildRequestedStreamingFeatures(
  _settings: StreamSettings,
  bitDepth: number,
  chromaFormat: number,
  _hdrEnabled: boolean,
): CloudMatchRequest["sessionRequestData"]["requestedStreamingFeatures"] {
  return {
    reflex: false,
    bitDepth,
    cloudGsync: false,
    enabledL4S: false,
    supportedHidDevices: 0,
    profile: 0,
    fallbackToLogicalResolution: false,
    chromaFormat,
    prefilterMode: 1,
    prefilterSharpness: 50,
    prefilterNoiseReduction: 0,
    hudStreamingMode: 0,
  };
}

/**
 * CloudMatch wire bit depth: 0 for 8-bit, 10 for 10-bit (OpenNOW-vita's
 * cloudmatch_bit_depth()). Distinct from colorQualityBitDepth(), which returns
 * a 0/1 enum used by other protocol messages.
 */
export function cloudmatchBitDepth(settings: Pick<StreamSettings, "colorQuality">): number {
  return settings.colorQuality.startsWith("10bit") ? 10 : 0;
}

export function shouldRequestReflex(settings: StreamSettings): boolean {
  if (typeof settings.cloudGsyncResolution?.reflexEnabled === "boolean") {
    return settings.cloudGsyncResolution.reflexEnabled;
  }

  const reflexMinimum =
    settings.cloudGsyncResolution?.capabilities.minimumFpsForReflexWithoutVrr
    ?? DEFAULT_MINIMUM_FPS_FOR_REFLEX_WITHOUT_VRR;
  return settings.enableCloudGsync || settings.fps >= reflexMinimum;
}

export function shouldEnableInGameSettingsPersistence(
  input: Pick<SessionCreateRequest, "enablePersistingInGameSettings" | "supportsInGameSettingsPersistence">,
): boolean {
  return (
    input.enablePersistingInGameSettings === true &&
    input.supportsInGameSettingsPersistence === true
  );
}
