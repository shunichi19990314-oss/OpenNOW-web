import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PREFERRED_PROVIDER_LOCALSTORAGE_KEY,
  clearPreferredProviderIdpId,
  loadPreferredProviderIdpId,
  savePreferredProviderIdpId,
} from "./loginPreferences";

function installFakeStorage(initial: Record<string, string> = {}): {
  store: Map<string, string>;
  setItem: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  const fake = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    key: vi.fn(() => null),
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: fake,
    configurable: true,
    writable: true,
  });
  return { store, setItem: fake.setItem };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  vi.restoreAllMocks();
});

describe("login provider preference", () => {
  it("round-trips the remembered provider id", () => {
    const { store } = installFakeStorage();
    expect(loadPreferredProviderIdpId()).toBeNull();

    savePreferredProviderIdpId("bpc-idp");

    expect(loadPreferredProviderIdpId()).toBe("bpc-idp");
    expect(store.get(PREFERRED_PROVIDER_LOCALSTORAGE_KEY)).toBe("bpc-idp");
  });

  it("ignores empty ids so a cleared selection is not persisted", () => {
    const { setItem } = installFakeStorage();
    savePreferredProviderIdpId("");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("treats an empty stored value as no preference", () => {
    installFakeStorage({ [PREFERRED_PROVIDER_LOCALSTORAGE_KEY]: "" });
    expect(loadPreferredProviderIdpId()).toBeNull();
  });

  it("clears the preference", () => {
    installFakeStorage({ [PREFERRED_PROVIDER_LOCALSTORAGE_KEY]: "bpc-idp" });
    clearPreferredProviderIdpId();
    expect(loadPreferredProviderIdpId()).toBeNull();
  });

  it("survives a missing localStorage (private mode / non-browser env)", () => {
    // No fake installed here: the module must degrade to "no preference"
    // instead of throwing during sign-in.
    expect(loadPreferredProviderIdpId()).toBeNull();
    expect(() => savePreferredProviderIdpId("bpc-idp")).not.toThrow();
    expect(() => clearPreferredProviderIdpId()).not.toThrow();
  });

  it("survives a storage that throws on every access", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage disabled");
      },
    });
    expect(loadPreferredProviderIdpId()).toBeNull();
    expect(() => savePreferredProviderIdpId("bpc-idp")).not.toThrow();
  });
});
