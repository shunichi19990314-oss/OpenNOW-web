import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SubscriptionInfo } from "@shared/gfn";

import { SettingsSubscriptionSection } from "./SettingsSubscriptionSection";

/**
 * The plan was only visible in the navbar popover before this section existed.
 * These guard the three states that matter: no session, a timed plan, and an
 * unlimited one.
 */
function subscription(overrides: Partial<SubscriptionInfo> = {}): SubscriptionInfo {
  return {
    membershipTier: "ULTIMATE",
    allottedHours: 0,
    purchasedHours: 0,
    rolledOverHours: 0,
    usedHours: 0,
    remainingHours: 0,
    totalHours: 0,
    isUnlimited: true,
    entitledResolutions: [
      { width: 3840, height: 2160, fps: 120 },
      { width: 1920, height: 1080, fps: 60 },
    ],
    ...overrides,
  };
}

describe("SettingsSubscriptionSection", () => {
  it("shows the live tier and entitlement chips", () => {
    const markup = renderToStaticMarkup(
      <SettingsSubscriptionSection showAll subscriptionInfo={subscription()} subscriptionLoading={false} />,
    );
    expect(markup).toContain("アルティメット");
    expect(markup).toContain("4K · 120 FPS");
    expect(markup).toContain("1080p · 60 FPS");
    expect(markup).toContain("時間無制限");
  });

  it("shows remaining hours for a timed plan", () => {
    const markup = renderToStaticMarkup(
      <SettingsSubscriptionSection
        showAll
        subscriptionInfo={subscription({ isUnlimited: false, remainingHours: 12.4, entitledResolutions: [] })}
        subscriptionLoading={false}
      />,
    );
    expect(markup).toContain("残り 12 時間");
    expect(markup).not.toContain("時間無制限");
  });

  it("asks the visitor to sign in when there is no subscription", () => {
    const markup = renderToStaticMarkup(
      <SettingsSubscriptionSection showAll subscriptionInfo={null} subscriptionLoading={false} />,
    );
    expect(markup).toContain("メンバーシップを取得できません");
    expect(markup).toContain("サインインすると");
  });

  it("never renders a raw membership enum", () => {
    const markup = renderToStaticMarkup(
      <SettingsSubscriptionSection showAll subscriptionInfo={subscription()} subscriptionLoading={false} />,
    );
    expect(markup).not.toContain("ULTIMATE");
    expect(markup).not.toContain("UNLIMITED");
  });
});
