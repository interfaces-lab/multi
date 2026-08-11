// The window's tab store: module-level state persisted per window under a
// versioned key, reconciled against ready inventory frames only, and bound to
// the router once by `bindTabRouter`. Components read through
// `useTabState`/`useTabsSelector`; navigation always goes through the bound
// controller so the route and the selection cannot drift.

import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import type { Session } from "@honk/core/session";

import { getInventorySnapshot, subscribeInventory } from "./chat/inventory-store";
import { readShellWindowID } from "./desktop-bridge";
import {
  closeTab,
  hydrateTabState,
  openTab,
  removeSessions,
  rememberDirectory,
  reopenClosedTab,
  reorderTabs,
  selectTab,
  serializeTabState,
  showHome,
  type TabState,
} from "./tab-model";
import { createTabController, type TabController, type TabNavigator } from "./tab-controller";
import { HOME_TAB_KEY } from "./tab-presentation";

export const TAB_STORAGE_PREFIX = "honk:tabs:v1:";

export const tabStorageKey = (windowID: string): string =>
  `${TAB_STORAGE_PREFIX}${encodeURIComponent(windowID)}`;

const storageKey = tabStorageKey(globalThis.window === undefined ? "browser" : readShellWindowID());

const readStorage = (): string | null => {
  try {
    return globalThis.window === undefined ? null : window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
};

const listeners = new Set<() => void>();
let snapshot: TabState = hydrateTabState(readStorage());
let controller: TabController | null = null;

function publish(next: TabState): void {
  if (next === snapshot) return;
  snapshot = next;
  try {
    if (globalThis.window !== undefined) {
      window.localStorage.setItem(storageKey, serializeTabState(snapshot));
    }
  } catch {
    // A storage failure must not break the live tab model.
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): TabState {
  return snapshot;
}

export function useTabState(): TabState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useTabsSelector<T>(
  selector: (current: TabState) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getSnapshot, selector, isEqual);
}

// The controller's store surface: pure selection changes, no navigation.
const controllerStore = {
  getActiveId: () => snapshot.activeId,
  select(id: Session.SessionId) {
    publish(selectTab(snapshot, id));
  },
  open(id: Session.SessionId) {
    // A delegation-owned session never becomes a tab. Its thread view stays
    // legitimate ("Open as thread"), so selection falls to Home and the route
    // is left alone.
    const summary = getInventorySnapshot().sessions.find((session) => session.id === id);
    if (summary?.delegation !== undefined) {
      publish(showHome(snapshot));
      return;
    }
    publish(openTab(snapshot, id));
  },
  showHome() {
    publish(showHome(snapshot));
  },
  close(id: Session.SessionId) {
    publish(closeTab(snapshot, id));
  },
  reopenClosed() {
    publish(reopenClosedTab(snapshot));
  },
};

interface BoundRouter {
  readonly subscribe: (
    eventType: "onResolved",
    listener: (event: { readonly toLocation: { readonly href: string } }) => void,
  ) => () => void;
  readonly navigate: (options: Record<string, unknown>) => unknown;
  readonly state: { readonly location: { readonly href: string } };
}

export function bindTabRouter(router: BoundRouter): void {
  controller?.dispose();
  const navigator: TabNavigator = {
    currentHref: () => router.state.location.href,
    navigate(href, options) {
      void router.navigate({ href, ...(options?.replace === true ? { replace: true } : {}) });
    },
    subscribe(listener) {
      return router.subscribe("onResolved", (event) => {
        listener(event.toLocation.href);
      });
    },
  };
  controller = createTabController({ store: controllerStore, navigator });
}

/** Directory for a tab: the live inventory wins, the persisted memory backs it. */
function directoryOf(id: Session.SessionId): string | undefined {
  const inventory = getInventorySnapshot();
  return (
    inventory.sessions.find((session) => session.id === id)?.directory ??
    snapshot.info[id]?.directory
  );
}

const asSessionId = (key: string): Session.SessionId | null => {
  const id = snapshot.tabs.find((candidate) => candidate === key);
  return id ?? null;
};

export const actions = {
  activate(key: string): void {
    if (key === HOME_TAB_KEY) {
      if (controller === null) controllerStore.showHome();
      else controller.showHome();
      return;
    }
    const id = asSessionId(key);
    if (id === null) return;
    if (controller === null) controllerStore.select(id);
    else controller.activate(id);
  },

  close(key: string): void {
    const id = asSessionId(key);
    if (id === null) return;
    if (controller === null) controllerStore.close(id);
    else controller.close(id);
  },

  closeActive(): void {
    const active = snapshot.activeId;
    if (active !== null) actions.close(active);
  },

  /** Indexes arrive from TabStrip with Home pinned at slot 0. */
  reorder(from: number, to: number): void {
    const fromIndex = Math.trunc(from) - 1;
    const toIndex = Math.trunc(to) - 1;
    const ids = [...snapshot.tabs];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= ids.length ||
      toIndex >= ids.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [id] = ids.splice(fromIndex, 1);
    if (id === undefined) return;
    ids.splice(toIndex, 0, id);
    publish(reorderTabs(snapshot, ids));
  },

  reopen(): void {
    if (controller === null) controllerStore.reopenClosed();
    else controller.reopenClosed();
  },

  openNew(): void {
    controller?.openStartPage();
  },

  closeWorkspaceTabs(key: string): void {
    const id = asSessionId(key);
    if (id === null) return;
    const directory = directoryOf(id);
    if (directory === undefined) return;
    for (const candidate of [...snapshot.tabs]) {
      if (directoryOf(candidate) === directory) actions.close(candidate);
    }
  },
} as const;

/**
 * Reconciles against the inventory. Only a ready frame is authoritative: a
 * failed or disconnected stream says nothing about which sessions exist, and
 * dropping tabs on it would destroy the user's window over a transient error.
 */
function reconcileInventory(): void {
  const inventory = getInventorySnapshot();
  if (inventory.status !== "ready") return;
  const summaries = new Map(
    inventory.sessions.map<readonly [string, Session.SessionSummary]>((session) => [
      session.id,
      session,
    ]),
  );
  const stale = [...snapshot.tabs, ...snapshot.closed.map((entry) => entry.id)].filter((id) => {
    const summary = summaries.get(id);
    // Delegation-owned sessions never become tabs.
    return summary === undefined || summary.delegation !== undefined;
  });
  const previousActive = snapshot.activeId;
  // An active delegation-owned tab loses its slot but keeps its route: the
  // user deep-linked into a child thread, and no tab ever owns that view.
  const activeWasDelegationOwned =
    previousActive !== null && summaries.get(previousActive)?.delegation !== undefined;
  let next = removeSessions(snapshot, stale);
  if (activeWasDelegationOwned) next = showHome(next);
  for (const id of next.tabs) {
    const summary = summaries.get(id);
    if (summary !== undefined) next = rememberDirectory(next, id, summary.directory);
  }
  publish(next);
  if (!activeWasDelegationOwned && snapshot.activeId !== previousActive) {
    controller?.repairActive();
  }
}

subscribeInventory(reconcileInventory);
