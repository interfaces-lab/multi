import { afterEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "honk:app:workbench:v1";

async function loadController(stored: string | null, pathname = "/") {
  const entries = new Map<string, string>();
  if (stored !== null) entries.set(STORAGE_KEY, stored);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
    },
    location: { pathname, search: "" },
  });
  vi.resetModules();
  const controller = await import("./workbench-controller");
  return {
    actions: controller.workbenchActions,
    persisted: () => JSON.parse(entries.get(STORAGE_KEY) ?? "null") as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workbench maximized persistence", () => {
  it("loads a snapshot written before the field existed without disturbing its other fields", async () => {
    const controller = await loadController(
      JSON.stringify({ isRailMinimized: true, width: 640, lastTab: "terminal" }),
    );

    controller.actions.setMaximized(true);

    expect(controller.persisted()).toEqual({
      isRailMinimized: true,
      isMaximized: true,
      width: 640,
      lastTab: "terminal",
    });
  });

  it("restores a stored maximized snapshot", async () => {
    const controller = await loadController(
      JSON.stringify({ isRailMinimized: false, isMaximized: true, width: 480, lastTab: "changes" }),
    );

    controller.actions.setRailMinimized(true);

    expect(controller.persisted().isMaximized).toBe(true);
    expect(controller.persisted().width).toBe(480);
  });

  // A stored tab from the removed tool set ("tasks") must fall back rather than
  // resurrect a tool that no longer exists.
  it("drops a stored tab that is no longer a workbench tool", async () => {
    const controller = await loadController(
      JSON.stringify({ isRailMinimized: false, width: 560, lastTab: "tasks" }),
    );

    controller.actions.setMaximized(true);

    expect(controller.persisted().lastTab).toBe("changes");
  });

  it("leaves the preference alone when the chord fires away from a chat thread", async () => {
    const controller = await loadController(
      JSON.stringify({
        isRailMinimized: false,
        isMaximized: false,
        width: 560,
        lastTab: "changes",
      }),
    );

    controller.actions.toggleMaximized();

    expect(controller.persisted().isMaximized).toBe(false);
  });

  it("toggles the preference when the chord fires on a chat thread", async () => {
    const controller = await loadController(
      JSON.stringify({ isRailMinimized: false, isMaximized: true, width: 560, lastTab: "changes" }),
      "/chat/ses_a",
    );

    controller.actions.toggleMaximized();

    expect(controller.persisted().isMaximized).toBe(false);
  });
});
