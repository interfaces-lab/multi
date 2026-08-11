import type { TabDescriptor } from "@honk/ui";
import { Option, Schema } from "effect";
import type { ReactNode } from "react";

export type HonkDesktopDispose = () => void;

export interface HonkDesktopCell<T> {
  get(): T;
  set(value: T | ((current: T) => T)): void;
  subscribe(listener: (value: T) => void): HonkDesktopDispose;
}

export interface HonkDesktopStateValueOptions<T> {
  readonly default: T;
  readonly decode: (value: unknown) => T | undefined;
}

export interface HonkDesktopExtensionState {
  boolean(key: string, defaultValue: boolean): HonkDesktopCell<boolean>;
  number(
    key: string,
    defaultValue: number,
    options?: { readonly min?: number; readonly max?: number },
  ): HonkDesktopCell<number>;
  string(key: string, defaultValue: string): HonkDesktopCell<string>;
  value<T>(key: string, options: HonkDesktopStateValueOptions<T>): HonkDesktopCell<T>;
}

export interface HonkDesktopExtensionLifecycle {
  readonly signal: AbortSignal;
  own(dispose: HonkDesktopDispose): HonkDesktopDispose;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): HonkDesktopDispose;
  observe(
    target: Node,
    options: MutationObserverInit,
    callback: MutationCallback,
  ): HonkDesktopDispose;
}

export interface HonkDesktopTabsSnapshot {
  readonly tabs: readonly TabDescriptor[];
  readonly activeKey: string;
}

// The window's open tabs, projected for any extension that renders its own tab
// surface. `create` takes no anchor: core has no draft tabs, so a new thread
// always begins at the start page.
export interface HonkDesktopTabs {
  getSnapshot(): HonkDesktopTabsSnapshot;
  subscribe(listener: () => void): HonkDesktopDispose;
  activate(key: string): void;
  close(key: string): void;
  create(): void;
}

export interface HonkDesktopSettingsToggleOptions {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly section?: "general" | "appearance";
  readonly value: HonkDesktopCell<boolean>;
  readonly presentation?: {
    readonly kind: "tab-style";
    readonly offLabel: string;
    readonly onLabel: string;
  };
  readonly order?: number;
}

export interface HonkDesktopSettings {
  toggle(options: HonkDesktopSettingsToggleOptions): HonkDesktopDispose;
}

export type HonkDesktopPaneSide = "left" | "right";

export interface HonkDesktopPaneOptions {
  readonly id: string;
  readonly side: HonkDesktopPaneSide;
  readonly open?: boolean | HonkDesktopCell<boolean>;
  readonly size: number | HonkDesktopCell<number>;
  readonly minSize?: number;
  readonly maxSize?: number;
  readonly resizable?: boolean;
  readonly order?: number;
  readonly render: () => ReactNode;
}

export interface HonkDesktopPane {
  readonly open: HonkDesktopCell<boolean>;
  readonly size: HonkDesktopCell<number>;
  show(): void;
  hide(): void;
  toggle(): void;
  resize(size: number): void;
  dispose(): void;
}

export interface HonkDesktopPanes {
  add(options: HonkDesktopPaneOptions): HonkDesktopPane;
}

export interface HonkDesktopTitlebar {
  // An extension that renders tabs elsewhere claims the titlebar strip so the
  // window never shows both at once.
  tabStrip(options: {
    readonly id: string;
    readonly hidden: HonkDesktopCell<boolean>;
  }): HonkDesktopDispose;
  toggle(options: {
    readonly id: string;
    readonly label: string;
    readonly value: HonkDesktopCell<boolean>;
    readonly icon: (active: boolean) => ReactNode;
    readonly order?: number;
  }): HonkDesktopDispose;
}

export interface HonkDesktopPower {
  setKeepAwake(enabled: boolean): Promise<boolean>;
}

export interface HonkDesktopExtensionContext {
  readonly id: string;
  readonly lifecycle: HonkDesktopExtensionLifecycle;
  readonly state: HonkDesktopExtensionState;
  readonly desktop: {
    readonly power: HonkDesktopPower;
    readonly titlebar: HonkDesktopTitlebar;
    readonly settings: HonkDesktopSettings;
    readonly panes: HonkDesktopPanes;
    readonly tabs: HonkDesktopTabs;
  };
}

