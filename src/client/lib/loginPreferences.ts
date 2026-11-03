/**
 * Per-visitor login preferences.
 *
 * The provider list comes from NVIDIA on every boot and is ordered by their
 * priority, so a visitor who signs in through a non-default provider (e.g.
 * bro.game) had to pick it out of the dropdown again on every single visit.
 * Remembering the last successful choice removes that step. This is a plain
 * preference, not a credential: nothing secret is stored and the value is
 * re-validated against the live provider list before use.
 */
export const PREFERRED_PROVIDER_LOCALSTORAGE_KEY = "opennow.loginProviderIdpId";

function storage(): Storage | null {
  // Guarded because the module is imported by unit tests running in Node and
  // because Safari private mode throws on access to localStorage.
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPreferredProviderIdpId(): string | null {
  try {
    const stored = storage()?.getItem(PREFERRED_PROVIDER_LOCALSTORAGE_KEY);
    return typeof stored === "string" && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function savePreferredProviderIdpId(idpId: string): void {
  if (!idpId) return;
  try {
    storage()?.setItem(PREFERRED_PROVIDER_LOCALSTORAGE_KEY, idpId);
  } catch {
    // A blocked/quota-exceeded store must never break sign-in.
  }
}

export function clearPreferredProviderIdpId(): void {
  try {
    storage()?.removeItem(PREFERRED_PROVIDER_LOCALSTORAGE_KEY);
  } catch {
    // ignore
  }
}
