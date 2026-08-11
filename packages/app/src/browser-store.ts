import type { DesktopBrowserViewState } from "@honk/shared/desktop-api";

import { readDesktopBrowserAvailability } from "./desktop-bridge";

type BrowserSnapshot = {
  readonly committedUrl: string;
  readonly inputValue: string;
  readonly isLoading: boolean;
  readonly loadError: string | null;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly canPictureInPicture: boolean;
};

type BrowserNavigationRequest = {
  readonly id: number;
  readonly url: string;
};

type BrowserResource = {
  readonly getSnapshot: () => BrowserSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly patch: (update: Partial<BrowserSnapshot>) => void;
  readonly getNavigationRequest: () => BrowserNavigationRequest | null;
  readonly subscribeNavigation: (listener: () => void) => () => void;
  readonly requestNavigation: (url: string) => void;
  readonly acknowledgeNavigation: (id: number) => void;
};

const INITIAL_BROWSER_SNAPSHOT: BrowserSnapshot = Object.freeze({
  committedUrl: "",
  inputValue: "",
  isLoading: false,
  loadError: null,
  canGoBack: false,
  canGoForward: false,
  canPictureInPicture: false,
});

// The owner key is the core session identity. The store only needs it to be
// stable and unique.
type BrowserResourceEntry = {
  readonly ownerKey: string;
  readonly resourceID: string;
  readonly resource: BrowserResource;
};

type PendingBrowserDestroy = {
  readonly entry: BrowserResourceEntry;
  readonly request: Promise<void> | null;
};

const BROWSER_AUTOMATION_RESOURCE_ID = "default";
const resources = new Map<string, BrowserResourceEntry>();
const pendingDestroys = new Map<string, PendingBrowserDestroy>();
let browserViewEventsUnsubscribe: (() => void) | null = null;

function browserResourceID(ownerKey: string, resourceID = BROWSER_AUTOMATION_RESOURCE_ID): string {
  return JSON.stringify([ownerKey, resourceID]);
}

function createBrowserResource(): BrowserResource {
  let snapshot = INITIAL_BROWSER_SNAPSHOT;
  let navigationRequest: BrowserNavigationRequest | null = null;
  let nextNavigationRequestID = 0;
  const listeners = new Set<() => void>();
  const navigationListeners = new Set<() => void>();
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    patch(update) {
      const next = Object.freeze({ ...snapshot, ...update });
      if (
        next.committedUrl === snapshot.committedUrl &&
        next.inputValue === snapshot.inputValue &&
        next.isLoading === snapshot.isLoading &&
        next.loadError === snapshot.loadError &&
        next.canGoBack === snapshot.canGoBack &&
        next.canGoForward === snapshot.canGoForward &&
        next.canPictureInPicture === snapshot.canPictureInPicture
      ) {
        return;
      }
      snapshot = next;
      for (const listener of listeners) listener();
    },
    getNavigationRequest: () => navigationRequest,
    subscribeNavigation(listener) {
      navigationListeners.add(listener);
      return () => navigationListeners.delete(listener);
    },
    requestNavigation(url) {
      navigationRequest = Object.freeze({ id: ++nextNavigationRequestID, url });
      snapshot = Object.freeze({
        ...snapshot,
        inputValue: url,
        isLoading: true,
        loadError: null,
        canPictureInPicture: false,
      });
      for (const listener of listeners) listener();
      for (const listener of navigationListeners) listener();
    },
    acknowledgeNavigation(id) {
      if (navigationRequest?.id === id) navigationRequest = null;
    },
  });
}

function applyBrowserViewState(state: DesktopBrowserViewState): void {
  const resource = resources.get(state.browserId)?.resource;
  if (resource === undefined) return;
  const current = resource.getSnapshot();
  const committedUrl = state.committedUrl;
  resource.patch({
    committedUrl,
    ...(committedUrl.length > 0 && committedUrl !== current.committedUrl
      ? { inputValue: committedUrl }
      : {}),
    isLoading: state.isLoading,
    loadError: state.loadError,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    canPictureInPicture: state.canPictureInPicture,
  });
}

