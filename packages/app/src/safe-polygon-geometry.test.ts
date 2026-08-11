import { describe, expect, it } from "vitest";

import { computeSafeZone, isPointInPolygon, isPointInSafeZone } from "./safe-polygon-geometry";

// A trigger row on the left, a taller submenu opening to its right — the demo's layout
// and the shape the screenshots show.
const TRIGGER = { left: 20, top: 300, right: 260, bottom: 328 };
const SUBMENU = { left: 268, top: 180, right: 500, bottom: 480 };
const EXIT = { x: 250, y: 314 };

describe("computeSafeZone", () => {
  it("anchors the polygon apex at the pointer exit point", () => {
    const zone = computeSafeZone(EXIT, TRIGGER, SUBMENU);
    const [one, two] = zone.polygon;
    expect(one.x).toBeCloseTo(EXIT.x - 0.5);
    expect(two.x).toBeCloseTo(EXIT.x - 0.5);
    expect((one.y + two.y) / 2).toBeCloseTo(EXIT.y);
  });

  it("bases the polygon on the submenu's near edge when the submenu is taller", () => {
    const zone = computeSafeZone(EXIT, TRIGGER, SUBMENU);
    const [, , top, bottom] = zone.polygon;
    expect(top).toEqual({ x: SUBMENU.left + 0.5, y: SUBMENU.top });
    expect(bottom).toEqual({ x: SUBMENU.left + 0.5, y: SUBMENU.bottom });
  });

  it("clamps the trough between the trigger's right edge and the submenu's left edge", () => {
    const zone = computeSafeZone(EXIT, TRIGGER, SUBMENU);
    expect(zone.trough).toEqual({
      left: TRIGGER.right - 1,
      right: SUBMENU.left + 1,
      top: TRIGGER.top,
      bottom: TRIGGER.bottom,
    });
  });

  it("keeps a straight-line traversal to the submenu inside the safe zone", () => {
    const zone = computeSafeZone(EXIT, TRIGGER, SUBMENU);
    const target = { x: SUBMENU.left + 1, y: (SUBMENU.top + SUBMENU.bottom) / 2 };
    for (let t = 0.05; t < 1; t += 0.05) {
      const point = {
        x: EXIT.x + (target.x - EXIT.x) * t,
        y: EXIT.y + (target.y - EXIT.y) * t,
      };
      expect(isPointInSafeZone(point, zone)).toBe(true);
    }
  });

  it("treats a detour far above the diagonal as outside", () => {
    const zone = computeSafeZone(EXIT, TRIGGER, SUBMENU);
    expect(isPointInSafeZone({ x: EXIT.x + 4, y: SUBMENU.top - 60 }, zone)).toBe(false);
    expect(isPointInPolygon({ x: EXIT.x - 40, y: EXIT.y }, zone.polygon)).toBe(false);
  });
});

// The explanation panel: a taller PreviewCard opening inline-start of a model row.
const MODEL_ROW = { left: 480, top: 300, right: 700, bottom: 328 };
const PANEL = { left: 200, top: 250, right: 460, bottom: 520 };
const PANEL_EXIT = { x: 490, y: 314 };

describe("computeSafeZone side left", () => {
  it("bases the polygon on the panel's near (right) edge", () => {
    const zone = computeSafeZone(PANEL_EXIT, MODEL_ROW, PANEL, "left");
    const [top, bottom, apexOne, apexTwo] = zone.polygon;
    expect(top).toEqual({ x: PANEL.right - 0.5, y: PANEL.top });
    expect(bottom).toEqual({ x: PANEL.right - 0.5, y: PANEL.bottom });
    expect(apexOne.x).toBeCloseTo(PANEL_EXIT.x + 1.5);
    expect((apexOne.y + apexTwo.y) / 2).toBeCloseTo(PANEL_EXIT.y);
  });

  it("clamps the trough between the panel's right edge and the row's left edge", () => {
    const zone = computeSafeZone(PANEL_EXIT, MODEL_ROW, PANEL, "left");
    expect(zone.trough).toEqual({
      left: PANEL.right - 1,
      right: MODEL_ROW.left + 1,
      top: MODEL_ROW.top,
      bottom: MODEL_ROW.bottom,
    });
  });

  it("keeps a straight-line traversal into the panel inside the safe zone", () => {
    const zone = computeSafeZone(PANEL_EXIT, MODEL_ROW, PANEL, "left");
    const target = { x: PANEL.right - 1, y: (PANEL.top + PANEL.bottom) / 2 };
    for (let t = 0.05; t < 1; t += 0.05) {
      const point = {
        x: PANEL_EXIT.x + (target.x - PANEL_EXIT.x) * t,
        y: PANEL_EXIT.y + (target.y - PANEL_EXIT.y) * t,
      };
      expect(isPointInSafeZone(point, zone)).toBe(true);
    }
  });

  it("treats a detour far below the diagonal as outside", () => {
    const zone = computeSafeZone(PANEL_EXIT, MODEL_ROW, PANEL, "left");
    expect(isPointInSafeZone({ x: PANEL_EXIT.x - 4, y: PANEL.bottom + 60 }, zone)).toBe(false);
    expect(isPointInPolygon({ x: PANEL_EXIT.x + 40, y: PANEL_EXIT.y }, zone.polygon)).toBe(false);
  });
});