export interface HonkDesktopExtensionDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  activate(context: HonkDesktopExtensionContext): void | HonkDesktopDispose;
}

export interface HonkDesktopExtensionIdentity {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface HonkDesktopSettingsToggleContribution extends HonkDesktopSettingsToggleOptions {
  readonly key: string;
  readonly extension: HonkDesktopExtensionIdentity;
}

export interface HonkDesktopTitlebarToggleContribution {
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly value: HonkDesktopCell<boolean>;
  readonly icon: (active: boolean) => ReactNode;
  readonly order?: number;
  readonly extension: HonkDesktopExtensionIdentity;
}

export interface HonkDesktopPaneContribution {
  readonly key: string;
  readonly extension: HonkDesktopExtensionIdentity;
  readonly side: HonkDesktopPaneSide;
  readonly isOpen: boolean;
  readonly size: number;
  readonly minSize: number;
  readonly maxSize: number;
  readonly resizable: boolean;
  readonly order: number;
  readonly render: () => ReactNode;
  readonly controller: HonkDesktopPane;
}

export interface HonkDesktopExtensionHost {
  register(extension: HonkDesktopExtensionDefinition): HonkDesktopDispose;
  subscribeSettings(listener: () => void): HonkDesktopDispose;
  getSettingsSnapshot(): readonly HonkDesktopSettingsToggleContribution[];
  subscribePanes(listener: () => void): HonkDesktopDispose;
  getPanesSnapshot(): readonly HonkDesktopPaneContribution[];
  subscribeTitlebar(listener: () => void): HonkDesktopDispose;
  getTitlebarTabStripHiddenSnapshot(): boolean;
  getTitlebarTogglesSnapshot(): readonly HonkDesktopTitlebarToggleContribution[];
  dispose(): void;
}

export interface HonkDesktopExtensionHostOptions {
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  readonly tabs: HonkDesktopTabs;
  readonly power: HonkDesktopPower;
  readonly onError?: (error: unknown, extensionID: string) => void;
}

type InternalTitlebarRecord = {
  readonly key: string;
  readonly hidden: HonkDesktopCell<boolean>;
};

type InternalPaneRecord = {
  readonly key: string;
  readonly extension: HonkDesktopExtensionIdentity;
  readonly options: HonkDesktopPaneOptions;
  readonly open: HonkDesktopCell<boolean>;
  readonly size: HonkDesktopCell<number>;
  readonly minSize: number;
  readonly maxSize: number;
  readonly controller: HonkDesktopPane;
};

const DEFAULT_PANE_MIN_SIZE = 160;
const DEFAULT_PANE_MAX_SIZE = 800;
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);
const decodeFiniteNumber = Schema.decodeUnknownOption(Schema.Finite);
const decodeString = Schema.decodeUnknownOption(Schema.String);

export function defineHonkDesktopExtension<T extends HonkDesktopExtensionDefinition>(
  extension: T,
): T {
  return extension;
}

