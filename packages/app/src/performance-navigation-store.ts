import type { NavigationSnapshot } from "./performance-monitor-model";
import { parseTabHref } from "./tab-controller";

type NavigationTransition = {
  readonly fromLocation?: { readonly pathname: string };
  readonly toLocation: { readonly pathname: string };
};

type NavigationSource = {
  readonly subscribeBeforeNavigate: (listener: (event: NavigationTransition) => void) => () => void;
  readonly subscribeResolved: (listener: () => void) => () => void;
};

type NavigationStore = {
  readonly getSnapshot: () => NavigationSnapshot;
  readonly reset: () => void;
  readonly subscribe: (listener: () => void) => () => void;
};

const EMPTY_NAVIGATION_SNAPSHOT: NavigationSnapshot = {
  duration: undefined,
  pending: false,
};

function matchesSessionPath(pathname: string): boolean {
  return parseTabHref(pathname)?.type === "session";
}

function createNavigationStore(source: NavigationSource): NavigationStore {
  let snapshot = EMPTY_NAVIGATION_SNAPSHOT;
  let startedAt: number | null = null;
  let firstPaintFrame = 0;
  let secondPaintFrame = 0;
  let stopRouterSubscriptions: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: NavigationSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const cancelPaintFrames = (): void => {
    if (firstPaintFrame !== 0) cancelAnimationFrame(firstPaintFrame);
    if (secondPaintFrame !== 0) cancelAnimationFrame(secondPaintFrame);
    firstPaintFrame = 0;
    secondPaintFrame = 0;
  };

  const startRouterSubscriptions = (): (() => void) => {
    const stopBeforeNavigate = source.subscribeBeforeNavigate((event) => {
      const fromPath = event.fromLocation?.pathname ?? "";
      const toPath = event.toLocation.pathname;
      cancelPaintFrames();
      if (!(matchesSessionPath(fromPath) || matchesSessionPath(toPath))) {
        startedAt = null;
        if (snapshot.pending) {
          publish(EMPTY_NAVIGATION_SNAPSHOT);
        }
        return;
      }
      startedAt = performance.now();
      publish({ duration: undefined, pending: true });
    });
    const stopResolved = source.subscribeResolved(() => {
      if (startedAt === null) return;
      const transitionStartedAt = startedAt;
      startedAt = null;
      cancelPaintFrames();
      firstPaintFrame = requestAnimationFrame(() => {
        firstPaintFrame = 0;
        secondPaintFrame = requestAnimationFrame(() => {
          secondPaintFrame = 0;
          publish({ duration: performance.now() - transitionStartedAt, pending: false });
        });
      });
    });
    return () => {
      stopBeforeNavigate();
      stopResolved();
      startedAt = null;
      cancelPaintFrames();
      snapshot = EMPTY_NAVIGATION_SNAPSHOT;
    };
  };

  return {
    getSnapshot: () => snapshot,
    reset() {
      startedAt = null;
      cancelPaintFrames();
      publish(EMPTY_NAVIGATION_SNAPSHOT);
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) stopRouterSubscriptions = startRouterSubscriptions();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopRouterSubscriptions?.();
          stopRouterSubscriptions = null;
        }
      };
    },
  };
}

export { createNavigationStore, EMPTY_NAVIGATION_SNAPSHOT };
export type { NavigationSource, NavigationStore, NavigationTransition };
