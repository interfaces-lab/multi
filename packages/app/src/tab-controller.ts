// Route↔store sync for the tab strip. User intent (clicks, chords, context
// menu) navigates with push; machine corrections (relaunch restore, inventory
// reconciliation) navigate with replace. Routes the strip does not own —
// /chat's start page, settings, onboarding — leave the selection untouched.

import { Session } from "@honk/core/session";

export interface TabNavigator {
  readonly currentHref: () => string;
  readonly navigate: (href: string, options?: { readonly replace?: boolean }) => void;
  readonly subscribe: (listener: (href: string) => void) => () => void;
}

export interface TabControllerStore {
  readonly getActiveId: () => Session.SessionId | null;
  readonly select: (id: Session.SessionId) => void;
  readonly open: (id: Session.SessionId) => void;
  readonly showHome: () => void;
  readonly close: (id: Session.SessionId) => void;
  readonly reopenClosed: () => void;
}

export type TabRoute =
  | { readonly type: "home" }
  | {
      readonly type: "session";
      readonly id: Session.SessionId;
    };

export const sessionHref = (id: Session.SessionId): string => `/chat/${encodeURIComponent(id)}`;

export const parseTabHref = (href: string): TabRoute | null => {
  const path = href.split(/[?#]/, 1)[0] ?? href;
  if (path === "/") return { type: "home" };
  const match = /^\/chat\/([^/]+)$/.exec(path);
  if (match?.[1] === undefined) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return id.length > 0 ? { type: "session", id: Session.SessionId.make(id) } : null;
  } catch {
    return null;
  }
};

export interface TabController {
  readonly activate: (id: Session.SessionId) => void;
  readonly showHome: () => void;
  readonly close: (id: Session.SessionId) => void;
  readonly reopenClosed: () => void;
  readonly openStartPage: () => void;
  /** Machine correction after reconciliation moved the selection. */
  readonly repairActive: () => void;
  readonly dispose: () => void;
}

export function createTabController(input: {
  readonly store: TabControllerStore;
  readonly navigator: TabNavigator;
}): TabController {
  const { store, navigator } = input;

  const navigateToActive = (replace = false): void => {
    const active = store.getActiveId();
    navigator.navigate(
      active === null ? "/" : sessionHref(active),
      replace ? { replace: true } : undefined,
    );
  };

  const syncFromRoute = (href: string): void => {
    const route = parseTabHref(href);
    if (route === null) return;
    if (route.type === "home") store.showHome();
    // A deep link materializes a tab; reconciliation later removes it if the
    // session is unknown or delegation-owned.
    else store.open(route.id);
  };

  const unsubscribe = navigator.subscribe(syncFromRoute);
  const initialRoute = parseTabHref(navigator.currentHref());
  if (initialRoute?.type === "home" && store.getActiveId() !== null) {
    // The relaunch rule: the persisted active tab beats the Home URL.
    navigateToActive(true);
  } else {
    syncFromRoute(navigator.currentHref());
  }

  return Object.freeze({
    activate(id: Session.SessionId) {
      // The resolved route owns selection. Keeping the current selection until
      // then prevents the tab highlight from outrunning a lazy destination.
      navigator.navigate(sessionHref(id));
    },
    showHome() {
      // The same rule applies in reverse when Home has not loaded in this
      // window yet.
      navigator.navigate("/");
    },
    close(id: Session.SessionId) {
      const previous = store.getActiveId();
      store.close(id);
      if (store.getActiveId() !== previous) navigateToActive();
    },
    reopenClosed() {
      const previous = store.getActiveId();
      store.reopenClosed();
      if (store.getActiveId() !== previous) navigateToActive();
    },
    openStartPage() {
      navigator.navigate("/chat");
    },
    repairActive() {
      navigateToActive(true);
    },
    dispose: unsubscribe,
  });
}
