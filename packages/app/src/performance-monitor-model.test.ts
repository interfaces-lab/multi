import { describe, expect, it } from "vitest";

import {
  buildPerformanceDiagnostics,
  formatPerformanceSnapshot,
  type NavigationSnapshot,
  type PerformanceSnapshot,
} from "./performance-monitor-model";

const EMPTY_NAVIGATION: NavigationSnapshot = { duration: undefined, pending: false };

function snapshot(overrides: Partial<PerformanceSnapshot> = {}): PerformanceSnapshot {
  return {
    cls: undefined,
    delay: undefined,
    fps: undefined,
    frame: undefined,
    heap: { limit: undefined, used: undefined },
    inp: undefined,
    jank: undefined,
    longTask: { blocked: undefined, count: undefined, max: undefined },
    ...overrides,
  };
}

describe("performance diagnostics", () => {
  it("starts with a useful measuring state instead of nine unexplained N/A values", () => {
    const diagnostics = buildPerformanceDiagnostics(snapshot(), EMPTY_NAVIGATION);

    expect(diagnostics.statusLabel).toBe("Measuring…");
    expect(diagnostics.headline).toBe("Use Honk to collect a 5s sample");
    expect(diagnostics.issues).toEqual([]);
    expect(diagnostics.quickMetrics.map((metric) => metric.value)).toEqual(["—", "—", "—"]);
  });

  it("summarizes healthy measurements with units and binary heap units", () => {
    const diagnostics = buildPerformanceDiagnostics(
      snapshot({
        cls: 0,
        delay: 9,
        fps: 120,
        frame: 12,
        heap: { limit: 1_024 * 1_024 * 1_024, used: 32 * 1_024 * 1_024 },
        inp: 16,
        jank: 0,
        longTask: { blocked: 0, count: 0, max: 0 },
      }),
      { duration: 88, pending: false },
    );

    expect(diagnostics.statusLabel).toBe("Within thresholds");
    expect(diagnostics.headline).toBe("5s window · last chat navigation · current heap");
    expect(diagnostics.quickMetrics).toEqual([
      { key: "render", label: "Render", value: "120 fps" },
      { key: "input", label: "Input", value: "16ms" },
      { key: "heap", label: "Heap", value: "3%" },
    ]);
    expect(diagnostics.groups[2]?.metrics[1]?.value).toBe("3% · 32.0MiB / 1024MiB");
  });

  it("folds correlated frame failures into one rendering diagnosis", () => {
    const diagnostics = buildPerformanceDiagnostics(
      snapshot({ fps: 40, frame: 75, jank: 12 }),
      EMPTY_NAVIGATION,
    );

    expect(diagnostics.statusLabel).toBe("1 issue");
    expect(diagnostics.issues).toHaveLength(1);
    expect(diagnostics.issues[0]).toMatchObject({
      key: "rendering",
      title: "Rendering is dropping frames",
      measurement: "40 fps · 75ms worst frame · 12 janky frames",
    });
  });

  it("prioritizes the largest threshold breach and keeps related diagnoses", () => {
    const diagnostics = buildPerformanceDiagnostics(
      snapshot({
        delay: 130,
        fps: 49,
        inp: 500,
        longTask: { blocked: 250, count: 2, max: 180 },
      }),
      { duration: 450, pending: false },
    );

    expect(diagnostics.statusLabel).toBe("4 issues");
    expect(diagnostics.issues.map((issue) => issue.key)).toEqual([
      "interaction",
      "main-thread",
      "navigation",
      "rendering",
    ]);
    expect(diagnostics.headline).toContain("Interaction is slow");
  });

  it("does not treat exact thresholds or a zero heap limit as failures", () => {
    const diagnostics = buildPerformanceDiagnostics(
      snapshot({
        cls: 0.1,
        delay: 100,
        fps: 50,
        frame: 50,
        heap: { limit: 0, used: 10 },
        inp: 200,
        jank: 8,
        longTask: { blocked: 200, count: 1, max: 250 },
      }),
      { duration: 400, pending: false },
    );

    expect(diagnostics.issues).toEqual([]);
    expect(diagnostics.groups[2]?.metrics[1]).toMatchObject({ isDim: true, value: "—" });
  });

  it("formats a copyable report with route, timestamp, scopes, and next steps", () => {
    const diagnostics = buildPerformanceDiagnostics(snapshot({ fps: 30, frame: 80, jank: 10 }), {
      duration: 90,
      pending: false,
    });
    const report = formatPerformanceSnapshot(
      diagnostics,
      new Date("2026-08-09T12:00:00.000Z"),
      "/chat/ses_123",
    );

    expect(report).toContain("Captured: 2026-08-09T12:00:00.000Z");
    expect(report).toContain("Route: /chat/ses_123");
    expect(report).toContain("Frame rate: 30 fps");
    expect(report).toContain("1. Rendering is dropping frames");
    expect(report).toContain("Next: Record a Performance trace while reproducing.");
  });
});
