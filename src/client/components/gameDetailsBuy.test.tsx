import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GameInfo } from "@shared/gfn";

import { GameDetailsModal } from "./GameDetailsModal";

import ja from "../../../locales/ja.json";

/**
 * GeForce NOW does not sell games, so "buying from this site to the end" is not
 * possible: each purchase settles in Steam / Epic / …  What the shell can do is
 * remove the search step — the details modal hands over the exact product page
 * for the selected store variant. These tests pin that behaviour and the note
 * that explains where the payment happens.
 */

const game: GameInfo = {
  id: "100",
  title: "War Thunder",
  selectedVariantIndex: 0,
  variants: [{ id: "v1", store: "STEAM", supportedControls: [], storeUrl: "https://store.example.invalid/app/100" }],
  availableStores: ["STEAM"],
};

const baseProps = {
  game,
  isFavorite: false,
  onToggleFavorite: () => {},
  onPlay: () => {},
  onClose: () => {},
};

describe("details modal store hand-off", () => {
  it("offers the store page instead of a dead Play button when the game is locked", () => {
    const markup = renderToStaticMarkup(
      <GameDetailsModal {...baseProps} lockedReason={ja.gameCard.notOwnedHint} onBuy={() => {}} />,
    );
    expect(markup).toContain(ja.gameDetails.buyOnStore);
    expect(markup).toContain(ja.gameDetails.buyHint);
    // No launch affordance for a title the account cannot start.
    expect(markup).not.toContain("game-details-locked");
  });

  it("shows a pending label while the store URL resolves", () => {
    const markup = renderToStaticMarkup(
      <GameDetailsModal {...baseProps} lockedReason={ja.gameCard.notOwnedHint} onBuy={() => {}} isBuyPending />,
    );
    expect(markup).toContain(ja.gameDetails.openingStore);
    expect(markup).toContain("disabled");
  });

  it("keeps the plain Play button for a launchable title", () => {
    const markup = renderToStaticMarkup(<GameDetailsModal {...baseProps} onBuy={() => {}} />);
    expect(markup).toContain(ja.app.actions.play);
    expect(markup).not.toContain(ja.gameDetails.buyOnStore);
  });

  it("falls back to the locked explanation when no store hand-off exists", () => {
    const markup = renderToStaticMarkup(
      <GameDetailsModal {...baseProps} lockedReason={ja.gameCard.notOwnedHint} />,
    );
    expect(markup).toContain("game-details-locked");
    // The lock reason itself mentions buying, so assert on the button instead.
    expect(markup).not.toContain(ja.gameDetails.openingStore);
    expect(markup).not.toContain(ja.gameDetails.buyHint);
  });
});
