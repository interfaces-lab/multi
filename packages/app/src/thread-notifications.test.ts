import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Session } from "@honk/core/session";

import type { AlertSoundSelection } from "./alert-sound-model";
import type { InventoryState } from "./chat/inventory-model";
import { sessionSummary } from "./test-fixtures";
import type { AddToastInput } from "./toast-store";

interface NotificationSettings {
  alertSoundSelection: AlertSoundSelection;
  alertSoundsEnabled: boolean;
  customAlertSoundFileName: string | null;
  notifyWhenThreadFinishes: boolean;
  notifyWhenThreadNeedsInput: boolean;
}

interface NotificationMocks {
  readonly appSettings: NotificationSettings;
  readonly add: Mock<(input: AddToastInput) => void>;
  readonly clearCustomAlertSound: Mock<() => void>;
  readonly navigate: Mock<(input: unknown) => void>;
  pathname: string;
  readonly playAlertSound: Mock<
    (
      selection: AlertSoundSelection,
      customFileName: string | null,
    ) => Promise<"built-in" | "custom" | "unavailable">
  >;
  readonly retainInventory: Mock<() => () => void>;
  readonly subscribeInventory: Mock<(listener: () => void) => () => void>;
  inventory: InventoryState;
  readonly showSystemThreadNotification: Mock<(input: unknown) => void>;
}

const mocks = vi.hoisted(
  (): NotificationMocks => ({
    appSettings: {
      alertSoundSelection: "custom",
      alertSoundsEnabled: true,
      customAlertSoundFileName: "done.mp3",
      notifyWhenThreadFinishes: true,
      notifyWhenThreadNeedsInput: true,
    },
    add: vi.fn(),
    clearCustomAlertSound: vi.fn(),
    navigate: vi.fn(),
    pathname: "/",
    playAlertSound: vi.fn(() => Promise.resolve("custom")),
    retainInventory: vi.fn(() => () => {}),
    subscribeInventory: vi.fn<(listener: () => void) => () => void>(() => () => {}),
    inventory: { status: "ready", sessions: [], error: null },
    showSystemThreadNotification: vi.fn(),
  }),
);

vi.mock("@honk/shared/paths", () => ({
  basename: (value: string) => value.split("/").at(-1) ?? value,
}));
vi.mock("./app-settings-store", () => ({
  actions: { clearCustomAlertSound: mocks.clearCustomAlertSound },
  getSnapshot: () => mocks.appSettings,
}));
vi.mock("./chat/inventory-store", () => ({
  getInventorySnapshot: () => mocks.inventory,
  retainInventory: mocks.retainInventory,
  subscribeInventory: mocks.subscribeInventory,
}));
vi.mock("./completion-sound", () => ({
  installAlertSoundPlayback: () => () => {},
  playAlertSound: mocks.playAlertSound,
}));
vi.mock("./desktop-bridge", () => ({
  showDesktopThreadNotification: () => false,
  subscribeDesktopThreadNotificationActivate: () => () => {},
}));
vi.mock("./notification-permission", () => ({
  isWindowForeground: () => true,
  showSystemThreadNotification: mocks.showSystemThreadNotification,
}));
vi.mock("./router", () => ({
  router: {
    navigate: mocks.navigate,
    get state() {
      return { location: { pathname: mocks.pathname } };
    },
  },
}));
vi.mock("./toast-store", () => ({
  actions: { add: mocks.add },
}));

const summary = sessionSummary({
  id: "ses_1",
  workspaceId: "ws_1",
  directory: "/repo/feature",
  title: "Fix tab title generation",
  createdAt: "2026-08-07T00:00:00.000Z",
  phase: "turn",
  updatedAt: "2026-08-07T00:00:00.000Z",
});

function emitFrame(sessions: readonly Session.SessionSummary[]): void {
  mocks.inventory = { status: "ready", sessions: [...sessions], error: null };
  mocks.subscribeInventory.mock.calls[0]?.[0]();
}

afterEach(async () => {
  const notifications = await import("./thread-notifications");
  notifications.uninstallThreadNotifications();
  mocks.add.mockClear();
  mocks.clearCustomAlertSound.mockClear();
  mocks.navigate.mockClear();
  mocks.playAlertSound.mockClear();
  mocks.retainInventory.mockClear();
  mocks.subscribeInventory.mockClear();
  mocks.showSystemThreadNotification.mockClear();
  mocks.appSettings.alertSoundSelection = "custom";
  mocks.appSettings.alertSoundsEnabled = true;
  mocks.appSettings.customAlertSoundFileName = "done.mp3";
  mocks.pathname = "/";
  mocks.inventory = { status: "ready", sessions: [], error: null };
});

describe("thread completion alerts", () => {
  it("toasts when a working session settles, with an Open action to its chat route", async () => {
    mocks.inventory = { status: "ready", sessions: [summary], error: null };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    emitFrame([{ ...summary, phase: "idle" }]);

    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "info",
        title: "Fix tab title generation",
        description: "Finished working.",
      }),
    );
    expect(mocks.playAlertSound).toHaveBeenCalledWith("custom", "done.mp3");

    const action = mocks.add.mock.calls[0]?.[0]?.action;
    if (action === undefined) throw new Error("Expected completion toast action");
    action.run();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/chat/$sessionId",
      params: { sessionId: "ses_1" },
    });
  });

  it("retains the inventory watch for the install lifetime", async () => {
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();
    expect(mocks.retainInventory).toHaveBeenCalledOnce();
  });

  it("seeds on first sighting so a full inventory boot does not alert", async () => {
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    emitFrame([{ ...summary, phase: "idle" }]);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("stays silent for the session whose chat route is open", async () => {
    mocks.inventory = { status: "ready", sessions: [summary], error: null };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    mocks.pathname = "/chat/ses_1";
    emitFrame([{ ...summary, phase: "idle" }]);

    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.playAlertSound).not.toHaveBeenCalled();
  });

  it("ignores delegation-owned sessions", async () => {
    const delegated = sessionSummary({
      id: "ses_child",
      workspaceId: summary.workspaceId,
      directory: summary.directory,
      ...(summary.title === undefined ? {} : { title: summary.title }),
      createdAt: summary.createdAt,
      phase: summary.phase,
      updatedAt: summary.updatedAt,
      delegation: { delegationOf: "ses_1", role: "sidekick" },
    });
    mocks.inventory = { status: "ready", sessions: [delegated], error: null };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    emitFrame([{ ...delegated, phase: "idle" }]);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("respects the sound preference", async () => {
    mocks.inventory = { status: "ready", sessions: [summary], error: null };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    mocks.appSettings.alertSoundsEnabled = false;
    emitFrame([{ ...summary, phase: "idle" }]);

    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.playAlertSound).not.toHaveBeenCalled();
  });

  it("clears stale custom metadata when playback falls back to the built-in sound", async () => {
    mocks.playAlertSound.mockResolvedValueOnce("built-in");
    mocks.inventory = { status: "ready", sessions: [summary], error: null };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    emitFrame([{ ...summary, phase: "idle" }]);
    await Promise.resolve();

    expect(mocks.clearCustomAlertSound).toHaveBeenCalledOnce();
  });
});
