import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyBrowserViewState,
  browserResourceID,
  browserResourceFor,
  removeBrowserOwners,
  removeBrowserOwnersWhere,
  removeBrowserResource,
  requestBrowserOpen,
  resetBrowserStoreForTests,
} from "./browser-store";

afterEach(() => {
  resetBrowserStoreForTests();
  vi.unstubAllGlobals();
});

function stubDesktopBrowserBridge(
  destroyBrowserView = vi.fn<() => Promise<void>>(async () => undefined),
) {
  vi.stubGlobal("window", {
    desktopBridge: {
      syncBrowserView: vi.fn(),
      detachBrowserView: vi.fn(),
      commandBrowserView: vi.fn(),
      destroyBrowserView,
      onBrowserViewState: vi.fn(() => () => undefined),
      onBrowserAutomationOpen: vi.fn(() => () => undefined),
    },
  });
  return destroyBrowserView;
}

describe("browser resources", () => {
  it("stores a separate URL for each session", () => {
    const first = "ses_browser_one";
    const second = "ses_browser_two";

    requestBrowserOpen(first, "https://example.test/one");
    expect(browserResourceFor(first).getSnapshot()).toMatchObject({
      committedUrl: "",
      inputValue: "https://example.test/one",
      isLoading: true,
    });
    expect(browserResourceFor(second).getSnapshot().committedUrl).toBe("");

    browserResourceFor(first).patch({
      committedUrl: "https://example.test/one",
      isLoading: false,
      canGoBack: true,
    });
    expect(browserResourceFor(first).getSnapshot()).toMatchObject({
      committedUrl: "https://example.test/one",
      isLoading: false,
      canGoBack: true,
    });
  });

  it("applies native view navigation and media state", () => {
    const ref = "ses_native_browser";
    const resource = browserResourceFor(ref);

    applyBrowserViewState({
      browserId: browserResourceID(ref),
      committedUrl: "https://www.youtube.com/watch?v=demo",
      isLoading: false,
      loadError: null,
      canGoBack: true,
      canGoForward: false,
      canPictureInPicture: true,
    });

    expect(resource.getSnapshot()).toMatchObject({
      committedUrl: "https://www.youtube.com/watch?v=demo",
      inputValue: "https://www.youtube.com/watch?v=demo",
      canGoBack: true,
      canPictureInPicture: true,
    });
  });

  it("keeps same-session browser tabs isolated by resource ID", () => {
    const ref = "ses_parallel_browsers";
    const first = browserResourceFor(ref, "browser_one");
    const second = browserResourceFor(ref, "browser_two");

    first.requestNavigation("https://example.test/one");
    applyBrowserViewState({
      browserId: browserResourceID(ref, "browser_two"),
      committedUrl: "https://example.test/two",
      isLoading: false,
      loadError: null,
      canGoBack: false,
      canGoForward: false,
      canPictureInPicture: false,
    });

    expect(first.getSnapshot()).toMatchObject({
      committedUrl: "",
      inputValue: "https://example.test/one",
    });
    expect(second.getSnapshot()).toMatchObject({
      committedUrl: "https://example.test/two",
      inputValue: "https://example.test/two",
    });

    removeBrowserResource(ref, "browser_one");
    removeBrowserResource(ref, "browser_two");
  });

  it("clears renderer state and destroys the native view when its session closes", () => {
    const ref = "ses_unmounted_browser";
    const destroyBrowserView = stubDesktopBrowserBridge();
    requestBrowserOpen(ref, "https://example.test/unmounted");

    removeBrowserOwners([ref]);

    expect(destroyBrowserView).toHaveBeenCalledWith({ browserId: browserResourceID(ref) });
    expect(browserResourceFor(ref).getSnapshot().committedUrl).toBe("");
  });

  it("keeps dynamic workspace browsers when their owner session tab closes", () => {
    const ref = "ses_persistent_browser";
    const destroyBrowserView = stubDesktopBrowserBridge();
    requestBrowserOpen(ref, "https://example.test/default");
    const dynamic = browserResourceFor(ref, "browser_persistent");
    dynamic.requestNavigation("https://example.test/persistent");

    removeBrowserOwners([ref]);

    expect(destroyBrowserView).toHaveBeenCalledTimes(1);
    expect(destroyBrowserView).toHaveBeenCalledWith({ browserId: browserResourceID(ref) });
    expect(dynamic.getSnapshot().inputValue).toBe("https://example.test/persistent");

    removeBrowserResource(ref, "browser_persistent");
    expect(destroyBrowserView).toHaveBeenLastCalledWith({
      browserId: browserResourceID(ref, "browser_persistent"),
    });
  });

  it("destroys every matching browser resource, automation- and user-owned alike", () => {
    const ref = "ses_server_cleanup";
    const destroyBrowserView = stubDesktopBrowserBridge();
    browserResourceFor(ref);
    browserResourceFor(ref, "browser_server_cleanup");

    removeBrowserOwnersWhere((ownerKey) => ownerKey === ref);

    expect(destroyBrowserView).toHaveBeenCalledWith({ browserId: browserResourceID(ref) });
    expect(destroyBrowserView).toHaveBeenCalledWith({
      browserId: browserResourceID(ref, "browser_server_cleanup"),
    });
  });

  it("retains failed native cleanup for an idempotent retry", async () => {
    const ref = "ses_retry_cleanup";
    const destroyBrowserView = stubDesktopBrowserBridge(
      vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("desktop bridge unavailable"))
        .mockResolvedValue(undefined),
    );
    browserResourceFor(ref, "browser_retry_cleanup");

    removeBrowserResource(ref, "browser_retry_cleanup");

    await vi.waitFor(() => {
      removeBrowserResource(ref, "browser_retry_cleanup");
      expect(destroyBrowserView).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      removeBrowserResource(ref, "browser_retry_cleanup");
      expect(destroyBrowserView).toHaveBeenCalledTimes(2);
    });
  });

  it("delivers navigation requests without treating them as committed history", () => {
    const ref = "ses_navigation_request";
    const resource = browserResourceFor(ref);
    let navigationCount = 0;
    const unsubscribe = resource.subscribeNavigation(() => {
      navigationCount += 1;
    });

    requestBrowserOpen(ref, "https://example.test/requested");

    const request = resource.getNavigationRequest();
    expect(request).toMatchObject({ url: "https://example.test/requested" });
    expect(resource.getSnapshot()).toMatchObject({
      committedUrl: "",
      inputValue: "https://example.test/requested",
      isLoading: true,
    });
    expect(navigationCount).toBe(1);

    resource.acknowledgeNavigation(request?.id ?? 0);
    expect(resource.getNavigationRequest()).toBeNull();
    unsubscribe();
    removeBrowserOwners([ref]);
  });
});