function installBrowserViewEvents(): void {
  if (browserViewEventsUnsubscribe !== null || globalThis.window === undefined) return;
  const availability = readDesktopBrowserAvailability();
  if (availability.status !== "ready") return;
  browserViewEventsUnsubscribe = availability.bridge.onBrowserViewState(applyBrowserViewState);
}

function browserResourceFor(
  ownerKey: string,
  resourceID = BROWSER_AUTOMATION_RESOURCE_ID,
): BrowserResource {
  installBrowserViewEvents();
  const key = browserResourceID(ownerKey, resourceID);
  const existing = resources.get(key)?.resource;
  if (existing !== undefined) return existing;
  const created = createBrowserResource();
  resources.set(key, { ownerKey, resourceID, resource: created });
  return created;
}

function removeBrowserResource(ownerKey: string, resourceID: string): void {
  removeBrowserResourceByID(browserResourceID(ownerKey, resourceID));
}

function removeBrowserResourceByID(browserId: string): void {
  const entry = resources.get(browserId) ?? pendingDestroys.get(browserId)?.entry;
  if (entry === undefined) return;
  resources.delete(browserId);
  const pending = pendingDestroys.get(browserId) ?? { entry, request: null };
  pendingDestroys.set(browserId, pending);
  if (pending.request !== null || globalThis.window === undefined) return;
  const availability = readDesktopBrowserAvailability();
  if (availability.status !== "ready") return;
  const request = availability.bridge.destroyBrowserView({ browserId });
  pendingDestroys.set(browserId, { entry, request });
  void request.then(
    () => {
      if (pendingDestroys.get(browserId)?.request === request) pendingDestroys.delete(browserId);
    },
    () => {
      if (pendingDestroys.get(browserId)?.request === request) {
        pendingDestroys.set(browserId, { entry, request: null });
      }
    },
  );
}

/** Removes the automation-owned resource of each named owner; user-opened browser tabs stay. */
function removeBrowserOwners(ownerKeys: readonly string[]): void {
  const closing = new Set(ownerKeys);
  for (const [browserId, entry] of resources) {
    if (entry.resourceID !== BROWSER_AUTOMATION_RESOURCE_ID || !closing.has(entry.ownerKey)) {
      continue;
    }
    removeBrowserResourceByID(browserId);
  }
  for (const [browserId, pending] of pendingDestroys) {
    if (
      pending.entry.resourceID === BROWSER_AUTOMATION_RESOURCE_ID &&
      closing.has(pending.entry.ownerKey)
    ) {
      removeBrowserResourceByID(browserId);
    }
  }
}

/** Removes every resource whose owner matches, automation- and user-owned alike. */
function removeBrowserOwnersWhere(matches: (ownerKey: string) => boolean): void {
  for (const [browserId, entry] of resources) {
    if (matches(entry.ownerKey)) removeBrowserResourceByID(browserId);
  }
  for (const [browserId, pending] of pendingDestroys) {
    if (matches(pending.entry.ownerKey)) removeBrowserResourceByID(browserId);
  }
}

function requestBrowserOpen(ownerKey: string, url?: string): void {
  const resource = browserResourceFor(ownerKey);
  if (url !== undefined) resource.requestNavigation(url);
}

function resetBrowserStoreForTests(): void {
  browserViewEventsUnsubscribe?.();
  browserViewEventsUnsubscribe = null;
  resources.clear();
  pendingDestroys.clear();
}

export {
  BROWSER_AUTOMATION_RESOURCE_ID,
  applyBrowserViewState,
  browserResourceID,
  browserResourceFor,
  removeBrowserOwners,
  removeBrowserOwnersWhere,
  removeBrowserResource,
  requestBrowserOpen,
  resetBrowserStoreForTests,
};
export type { BrowserNavigationRequest, BrowserResource, BrowserSnapshot };
