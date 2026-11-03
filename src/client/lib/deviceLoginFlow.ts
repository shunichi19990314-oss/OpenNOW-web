import type { LoginProvider } from "@shared/gfn";

/**
 * Pure decision logic for the QR / device-authorization sign-in flow.
 *
 * Kept free of React and DOM access so the flow can be unit tested: the
 * interesting behaviour is *when* to keep polling, when to hand the visitor a
 * fresh code, and when to give up.
 */

/**
 * How many times an expired code is replaced automatically before the visitor
 * is asked to act. Device codes are short-lived (minutes), and someone walking
 * to fetch their phone can easily miss the window; re-issuing silently keeps
 * the "scan and done" promise. The bound exists so an abandoned login screen
 * cannot poll NVIDIA forever.
 */
export const MAX_QR_AUTO_RENEWALS = 2;

/** Statuses returned by `/api/auth/qr/poll`. */
export type DevicePollStatus =
  | "pending"
  | "slow_down"
  | "expired"
  | "access_denied"
  | "authorized"
  | "error";

export type DevicePollDecision =
  /** Nothing decided yet — wait and ask again. */
  | "keep-polling"
  /** NVIDIA asked us to back off; increase the interval and continue. */
  | "slow-down"
  /** The code is dead but the visitor may still be mid-flow: issue a new one. */
  | "renew-code"
  /** Terminal failure: surface the message and stop. */
  | "abort";

export function decideDevicePoll(status: DevicePollStatus): DevicePollDecision {
  switch (status) {
    case "pending":
      return "keep-polling";
    case "slow_down":
      return "slow-down";
    case "expired":
      return "renew-code";
    case "authorized":
      // The caller completes the login; nothing left to decide here.
      return "keep-polling";
    case "access_denied":
    case "error":
    default:
      return "abort";
  }
}

/** Polling backoff: NVIDIA's `slow_down` means "add 5 seconds". */
export function nextPollIntervalSeconds(currentSeconds: number, decision: DevicePollDecision): number {
  const base = Number.isFinite(currentSeconds) && currentSeconds > 0 ? currentSeconds : 1;
  return decision === "slow-down" ? base + 5 : base;
}

export function canRenewDeviceCode(renewalsUsed: number): boolean {
  return renewalsUsed < MAX_QR_AUTO_RENEWALS;
}

export interface InitialProviderSelection {
  providers: readonly LoginProvider[];
  /** Provider of an already restored session — always wins. */
  persistedProviderIdpId?: string | null;
  /** Provider remembered from a previous visit on this device. */
  storedProviderIdpId?: string | null;
}

/**
 * Pick the provider to preselect on the login screen.
 *
 * A remembered preference is only honoured while NVIDIA still offers that
 * provider, so a stale id can never leave the dropdown pointing at nothing
 * (which used to disable the sign-in button entirely).
 */
export function resolveInitialProviderId(input: InitialProviderSelection): string {
  const { providers, persistedProviderIdpId, storedProviderIdpId } = input;
  const known = new Set(providers.map((provider) => provider.idpId));

  if (persistedProviderIdpId && known.has(persistedProviderIdpId)) return persistedProviderIdpId;
  if (storedProviderIdpId && known.has(storedProviderIdpId)) return storedProviderIdpId;
  // A remembered id that is no longer offered is dropped rather than kept as a
  // dangling selection.
  return providers[0]?.idpId ?? "";
}

export interface AutoStartConditions {
  isInitializing: boolean;
  hasSession: boolean;
  providersReady: boolean;
  hasSelectedProvider: boolean;
  isLoginActive: boolean;
  /** Visitor pressed "cancel": respect that and stay out of the way. */
  userDismissed: boolean;
  /** Guards React StrictMode's double effect and repeated renders. */
  alreadyAutoStarted: boolean;
}

/**
 * Whether the login screen should request a code by itself instead of waiting
 * for a click. Auto-start removes a tap and gets the QR on screen immediately,
 * but must never fire while the session is still being restored (that would
 * throw a code at someone who is already signed in) or after an explicit cancel.
 */
export function shouldAutoStartDeviceLogin(conditions: AutoStartConditions): boolean {
  if (conditions.alreadyAutoStarted) return false;
  if (conditions.isInitializing) return false;
  if (conditions.hasSession) return false;
  if (conditions.isLoginActive) return false;
  if (conditions.userDismissed) return false;
  return conditions.providersReady && conditions.hasSelectedProvider;
}

/**
 * Remaining validity of a device code as `m:ss` (or `h:mm:ss` past an hour).
 * Negative/unknown input renders as `0:00` so the UI never shows a countdown
 * that has already run out.
 */
export function formatCodeCountdown(msRemaining: number): string {
  const totalSeconds = Number.isFinite(msRemaining) && msRemaining > 0
    ? Math.ceil(msRemaining / 1000)
    : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Whether this device can plausibly scan the QR code it is looking at.
 *
 * A phone or tablet cannot photograph its own screen, so on touch-first devices
 * the tappable sign-in link has to lead and the QR becomes the secondary
 * option. Derived from the pointer media query rather than the user agent:
 * a touchscreen laptop still has a mouse and can be scanned by a phone.
 */
export function prefersLinkOverQr(isCoarsePointer: boolean, isNarrowViewport: boolean): boolean {
  return isCoarsePointer || isNarrowViewport;
}
