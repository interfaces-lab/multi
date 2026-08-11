import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DevelopmentPerformanceMonitor } from "./performance-monitor";

const router = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => router,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("development performance toolbar", () => {
  it("renders a compact diagnostic summary with inspector access", () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });

    const html = renderToStaticMarkup(<DevelopmentPerformanceMonitor />);

    expect(html.match(/<aside/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Development performance diagnostics"');
    expect(html).toContain("Performance");
    expect(html).toContain("Render");
    expect(html).toContain("Input");
    expect(html).toContain("Heap");
    expect(html).toContain("Inspect");
    expect(html).toContain('aria-label="Hide performance monitor"');
  });
});