export function createHonkDesktopCell<T>(
  initial: T,
  onChange?: (value: T) => void,
): HonkDesktopCell<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();

  return {
    get: () => value,
    set(next) {
      const nextValue = next instanceof Function ? next(value) : next;
      if (Object.is(value, nextValue)) {
        return;
      }
      value = nextValue;
      onChange?.(value);
      for (const listener of listeners) {
        listener(value);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createHonkDesktopExtensionHost(
  options: HonkDesktopExtensionHostOptions,
): HonkDesktopExtensionHost {
  const settings = new Map<string, HonkDesktopSettingsToggleContribution>();
  const panes = new Map<string, InternalPaneRecord>();
  const titlebarTabStrips = new Map<string, InternalTitlebarRecord>();
  const titlebarToggles = new Map<string, HonkDesktopTitlebarToggleContribution>();
  const activeExtensions = new Map<string, HonkDesktopDispose>();
  const settingsListeners = new Set<() => void>();
  const paneListeners = new Set<() => void>();
  const titlebarListeners = new Set<() => void>();

  let settingsSnapshot: readonly HonkDesktopSettingsToggleContribution[] = Object.freeze([]);
  let paneSnapshot: readonly HonkDesktopPaneContribution[] = Object.freeze([]);
  let titlebarToggleSnapshot: readonly HonkDesktopTitlebarToggleContribution[] = Object.freeze([]);
  let isTitlebarTabStripHidden = false;

  const report = (error: unknown, extensionID: string): void => {
    if (options.onError !== undefined) {
      options.onError(error, extensionID);
      return;
    }
    console.error(`[honk:desktop-extension:${extensionID}]`, error);
  };

  const publishSettings = (): void => {
    settingsSnapshot = Object.freeze(
      [...settings.values()].sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) || left.title.localeCompare(right.title),
      ),
    );
    notify(settingsListeners);
  };

  const publishPanes = (): void => {
    paneSnapshot = Object.freeze(
      [...panes.values()]
        .map(
          (record): HonkDesktopPaneContribution =>
            Object.freeze({
              key: record.key,
              extension: record.extension,
              side: record.options.side,
              isOpen: record.open.get(),
              size: clampPaneSize(record.size.get(), record.minSize, record.maxSize),
              minSize: record.minSize,
              maxSize: record.maxSize,
              resizable: record.options.resizable ?? true,
              order: record.options.order ?? 0,
              render: record.options.render,
              controller: record.controller,
            }),
        )
        .sort(
          (left, right) =>
            left.side.localeCompare(right.side) ||
            left.order - right.order ||
            left.key.localeCompare(right.key),
        ),
    );
    notify(paneListeners);
  };

  const publishTitlebar = (): void => {
    const nextHidden = [...titlebarTabStrips.values()].some((record) => record.hidden.get());
    const nextToggles = Object.freeze(
      [...titlebarToggles.values()].sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) || left.label.localeCompare(right.label),
      ),
    );
    if (
      nextHidden === isTitlebarTabStripHidden &&
      nextToggles.length === titlebarToggleSnapshot.length &&
      nextToggles.every((toggle, index) => toggle === titlebarToggleSnapshot[index])
    ) {
      return;
    }
    isTitlebarTabStripHidden = nextHidden;
    titlebarToggleSnapshot = nextToggles;
    notify(titlebarListeners);
  };

  const register = (extension: HonkDesktopExtensionDefinition): HonkDesktopDispose => {
    validateIdentifier(extension.id, "extension");
    if (extension.name.trim().length === 0 || extension.version.trim().length === 0) {
      throw new Error("Honk desktop extensions require a name and version.");
    }

    activeExtensions.get(extension.id)?.();

    const identity: HonkDesktopExtensionIdentity = Object.freeze({
      id: extension.id,
      name: extension.name,
      version: extension.version,
    });
    const owned = new Set<HonkDesktopDispose>();
    const own = (dispose: HonkDesktopDispose): HonkDesktopDispose => {
      const cleanup = once(dispose);
      owned.add(cleanup);
      return () => {
        if (!owned.delete(cleanup)) {
          return;
        }
        cleanup();
      };
    };
    const cleanupOwned = (): void => {
      for (const cleanup of [...owned].reverse()) {
        try {
          cleanup();
        } catch (error) {
          report(error, extension.id);
        }
      }
      owned.clear();
    };

    const controller = new AbortController();
    own(() => {
      controller.abort();
    });

    const addSetting = (setting: HonkDesktopSettingsToggleOptions): HonkDesktopDispose => {
      validateIdentifier(setting.id, "settings contribution");
      const key = contributionKey(extension.id, setting.id);
      if (settings.has(key)) {
        throw new Error(`Duplicate Honk desktop settings contribution: ${key}`);
      }
      const contribution = Object.freeze({ ...setting, key, extension: identity });
      settings.set(key, contribution);
      publishSettings();
      return own(() => {
        if (settings.delete(key)) {
          publishSettings();
        }
      });
    };

    const addTitlebarTabStrip = (input: {
      readonly id: string;
      readonly hidden: HonkDesktopCell<boolean>;
    }): HonkDesktopDispose => {
      validateIdentifier(input.id, "titlebar contribution");
      const key = contributionKey(extension.id, input.id);
      if (titlebarTabStrips.has(key)) {
        throw new Error(`Duplicate Honk desktop titlebar contribution: ${key}`);
      }
      titlebarTabStrips.set(key, Object.freeze({ key, hidden: input.hidden }));
      const unsubscribe = input.hidden.subscribe(publishTitlebar);
      publishTitlebar();
      return own(() => {
        unsubscribe();
        if (titlebarTabStrips.delete(key)) {
          publishTitlebar();
        }
      });
    };

    const addTitlebarToggle = (toggle: {
      readonly id: string;
      readonly label: string;
      readonly value: HonkDesktopCell<boolean>;
      readonly icon: (active: boolean) => ReactNode;
      readonly order?: number;
    }): HonkDesktopDispose => {
      validateIdentifier(toggle.id, "titlebar contribution");
      const key = contributionKey(extension.id, toggle.id);
      if (titlebarToggles.has(key)) {
        throw new Error(`Duplicate Honk desktop titlebar contribution: ${key}`);
      }
      titlebarToggles.set(key, Object.freeze({ ...toggle, key, extension: identity }));
      publishTitlebar();
      return own(() => {
        if (titlebarToggles.delete(key)) {
          publishTitlebar();
        }
      });
    };

    const addPane = (paneOptions: HonkDesktopPaneOptions): HonkDesktopPane => {
      validateIdentifier(paneOptions.id, "pane contribution");
      const key = contributionKey(extension.id, paneOptions.id);
      if (panes.has(key)) {
        throw new Error(`Duplicate Honk desktop pane contribution: ${key}`);
      }
      const minSize = Math.round(paneOptions.minSize ?? DEFAULT_PANE_MIN_SIZE);
      const maxSize = Math.round(paneOptions.maxSize ?? DEFAULT_PANE_MAX_SIZE);
      if (minSize <= 0 || maxSize < minSize) {
        throw new Error(`Invalid size range for Honk desktop pane: ${key}`);
      }
      const openOption = paneOptions.open;
      const open =
        openOption === undefined
          ? createHonkDesktopCell(true)
          : openOption === true || openOption === false
            ? createHonkDesktopCell(openOption)
            : openOption;
      const sizeOption = paneOptions.size;
      const size = sizeOption instanceof Object ? sizeOption : createHonkDesktopCell(sizeOption);
      size.set((current) => clampPaneSize(current, minSize, maxSize));

      let unsubscribeOpen: HonkDesktopDispose = () => {};
      let unsubscribeSize: HonkDesktopDispose = () => {};
      const remove = once(() => {
        unsubscribeOpen();
        unsubscribeSize();
        if (panes.delete(key)) {
          publishPanes();
        }
      });
      const dispose = own(remove);
      const pane: HonkDesktopPane = Object.freeze({
        open,
        size,
        show: () => {
          open.set(true);
        },
        hide: () => {
          open.set(false);
        },
        toggle: () => {
          open.set((current) => !current);
        },
        resize: (nextSize: number) => {
          size.set(clampPaneSize(nextSize, minSize, maxSize));
        },
        dispose,
      });
      const record: InternalPaneRecord = Object.freeze({
        key,
        extension: identity,
        options: paneOptions,
        open,
        size,
        minSize,
        maxSize,
        controller: pane,
      });
      panes.set(key, record);
      unsubscribeOpen = open.subscribe(publishPanes);
      unsubscribeSize = size.subscribe(publishPanes);
      publishPanes();
      return pane;
    };

    const lifecycle: HonkDesktopExtensionLifecycle = Object.freeze({
      signal: controller.signal,
      own,
      listen(
        target: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject,
        listenerOptions?: AddEventListenerOptions | boolean,
      ) {
        target.addEventListener(type, listener, listenerOptions);
        return own(() => {
          target.removeEventListener(type, listener, listenerOptions);
        });
      },
      observe(target: Node, observerOptions: MutationObserverInit, callback: MutationCallback) {
        const observer = new MutationObserver(callback);
        observer.observe(target, observerOptions);
        return own(() => {
          observer.disconnect();
        });
      },
    });
    const context: HonkDesktopExtensionContext = Object.freeze({
      id: extension.id,
      lifecycle,
      state: createExtensionState(options.storage, extension.id),
      desktop: Object.freeze({
        power: options.power,
        titlebar: Object.freeze({ tabStrip: addTitlebarTabStrip, toggle: addTitlebarToggle }),
        settings: Object.freeze({ toggle: addSetting }),
        panes: Object.freeze({ add: addPane }),
        tabs: options.tabs,
      }),
    });

    try {
      const extensionDispose = extension.activate(context);
      if (extensionDispose !== undefined) {
        own(extensionDispose);
      }
    } catch (error) {
      cleanupOwned();
      report(error, extension.id);
      throw error;
    }

    const dispose = once(() => {
      cleanupOwned();
      if (activeExtensions.get(extension.id) === dispose) {
        activeExtensions.delete(extension.id);
      }
    });
    activeExtensions.set(extension.id, dispose);
    return dispose;
  };

  const host: HonkDesktopExtensionHost = Object.freeze({
    register,
    subscribeSettings(listener: () => void) {
      settingsListeners.add(listener);
      return () => {
        settingsListeners.delete(listener);
      };
    },
    getSettingsSnapshot: () => settingsSnapshot,
    subscribePanes(listener: () => void) {
      paneListeners.add(listener);
      return () => {
        paneListeners.delete(listener);
      };
    },
    getPanesSnapshot: () => paneSnapshot,
    subscribeTitlebar(listener: () => void) {
      titlebarListeners.add(listener);
      return () => {
        titlebarListeners.delete(listener);
      };
    },
    getTitlebarTabStripHiddenSnapshot: () => isTitlebarTabStripHidden,
    getTitlebarTogglesSnapshot: () => titlebarToggleSnapshot,
    dispose() {
      for (const dispose of [...activeExtensions.values()].reverse()) {
        dispose();
      }
      activeExtensions.clear();
      settings.clear();
      panes.clear();
      titlebarTabStrips.clear();
      titlebarToggles.clear();
      publishSettings();
      publishPanes();
      publishTitlebar();
    },
  });
  return host;
}

