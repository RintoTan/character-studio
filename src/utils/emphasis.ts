// What the canvas is emphasising, in one order.
//
// Before this, four features each dimmed the drawing on their own: a hover dimmed
// everything but the hovered node, a spotlight dimmed everything outside its hops, a
// lens dimmed the other relationship kinds, and a search highlighted its hit. When two
// of them were on, the dimming classes stacked and the result was decided by CSS order
// rather than by intent — a selected person could be faded by a spotlight, and a
// spotlight target could be faded by a lens.
//
// The levels below are the whole policy, most important first:
//
//   selected    the object the author is working on
//   spotlight   the person a spotlight was opened for
//   search      the character a search landed on
//   neighbour   one hop from the spotlit person
//   lens        a relationship kind the lens includes
//   normal      everything else
//
// A higher level is never dimmed by a lower one. Lens and spotlight change emphasis
// only: no level removes data, kinds or edges.

export type EmphasisLevel = "selected" | "spotlight" | "search" | "neighbour" | "lens" | "normal";

export type EmphasisInput = {
  selected?: boolean;
  spotlightTarget?: boolean;
  searchHit?: boolean;
  spotlightNeighbour?: boolean;
  lensMatch?: boolean;
};

const ORDER: EmphasisLevel[] = ["selected", "spotlight", "search", "neighbour", "lens"];

export function emphasisLevel(input: EmphasisInput): EmphasisLevel {
  for (const level of ORDER) {
    if (level === "selected" && input.selected) return "selected";
    if (level === "spotlight" && input.spotlightTarget) return "spotlight";
    if (level === "search" && input.searchHit) return "search";
    if (level === "neighbour" && input.spotlightNeighbour) return "neighbour";
    if (level === "lens" && input.lensMatch) return "lens";
  }

  return "normal";
}

/** Whether an active looking-tool should recede this level into the background. */
export function isBackgroundLevel(level: EmphasisLevel): boolean {
  return level === "normal";
}
