import { describe, expect, it } from "vitest";

import type { LoginProvider } from "@shared/gfn";

import {
  MAX_QR_AUTO_RENEWALS,
  canRenewDeviceCode,
  decideDevicePoll,
  formatCodeCountdown,
  nextPollIntervalSeconds,
  prefersLinkOverQr,
  resolveInitialProviderId,
  shouldAutoStartDeviceLogin,
} from "./deviceLoginFlow";

function provider(idpId: string, priority = 0): LoginProvider {
  return {
    idpId,
    code: idpId.toUpperCase(),
    displayName: idpId,
    streamingServiceUrl: "https://example.invalid/",
    priority,
  };
}

describe("decideDevicePoll", () => {
  it("keeps polling while the visitor has not approved yet", () => {
    expect(decideDevicePoll("pending")).toBe("keep-polling");
  });

  it("backs off when NVIDIA asks us to slow down", () => {
    expect(decideDevicePoll("slow_down")).toBe("slow-down");
    expect(nextPollIntervalSeconds(5, "slow-down")).toBe(10);
    expect(nextPollIntervalSeconds(5, "keep-polling")).toBe(5);
  });

  it("treats an expired code as renewable instead of terminal", () => {
    // Regression guard: expiry used to throw and drop the visitor back to a
    // dead login screen even though they were only fetching their phone.
    expect(decideDevicePoll("expired")).toBe("renew-code");
  });

  it("aborts on denial and hard errors", () => {
    expect(decideDevicePoll("access_denied")).toBe("abort");
    expect(decideDevicePoll("error")).toBe("abort");
  });

  it("sanitises a nonsensical poll interval", () => {
    expect(nextPollIntervalSeconds(0, "keep-polling")).toBe(1);
    expect(nextPollIntervalSeconds(Number.NaN, "slow-down")).toBe(6);
  });
});

describe("canRenewDeviceCode", () => {
  it("bounds automatic re-issuing so an abandoned tab cannot poll forever", () => {
    for (let used = 0; used < MAX_QR_AUTO_RENEWALS; used += 1) {
      expect(canRenewDeviceCode(used)).toBe(true);
    }
    expect(canRenewDeviceCode(MAX_QR_AUTO_RENEWALS)).toBe(false);
    expect(canRenewDeviceCode(MAX_QR_AUTO_RENEWALS + 5)).toBe(false);
  });
});

describe("resolveInitialProviderId", () => {
  const providers = [provider("nvidia"), provider("bpc")];

  it("prefers the provider of a restored session", () => {
    expect(resolveInitialProviderId({
      providers,
      persistedProviderIdpId: "bpc",
      storedProviderIdpId: "nvidia",
    })).toBe("bpc");
  });

  it("falls back to the remembered provider from a previous visit", () => {
    expect(resolveInitialProviderId({
      providers,
      persistedProviderIdpId: null,
      storedProviderIdpId: "bpc",
    })).toBe("bpc");
  });

  it("ignores a remembered provider NVIDIA no longer offers", () => {
    // A dangling selection used to leave the sign-in button disabled.
    expect(resolveInitialProviderId({
      providers,
      persistedProviderIdpId: null,
      storedProviderIdpId: "retired-provider",
    })).toBe("nvidia");
  });

  it("defaults to the first provider and to empty when none are known", () => {
    expect(resolveInitialProviderId({ providers })).toBe("nvidia");
    expect(resolveInitialProviderId({ providers: [] })).toBe("");
  });
});

describe("shouldAutoStartDeviceLogin", () => {
  const ready = {
    isInitializing: false,
    hasSession: false,
    providersReady: true,
    hasSelectedProvider: true,
    isLoginActive: false,
    userDismissed: false,
    alreadyAutoStarted: false,
  };

  it("requests a code as soon as the login screen is ready", () => {
    expect(shouldAutoStartDeviceLogin(ready)).toBe(true);
  });

  it("waits while the saved session is still being restored", () => {
    expect(shouldAutoStartDeviceLogin({ ...ready, isInitializing: true })).toBe(false);
  });

  it("never fires for a visitor who is already signed in", () => {
    expect(shouldAutoStartDeviceLogin({ ...ready, hasSession: true })).toBe(false);
  });

  it("does not stack a second code on top of an active one", () => {
    expect(shouldAutoStartDeviceLogin({ ...ready, isLoginActive: true })).toBe(false);
    expect(shouldAutoStartDeviceLogin({ ...ready, alreadyAutoStarted: true })).toBe(false);
  });

  it("respects an explicit cancel", () => {
    expect(shouldAutoStartDeviceLogin({ ...ready, userDismissed: true })).toBe(false);
  });

  it("waits for the provider list before choosing one", () => {
    expect(shouldAutoStartDeviceLogin({ ...ready, providersReady: false })).toBe(false);
    expect(shouldAutoStartDeviceLogin({ ...ready, hasSelectedProvider: false })).toBe(false);
  });
});

describe("formatCodeCountdown", () => {
  it("renders minutes and seconds", () => {
    expect(formatCodeCountdown(299_000)).toBe("4:59");
    expect(formatCodeCountdown(60_000)).toBe("1:00");
    expect(formatCodeCountdown(9_000)).toBe("0:09");
  });

  it("renders hours once past an hour", () => {
    expect(formatCodeCountdown(3_723_000)).toBe("1:02:03");
  });

  it("clamps exhausted and unknown values to zero", () => {
    expect(formatCodeCountdown(0)).toBe("0:00");
    expect(formatCodeCountdown(-5_000)).toBe("0:00");
    expect(formatCodeCountdown(Number.NaN)).toBe("0:00");
  });
});

describe("prefersLinkOverQr", () => {
  it("leads with the tappable link on devices that cannot scan their own screen", () => {
    expect(prefersLinkOverQr(true, false)).toBe(true); // phone/tablet
    expect(prefersLinkOverQr(false, true)).toBe(true); // narrow viewport
  });

  it("leads with the QR on a pointer-driven desktop", () => {
    expect(prefersLinkOverQr(false, false)).toBe(false);
  });
});
