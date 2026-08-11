import { describe, expect, it } from "vitest";

import { Session } from "@honk/core/session";

import {
  createTabController,
  parseTabHref,
  sessionHref,
  type TabControllerStore,
  type TabNavigator,
} from "./tab-controller";
import {
  closeTab,
  createTabState,
  openTab,
  reopenClosedTab,
  selectTab,
  showHome,
  type TabState,
} from "./tab-model";

const id = (value: string): Session.SessionId => Session.SessionId.make(value);

function createMemoryStore(initial: TabState = createTabState()): TabControllerStore & {
  readonly state: () => TabState;
} {
  let state = initial;
  return {
    state: () => state,
    getActiveId: () => state.activeId,
    select(sessionId) {
      state = selectTab(state, sessionId);
    },
    open(sessionId) {
      state = openTab(state, sessionId);
    },
    showHome() {
      state = showHome(state);
    },
    close(sessionId) {
      state = closeTab(state, sessionId);
    },
    reopenClosed() {
      state = reopenClosedTab(state);
    },
  };
}

function createNavigator(initialHref: string): TabNavigator & {
  readonly navigations: { readonly href: string; readonly replace: boolean }[];
} {
  let href = initialHref;
  const listeners = new Set<(next: string) => void>();
  const navigations: { readonly href: string; readonly replace: boolean }[] = [];
  return {
    navigations,
    currentHref: () => href,
    navigate(next, options) {
      href = next;
      navigations.push({ href: next, replace: options?.replace === true });
      for (const listener of listeners) listener(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function createDeferredNavigator(initialHref: string): TabNavigator & {
  readonly pendingHref: () => string | null;
  readonly resolvePending: () => void;
} {
  let href = initialHref;
  let pendingHref: string | null = null;
  const listeners = new Set<(next: string) => void>();
  return {
    currentHref: () => href,
    pendingHref: () => pendingHref,
    navigate(next) {
      pendingHref = next;
    },
    resolvePending() {
      if (pendingHref === null) return;
      href = pendingHref;
      pendingHref = null;
      for (const listener of listeners) listener(href);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

describe("tab routes", () => {
  it("parses Home, session threads, and nothing else", () => {
    expect(parseTabHref("/")).toEqual({ type: "home" });
    expect(parseTabHref(sessionHref(id("ses a")))).toEqual({ type: "session", id: id("ses a") });
    expect(parseTabHref("/chat")).toBeNull();
    expect(parseTabHref("/chat/ses_1/extra")).toBeNull();
    expect(parseTabHref("/settings")).toBeNull();
    expect(parseTabHref("/chat/ses_1?tool=files")).toEqual({ type: "session", id: id("ses_1") });
  });
});

describe("tab controller", () => {
  it("keeps Home selected until thread navigation resolves", () => {
    const sessionId = id("ses_pending");
    const store = createMemoryStore(showHome(openTab(createTabState(), sessionId)));
    const navigator = createDeferredNavigator("/");
    const controller = createTabController({ store, navigator });

    controller.activate(sessionId);
    expect(navigator.pendingHref()).toBe(sessionHref(sessionId));
    expect(navigator.currentHref()).toBe("/");
    expect(store.state().activeId).toBeNull();

    navigator.resolvePending();
    expect(navigator.currentHref()).toBe(sessionHref(sessionId));
    expect(store.state().activeId).toBe(sessionId);
    controller.dispose();
  });

  it("restores the persisted active tab over the Home URL on relaunch", () => {
    const store = createMemoryStore(openTab(createTabState(), id("ses_restore")));
    const navigator = createNavigator("/");
    const controller = createTabController({ store, navigator });

    expect(navigator.navigations).toEqual([
      { href: sessionHref(id("ses_restore")), replace: true },
    ]);
    expect(store.state().activeId).toBe(id("ses_restore"));
    controller.dispose();
  });

  it("materializes exactly one tab from a deep link", () => {
    const store = createMemoryStore();
    const navigator = createNavigator(sessionHref(id("ses_deep")));
    const controller = createTabController({ store, navigator });

    expect(store.state().tabs).toEqual([id("ses_deep")]);
    navigator.navigate(sessionHref(id("ses_deep")));
    expect(store.state().tabs).toEqual([id("ses_deep")]);
    controller.dispose();
  });

  it("leaves the selection untouched on routes the strip does not own", () => {
    const store = createMemoryStore(openTab(createTabState(), id("ses_keep")));
    const navigator = createNavigator(sessionHref(id("ses_keep")));
    const controller = createTabController({ store, navigator });

    navigator.navigate("/chat");
    expect(store.state().activeId).toBe(id("ses_keep"));
    controller.dispose();
  });

  it("closes to the neighbor with a push and reopens back", () => {
    let initial = openTab(createTabState(), id("ses_first"));
    initial = openTab(initial, id("ses_second"));
    const store = createMemoryStore(initial);
    const navigator = createNavigator(sessionHref(id("ses_second")));
    const controller = createTabController({ store, navigator });

    controller.close(id("ses_second"));
    expect(navigator.currentHref()).toBe(sessionHref(id("ses_first")));
    expect(navigator.navigations.at(-1)).toEqual({
      href: sessionHref(id("ses_first")),
      replace: false,
    });

    controller.reopenClosed();
    expect(navigator.currentHref()).toBe(sessionHref(id("ses_second")));
    controller.dispose();
  });

  it("navigates Home when the last tab closes", () => {
    const store = createMemoryStore(openTab(createTabState(), id("ses_only")));
    const navigator = createNavigator(sessionHref(id("ses_only")));
    const controller = createTabController({ store, navigator });

    controller.close(id("ses_only"));
    expect(navigator.currentHref()).toBe("/");
    controller.dispose();
  });

  it("repairs the active route with replace on machine correction", () => {
    const store = createMemoryStore(openTab(createTabState(), id("ses_active")));
    const navigator = createNavigator(sessionHref(id("ses_active")));
    const controller = createTabController({ store, navigator });

    store.close(id("ses_active"));
    controller.repairActive();
    expect(navigator.navigations.at(-1)).toEqual({ href: "/", replace: true });
    controller.dispose();
  });
});
