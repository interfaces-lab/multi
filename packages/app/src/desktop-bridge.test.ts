import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readDesktopBrowserAvailability,
  readDesktopRemoteAccessAvailability,
  subscribeDesktopMenuAction,
} from "./desktop-bridge";

afterEach(() => vi.unstubAllGlobals());

describe("desktop browser bridge", () => {
  it("distinguishes web from a desktop preload that needs restarting", () => {
    vi.stubGlobal("window", {});
    expect(readDesktopBrowserAvailability().status).toBe("web");

    vi.stubGlobal("window", { desktopBridge: { getWindowID: () => "main" } });
    expect(readDesktopBrowserAvailability().status).toBe("restart-required");
  });

  it("accepts the canonical WebContentsView bridge as one capability", () => {
    const bridge = {
      syncBrowserView: vi.fn(),
      detachBrowserView: vi.fn(),
      commandBrowserView: vi.fn(),
      destroyBrowserView: vi.fn(),
      onBrowserViewState: vi.fn(),
    };
    vi.stubGlobal("window", { desktopBridge: bridge });

    expect(readDesktopBrowserAvailability()).toEqual({ status: "ready", bridge });
  });
});

describe("desktop remote access bridge", () => {
  it("keeps the desktop section visible when a stale preload needs restarting", () => {
    vi.stubGlobal("window", {});
    expect(readDesktopRemoteAccessAvailability().status).toBe("web");

    vi.stubGlobal("window", { desktopBridge: { getWindowID: () => "main" } });
    expect(readDesktopRemoteAccessAvailability().status).toBe("restart-required");
  });

  it("recognizes the complete phone-pairing bridge", () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getTailscaleRemoteAccess: vi.fn(),
        enableTailscaleRemoteAccess: vi.fn(),
        disableTailscaleRemoteAccess: vi.fn(),
        issueRemotePairing: vi.fn(),
        getRemotePairingState: vi.fn(),
        cancelRemotePairing: vi.fn(),
        listRemoteDevices: vi.fn(),
        revokeRemoteDevice: vi.fn(),
      },
    });

    expect(readDesktopRemoteAccessAvailability().status).toBe("ready");
  });
});

describe("desktop menu bridge", () => {
  it("subscribes to native application-menu actions", () => {
    const unsubscribe = vi.fn();
    const onMenuAction = vi.fn(() => unsubscribe);
    const listener = vi.fn();
    vi.stubGlobal("window", { desktopBridge: { onMenuAction } });

    expect(subscribeDesktopMenuAction(listener)).toBe(unsubscribe);
    expect(onMenuAction).toHaveBeenCalledWith(listener);
  });

  it("is a no-op outside the desktop host", () => {
    vi.stubGlobal("window", {});

    expect(() => subscribeDesktopMenuAction(vi.fn())()).not.toThrow();
  });
});
