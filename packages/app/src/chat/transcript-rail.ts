// The timeline rail's geometry, as arithmetic. The transcript hands it DOM
// rects; everything about which stop is current and where the rail may show
// is decided here, so the rules are readable without a browser.

import { TIMELINE_RAIL_WIDTH_PX } from "@honk/ui/timeline-navigator";

// A stop becomes current once it crosses the upper third of the viewport:
// high enough that the rail leads the reader, low enough that it does not flip
// to the next turn while the current one still fills the screen.
const ACTIVATION_RATIO = 0.28;
// Vertical inset of the rail inside the scrollport.
const BLOCK_GAP_PX = 32;
// Clearance between the rail and the transcript column, and between the rail
// and the window edge.
const PANEL_GAP_PX = 12;
const VIEWPORT_GAP_PX = 8;

/**
 * At the bottom of the transcript the last turn is current no matter where its
 * message sits — the reader has arrived, and a rail that pointed elsewhere
 * would be lying about it. A stop's `top` is its offset within the scroll
 * content, not the viewport.
 */
export const activeTimelineId = (input: {
  readonly stops: readonly { readonly id: string; readonly top: number }[];
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly maxScroll: number;
}): string | null => {
  const ordered = [...input.stops].sort((left, right) => left.top - right.top);
  const first = ordered[0]?.id ?? null;
  if (input.maxScroll > 0 && input.scrollTop >= input.maxScroll - 1) {
    return ordered[ordered.length - 1]?.id ?? first;
  }
  const activationPoint = input.scrollTop + input.clientHeight * ACTIVATION_RATIO;
  let active = first;
  for (const stop of ordered) {
    if (stop.top > activationPoint) break;
    active = stop.id;
  }
  return active;
};

export interface RailPlacement {
  readonly isVisible: boolean;
  readonly leftPx: number;
  readonly topPx: number;
  readonly heightPx: number;
  readonly availableWidthPx: number;
}

/**
 * The rail pins to the thread panel's inline-start edge, outside the squeezed
 * transcript column; a surface with no tagged panel keeps the rail beside its
 * own content column instead. A transcript that cannot scroll has nothing to
 * navigate, and a layout with no gutter beside the column has nowhere to put
 * the rail without its ticks landing on transcript text — both hide it.
 */
export const railPlacement = (input: {
  readonly scrollport: {
    readonly top: number;
    readonly left: number;
    readonly right: number;
    readonly height: number;
  };
  readonly panelLeft: number | null;
  readonly contentLeft: number;
  readonly maxScroll: number;
}): RailPlacement => {
  const leftPx =
    input.panelLeft === null
      ? Math.max(VIEWPORT_GAP_PX, input.contentLeft - PANEL_GAP_PX - TIMELINE_RAIL_WIDTH_PX)
      : input.panelLeft + VIEWPORT_GAP_PX;
  const hasRailRoom = input.contentLeft - leftPx >= TIMELINE_RAIL_WIDTH_PX + PANEL_GAP_PX;
  return {
    isVisible: input.maxScroll > 1 && hasRailRoom,
    leftPx,
    topPx: input.scrollport.top + BLOCK_GAP_PX,
    heightPx: Math.max(0, input.scrollport.height - BLOCK_GAP_PX * 2),
    availableWidthPx: Math.max(
      0,
      input.scrollport.right - leftPx - TIMELINE_RAIL_WIDTH_PX - VIEWPORT_GAP_PX,
    ),
  };
};
