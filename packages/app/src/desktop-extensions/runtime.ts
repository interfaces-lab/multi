import { useSyncExternalStore } from "react";

import { getInventorySnapshot, subscribeInventory } from "../chat/inventory-store";
import { canSetDesktopKeepAwake, setDesktopKeepAwake } from "../desktop-bridge";
import { HOME_TAB_KEY, tabDescriptors } from "../tab-presentation";
import {
  actions as tabActions,
  getSnapshot as getTabsSnapshot,
  subscribe as subscribeTabs,
} from "../tab-store";
import {
  createHonkDesktopExtensionHost,
  type HonkDesktopCell,
  type HonkDesktopPaneContribution,
  type HonkDesktopSettingsToggleContribution,
  type HonkDesktopTabs,
  type HonkDesktopTabsSnapshot,
  type HonkDesktopTitlebarToggleContribution,
} from "./sdk";
import { keepAwakeExtension } from "./keep-awake/extension";
import { verticalSidebarExtension } from "./vertical-sidebar/extension";

const EMPTY_SETTINGS: readonly HonkDesktopSettingsToggleContribution[] = Object.freeze([]);
const EMPTY_PANES: readonly HonkDesktopPaneContribution[] = Object.freeze([]);
const EMPTY_TITLEBAR_TOGGLES: readonly HonkDesktopTitlebarToggleContribution[] = Object.freeze([]);

// Descriptors are derived, so the snapshot is cached against the two stores it
// reads. `useSyncExternalStore` tears if `getSnapshot` allocates each call.
let tabsSnapshot: HonkDesktopTabsSnapshot = Object.freeze({
  tabs: Object.freeze([]),
  activeKey: HOME_TAB_KEY,
});
let tabsSnapshotSources: readonly [unknown, unknown] = [null, null];

const readTabsSnapshot = (): HonkDesktopTabsSnapshot => {
  const state = getTabsSnapshot();
  const sessions = getInventorySnapshot().sessions;
  if (tabsSnapshotSources[0] === state && tabsSnapshotSources[1] === sessions) {
    return tabsSnapshot;
  }
  tabsSnapshotSources = [state, sessions];
  tabsSnapshot = Object.freeze({
    tabs: tabDescriptors(state, sessions),
    activeKey: state.activeId ?? HOME_TAB_KEY,
  });
  return tabsSnapshot;
};

const tabs: HonkDesktopTabs = Object.freeze({
  getSnapshot: readTabsSnapshot,
  subscribe: (listener: () => void) => {
    const stopTabs = subscribeTabs(listener);
    const stopInventory = subscribeInventory(listener);
    return () => {
      stopTabs();
      stopInventory();
    };
  },
  activate: (key: string) => {
    tabActions.activate(key);
  },
  close: (key: string) => {
    tabActions.close(key);
  },
  create: () => {
    tabActions.openNew();
  },
});

const host = createHonkDesktopExtensionHost({
  storage: desktopExtensionStorage(),
  tabs,
  power: Object.freeze({ setKeepAwake: setDesktopKeepAwake }),
});

let isInstalled = false;

export function installHonkDesktopExtensions(): void {
  if (isInstalled || globalThis.window === undefined) {
    return;
  }
  host.register(verticalSidebarExtension);
  if (canSetDesktopKeepAwake()) {
    host.register(keepAwakeExtension);
  }
  isInstalled = true;
}

export function useHonkDesktopSettings(): readonly HonkDesktopSettingsToggleContribution[] {
  return useSyncExternalStore(
    (listener) => host.subscribeSettings(listener),
    () => host.getSettingsSnapshot(),
    () => EMPTY_SETTINGS,
  );
}

export function useHonkDesktopPanes(): readonly HonkDesktopPaneContribution[] {
  return useSyncExternalStore(
    (listener) => host.subscribePanes(listener),
    () => host.getPanesSnapshot(),
    () => EMPTY_PANES,
  );
}

export function useIsHonkDesktopTabStripHidden(): boolean {
  return useSyncExternalStore(
    (listener) => host.subscribeTitlebar(listener),
    () => host.getTitlebarTabStripHiddenSnapshot(),
    () => false,
  );
}

export function useHonkDesktopTitlebarToggles(): readonly HonkDesktopTitlebarToggleContribution[] {
  return useSyncExternalStore(
    (listener) => host.subscribeTitlebar(listener),
    () => host.getTitlebarTogglesSnapshot(),
    () => EMPTY_TITLEBAR_TOGGLES,
  );
}

export function useHonkDesktopCell<T>(cell: HonkDesktopCell<T>): T {
  return useSyncExternalStore(
    (listener) => cell.subscribe(() => listener()),
    () => cell.get(),
    () => cell.get(),
  );
}

function desktopExtensionStorage(): Pick<Storage, "getItem" | "setItem"> {
  if (globalThis.window !== undefined) {
    return globalThis.window.localStorage;
  }
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
