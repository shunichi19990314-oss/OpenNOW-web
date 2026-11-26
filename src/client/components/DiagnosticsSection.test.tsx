import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WEB_DEFAULT_SETTINGS } from "../webDefaults";
import { DiagnosticsSection } from "./DiagnosticsSection";

/**
 * Static render guard for the About page's diagnostics row.
 *
 * The row must stay reachable without a stream (so a user can report a launch
 * failure) and must not print an English hint when the UI is Japanese.
 */
describe("DiagnosticsSection", () => {
  const markup = renderToStaticMarkup(
    <DiagnosticsSection showAll settings={WEB_DEFAULT_SETTINGS} />,
  );

  it("renders a copy and a save action", () => {
    expect(markup).toContain("settings-diagnostics-actions");
    expect(markup).toContain("診断情報をコピー");
    expect(markup).toContain("ファイルに保存");
  });

  it("advertises that the report carries no personal data", () => {
    expect(markup).toContain("個人データは含まれません");
  });

  it("does not show a result message before anything was copied", () => {
    expect(markup).not.toContain("settings-diagnostics-status");
  });
});
