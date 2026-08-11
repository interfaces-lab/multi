import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNavigationStore,
  type NavigationSource,
  type NavigationTransition,
} from "./performance-navigation-store";
import { getPerformanceSnapshot, subscribePerformance } from "./performance-monitor-store";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("performance navigation timing", () => {
  it("measures current chat routes through two settled paint frames", () => {
    let beforeNavigate: ((event: NavigationTransition) => void) | undefined;
    let resolved: (() => void) | undefined;
    const source: NavigationSource = {
      subscribeBeforeNavigate(listener) {
        beforeNavigate = listener;
        return () => {
          beforeNavigate = undefined;
        };
      },
      subscribeResolved(listener) {
        resolved = listener;
        return () => {
          resolved = undefined;
        };
      },
    };

    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });

    const runNextFrame = (): void => {
      const next = frames.entries().next();
      if (next.done) throw new Error("Expected a queued animation frame");
      const [id, callback] = next.value;
      frames.delete(id);
      callback(now);
    };

    const store = createNavigationStore(source);
    const snapshots: unknown[] = [];
    const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot()));

    beforeNavigate?.({ fromLocation: { pathname: "/" }, toLocation: { pathname: "/chat/ses_a" } });
    expect(store.getSnapshot()).toEqual({ duration: undefined, pending: true });

    now = 100;
    resolved?.();
    expect(store.getSnapshot()).toEqual({ duration: undefined, pending: true });
    expect(frames).toHaveLength(1);

    runNextFrame();
    expect(store.getSnapshot()).toEqual({ duration: undefined, pending: true });

    now = 145;
    runNextFrame();
    expect(store.getSnapshot()).toEqual({ duration: 145, pending: false });
    expect(snapshots.at(-1)).toEqual({ duration: 145, pending: false });

    unsubscribe();
    expect(beforeNavigate).toBeUndefined();
    expect(resolved).toBeUndefined();
  });

  it("cancels pending work when reset, superseded, or monitoring stops", () => {
    let beforeNavigate: ((event: NavigationTransition) => void) | undefined;
    let resolved: (() => void) | undefined;
    const source: NavigationSource = {
      subscribeBeforeNavigate(listener) {
        beforeNavigate = listener;
        return () => undefined;
      },
      subscribeResolved(listener) {
        resolved = listener;
        return () => undefined;
      },
    };

    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = frames.size + 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });

    const store = createNavigationStore(source);
    const unsubscribe = store.subscribe(() => undefined);
    beforeNavigate?.({
      fromLocation: { pathname: "/chat/ses_a" },
      toLocation: { pathname: "/chat/ses_b" },
    });
    resolved?.();
    expect(frames).toHaveLength(1);

    store.reset();
    expect(store.getSnapshot()).toEqual({ duration: undefined, pending: false });
    expect(frames).toHaveLength(0);

    beforeNavigate?.({
      fromLocation: { pathname: "/chat/ses_a" },
      toLocation: { pathname: "/settings" },
    });
    resolved?.();
    expect(frames).toHaveLength(1);

    beforeNavigate?.({
      fromLocation: { pathname: "/settings" },
      toLocation: { pathname: "/settings/appearance" },
    });
    expect(store.getSnapshot()).toEqual({ duration: undefined, pending: false });
    expect(frames).toHaveLength(0);

    beforeNavigate?.({
      fromLocation: { pathname: "/settings" },
      toLocation: { pathname: "/chat/ses_b" },
    });
    resolved?.();
    expect(store.getSnapshot()).toEqual({ duration: undefined, pending: true });
    expect(frames).toHaveLength(1);

    unsubscribe();
    expect(store.getSnapshot()).toEqual({ duration: undefined, pending: false });
    expect(frames).toHaveLength(0);

    const unsubscribeAgain = store.subscribe(() => undefined);
    expect(store.getSnapshot()).toEqual({ duration: undefined, pending: false });
    unsubscribeAgain();
  });
});

describe("performance monitor lifecycle", () => {
  it("starts from a fresh baseline when the hidden monitor is shown again", () => {
    const documentStub = {
      visibilityState: "hidden",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", documentStub);
    vi.stubGlobal("window", globalThis);
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    class FakePerformanceObserver {
      static readonly supportedEntryTypes = ["layout-shift"];
      readonly disconnect = vi.fn();
      readonly observe = vi.fn();

      constructor(
        private readonly callback: (list: Pick<PerformanceObserverEntryList, "getEntries">) => void,
      ) {
        observers.push(this);
      }

      emit(entries: readonly PerformanceEntry[]): void {
        this.callback({ getEntries: () => [...entries] });
      }
    }

    const observers: FakePerformanceObserver[] = [];
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    const layoutShiftEntry = (startTime: number, value: number) => ({
      duration: 0,
      entryType: "layout-shift",
      hadRecentInput: false,
      name: "",
      startTime,
      toJSON: () => ({}),
      value,
    });
    const oldLayoutShift = layoutShiftEntry(110, 0.1);

    const unsubscribeFirst = subscribePerformance(() => undefined);
    now = 120;
    observers[0]?.emit([oldLayoutShift]);
    expect(getPerformanceSnapshot().cls).toBe(0.1);
    unsubscribeFirst();
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce();

    now = 200;
    const unsubscribeSecond = subscribePerformance(() => undefined);
    observers[1]?.emit([oldLayoutShift]);
    expect(getPerformanceSnapshot().cls).toBe(0);

    observers[1]?.emit([layoutShiftEntry(210, 0.05)]);
    expect(getPerformanceSnapshot().cls).toBe(0.05);
    unsubscribeSecond();
    expect(observers[1]?.disconnect).toHaveBeenCalledOnce();
    expect(documentStub.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