function createExtensionState(
  storage: Pick<Storage, "getItem" | "setItem">,
  extensionID: string,
): HonkDesktopExtensionState {
  const create = <T>(key: string, valueOptions: HonkDesktopStateValueOptions<T>) => {
    validateIdentifier(key, "state key");
    const storageKey = `honk.desktop.extension.${extensionID}.${key}`;
    const stored = readStoredValue(storage, storageKey, valueOptions.decode);
    return createHonkDesktopCell(stored === undefined ? valueOptions.default : stored, (value) => {
      try {
        storage.setItem(storageKey, JSON.stringify(value));
      } catch {
        return;
      }
    });
  };

  const state: HonkDesktopExtensionState = {
    boolean(key: string, defaultValue: boolean) {
      return create(key, {
        default: defaultValue,
        decode: (value) => Option.getOrUndefined(decodeBoolean(value)),
      });
    },
    number(
      key: string,
      defaultValue: number,
      numberOptions: { readonly min?: number; readonly max?: number } = {},
    ) {
      const clamp = (value: number): number =>
        Math.max(numberOptions.min ?? -Infinity, Math.min(numberOptions.max ?? Infinity, value));
      const cell = create(key, {
        default: clamp(defaultValue),
        decode: (value) => {
          const decoded = Option.getOrUndefined(decodeFiniteNumber(value));
          return decoded === undefined ? undefined : clamp(decoded);
        },
      });
      return Object.freeze({
        ...cell,
        set(value: number | ((current: number) => number)) {
          cell.set((current) => clamp(value instanceof Function ? value(current) : value));
        },
      });
    },
    string(key: string, defaultValue: string) {
      return create(key, {
        default: defaultValue,
        decode: (value) => Option.getOrUndefined(decodeString(value)),
      });
    },
    value<T>(key: string, valueOptions: HonkDesktopStateValueOptions<T>): HonkDesktopCell<T> {
      return create(key, valueOptions);
    },
  };
  return Object.freeze(state);
}

function readStoredValue<T>(
  storage: Pick<Storage, "getItem">,
  key: string,
  decode: (value: unknown) => T | undefined,
): T | undefined {
  try {
    const stored = storage.getItem(key);
    return stored === null ? undefined : decode(JSON.parse(stored));
  } catch {
    return undefined;
  }
}

function contributionKey(extensionID: string, contributionID: string): string {
  return `${extensionID}/${contributionID}`;
}

function validateIdentifier(value: string, label: string): void {
  if (!EXTENSION_ID_PATTERN.test(value)) {
    throw new Error(`Invalid Honk desktop ${label} ID: ${value}`);
  }
}

function clampPaneSize(value: number, minSize: number, maxSize: number): number {
  if (!Number.isFinite(value)) {
    return minSize;
  }
  return Math.max(minSize, Math.min(maxSize, Math.round(value)));
}

function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) {
    listener();
  }
}

function once(dispose: HonkDesktopDispose): HonkDesktopDispose {
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    dispose();
  };
}
