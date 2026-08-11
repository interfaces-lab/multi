import { describe, expect, it } from "vitest";

import { activeTimelineId, railPlacement } from "./transcript-rail";

const STOPS = [
  { id: "u1", top: 0 },
  { id: "u2", top: 600 },
  { id: "u3", top: 1_400 },
];

describe("the timeline rail's active stop", () => {
  it("advances only once a stop crosses the 28% activation line", () => {
    // Viewport 1000 tall: the line sits at scrollTop + 280.
    expect(
      activeTimelineId({ stops: STOPS, scrollTop: 300, clientHeight: 1_000, maxScroll: 4_000 }),
    ).toBe("u1");
    expect(
      activeTimelineId({ stops: STOPS, scrollTop: 320, clientHeight: 1_000, maxScroll: 4_000 }),
    ).toBe("u2");
  });

  it("pins to the last stop at the bottom, wherever that message sits", () => {
    expect(
      activeTimelineId({ stops: STOPS, scrollTop: 4_000, clientHeight: 1_000, maxScroll: 4_000 }),
    ).toBe("u3");
  });

  it("reads document order from the measured tops, not the map's order", () => {
    expect(
      activeTimelineId({
        stops: [...STOPS].reverse(),
        scrollTop: 1_200,
        clientHeight: 1_000,
        maxScroll: 4_000,
      }),
    ).toBe("u3");
  });
});

describe("the timeline rail's placement", () => {
  const scrollport = { top: 40, left: 0, right: 1_200, height: 800 };

  it("pins to the thread panel's edge and insets itself in the scrollport", () => {
    const placement = railPlacement({ scrollport, panelLeft: 0, contentLeft: 220, maxScroll: 900 });

    expect(placement.isVisible).toBe(true);
    expect(placement.leftPx).toBe(8);
    expect(placement.topPx).toBe(72);
    expect(placement.heightPx).toBe(736);
    expect(placement.availableWidthPx).toBeGreaterThan(0);
  });

  it("hides when there is nothing to scroll", () => {
    expect(
      railPlacement({ scrollport, panelLeft: 0, contentLeft: 220, maxScroll: 0 }).isVisible,
    ).toBe(false);
  });

  it("hides when the gutter beside the column is too narrow for the rail", () => {
    expect(
      railPlacement({ scrollport, panelLeft: 0, contentLeft: 24, maxScroll: 900 }).isVisible,
    ).toBe(false);
  });

  it("falls back to the content column's own gutter with no tagged panel", () => {
    const placement = railPlacement({
      scrollport,
      panelLeft: null,
      contentLeft: 220,
      maxScroll: 900,
    });

    expect(placement.leftPx).toBe(220 - 12 - 24);
  });
});
