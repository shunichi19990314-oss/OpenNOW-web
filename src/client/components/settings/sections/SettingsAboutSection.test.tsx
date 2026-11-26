import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsAboutSection } from "./SettingsAboutSection";

/**
 * Static render guard for the About page's maintenance rows.
 *
 * The reset row must stay behind an inline confirm (the desktop build asks
 * first) and the legal notice must keep naming NVIDIA, since that disclaimer is
 * the reason the panel exists.
 */
function render(props: Partial<Parameters<typeof SettingsAboutSection>[0]> = {}): string {
  return renderToStaticMarkup(
    <SettingsAboutSection showAll onOpenWhatsNew={() => {}} {...props} />,
  );
}

describe("SettingsAboutSection", () => {
  it("shows the reset row with a hint, not a raw confirm dialog", () => {
    const markup = render();
    expect(markup).toContain("すべての設定をリセット");
    expect(markup).toContain("この端末に保存された OpenNOW の設定を初期状態に戻します。");
    expect(markup).not.toContain("settings-inline-confirm");
  });

  it("disables the reset row while streaming", () => {
    const markup = render({ resetDisabled: true, onResetSettings: async () => true });
    expect(markup).toMatch(/disabled=""/);
  });

  it("keeps the NVIDIA disclaimer in the legal panel", () => {
    const markup = render();
    expect(markup).toContain("settings-legal");
    expect(markup).toContain("法的情報");
    expect(markup).toContain("GeForce NOW は NVIDIA Corporation の商標です。");
    expect(markup).not.toContain("not affiliated");
  });
});
