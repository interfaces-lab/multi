// Settings is shell-owned, not a route. Opening it leaves the active Home/thread route mounted.

import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

export type SettingsSectionId = "general" | "providers" | "tools" | "appearance";

export type SettingsSnapshot = {
  readonly open: boolean;
  readonly section: SettingsSectionId;
};

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

const DEFAULT_SNAPSHOT: SettingsSnapshot = Object.freeze({
  open: false,
  section: DEFAULT_SETTINGS_SECTION,
});

const listeners = new Set<() => void>();

let snapshot = DEFAULT_SNAPSHOT;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): SettingsSnapshot {
  return snapshot;
}

export function getServerSnapshot(): SettingsSnapshot {
  return DEFAULT_SNAPSHOT;
}

export function useSettingsSelector<T>(
  selector: (snapshot: SettingsSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getServerSnapshot,
    selector,
    isEqual,
  );
}

export function useSettings(): SettingsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const actions = {
  open(section: SettingsSectionId = snapshot.section): void {
    publish({ open: true, section });
  },

  close(): void {
    if (!snapshot.open) {
      return;
    }
    publish({ ...snapshot, open: false });
  },

  toggle(): void {
    publish({ ...snapshot, open: !snapshot.open });
  },

  setSection(section: SettingsSectionId): void {
    if (snapshot.section === section) {
      return;
    }
    publish({ ...snapshot, section });
  },
};

function publish(next: SettingsSnapshot): void {
  if (next.open === snapshot.open && next.section === snapshot.section) {
    return;
  }

  snapshot = Object.freeze(next);
  for (const listener of listeners) {
    listener();
  }
}
