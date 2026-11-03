import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AuthDeviceLoginChallenge, LoginProvider } from "@shared/gfn";

import { LoginScreen } from "./LoginScreen";

/**
 * Render-level guard for the login screen.
 *
 * The sign-in screen is the one view nobody can reach without a working
 * render, and it is not covered by the logic tests. Rendering it to static
 * markup catches prop/type drift and any exception thrown while building the
 * QR panel (effects do not run here, so no DOM or clipboard access is needed).
 */

const providers: LoginProvider[] = [
  {
    idpId: "nvidia-idp",
    code: "NVIDIA",
    displayName: "NVIDIA",
    streamingServiceUrl: "https://example.invalid/",
    priority: 0,
  },
  {
    idpId: "bpc-idp",
    code: "BPC",
    displayName: "bro.game",
    streamingServiceUrl: "https://example.invalid/",
    priority: 1,
  },
];

const challenge: AuthDeviceLoginChallenge = {
  attemptId: "attempt-1",
  deviceCode: "device-1",
  userCode: "ABCD-EFGH",
  verificationUri: "https://login.example.invalid/device",
  verificationUriComplete: "https://login.example.invalid/device?code=ABCD-EFGH",
  expiresAt: Date.now() + 299_000,
  intervalSeconds: 5,
};

const noop = (): void => {};

function render(props: Partial<Parameters<typeof LoginScreen>[0]> = {}): string {
  return renderToStaticMarkup(
    <LoginScreen
      providers={providers}
      selectedProviderId="nvidia-idp"
      onProviderChange={noop}
      onQrLogin={() => void Promise.resolve()}
      onCancelQrLogin={noop}
      isLoading={false}
      error={null}
      {...props}
    />,
  );
}

describe("LoginScreen rendering", () => {
  it("renders the idle sign-in card", () => {
    const markup = render();
    expect(markup).toContain("OpenNOW");
    expect(markup).toContain("login-card");
    // No code yet, so no QR panel.
    expect(markup).not.toContain("login-qr-panel");
  });

  it("renders both the QR code and the same-device link once a code exists", () => {
    const markup = render({ qrLoginChallenge: challenge, isQrLoginPending: false });
    expect(markup).toContain("login-qr-panel");
    // The link is what makes sign-in possible on a phone, which cannot scan
    // its own screen. It must carry the code and open in a new tab so the
    // polling tab keeps running.
    expect(markup).toContain(`href="${challenge.verificationUriComplete}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain("login-qr-link");
    expect(markup).toContain(challenge.userCode);
    expect(markup).toContain("login-qr-copy-button");
    expect(markup).toContain("login-qr-countdown");
    expect(markup).toContain(challenge.verificationUri);
  });

  it("renders the preparing state before the code arrives", () => {
    const markup = render({ isQrLoginPending: true, qrLoginChallenge: null });
    expect(markup).toContain("login-qr-panel");
    expect(markup).not.toContain("login-qr-link");
  });

  it("flags a code that was re-issued automatically", () => {
    const markup = render({ qrLoginChallenge: challenge, qrRenewalsUsed: 1 });
    expect(markup).toContain("login-qr-renewed");
  });

  it("shows the manual button while a login is already running", () => {
    const markup = render({ isQrLoginPending: true });
    expect(markup).toContain("login-actions");
  });

  it("renders a login error without losing the sign-in controls", () => {
    const markup = render({ error: "Sign-in did not complete after several codes." });
    expect(markup).toContain("login-error");
    expect(markup).toContain("login-actions");
  });

  it("renders the restoring-session state", () => {
    const markup = render({ isInitializing: true, statusMessage: "Restoring saved session..." });
    expect(markup).toContain("Restoring saved session...");
  });
});
