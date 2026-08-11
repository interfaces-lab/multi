import type { DesktopUpdateState } from "@honk/shared/desktop-api";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(() => false),
  installUpdate: vi.fn(),
  inventory: {
    status: "ready",
    error: null,
    sessions: [
      {
        id: "ses_1",
        workspaceId: "ws_1",
        directory: "/repo/honk",
        title: "Fix tab title generation",
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
        phase: "turn",
      },
    ],
  },
}));

vi.mock("./chat/inventory-store", () => ({
  getInventorySnapshot: () => mocks.inventory,
  subscribeInventory: () => () => {},
}));
vi.mock("./toast-store", () => ({ actions: { add: vi.fn() } }));

import { updatePillActions } from "./update-pill";

const downloaded: DesktopUpdateState = {
  enabled: true,
  status: "downloaded",
  currentVersion: "1.0.0",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: "1.1.0",
  downloadedVersion: "1.1.0",
  downloadPercent: 100,
  checkedAt: "2026-08-09T00:00:00.000Z",
  message: null,
  errorContext: null,
  canRetry: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.confirm.mockClear();
  mocks.installUpdate.mockClear();
});

describe("update install confirmation", () => {
  it("names running tasks with Core's generated session title", async () => {
    vi.stubGlobal("window", {
      confirm: mocks.confirm,
      desktopBridge: {
        getUpdateState: vi.fn(),
        onUpdateState: vi.fn(() => () => {}),
        downloadUpdate: vi.fn(),
        installUpdate: mocks.installUpdate,
      },
    });

    await updatePillActions.install(downloaded);

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining("• Fix tab title generation"),
    );
    expect(mocks.installUpdate).not.toHaveBeenCalled();
  });
});
