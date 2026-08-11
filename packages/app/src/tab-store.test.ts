import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Option, Schema } from "effect";

import { Session } from "@honk/core/session";

import type { InventoryState } from "./chat/inventory-model";
import { sessionSummary } from "./test-fixtures";

const id = (value: string): Session.SessionId => Session.SessionId.make(value);

const inventoryMocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state: { current: InventoryState } = {
    current: { status: "connecting", sessions: [], error: null },
  };
  return {
    listeners,
    state,
    subscribeInventory: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    getInventorySnapshot: vi.fn(() => state.current),
  };
});

const bridgeMocks = vi.hoisted(() => ({
  windowID: { current: "window-a" },
}));

vi.mock("./chat/inventory-store", () => ({
  subscribeInventory: inventoryMocks.subscribeInventory,
  getInventorySnapshot: inventoryMocks.getInventorySnapshot,
}));

vi.mock("./desktop-bridge", () => ({
  readShellWindowID: () => bridgeMocks.windowID.current,
}));

interface StorageLog {
  readonly reads: string[];
  readonly writes: string[];
}

function stubWindow(values: Map<string, string>): StorageLog {
  const log: StorageLog = { reads: [], writes: [] };
  vi.stubGlobal("window", {
    localStorage: {
      getItem(key: string) {
        log.reads.push(key);
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        log.writes.push(key);
        values.set(key, value);
      },
    },
  });
  return log;
}

function publishInventory(next: InventoryState): void {
  inventoryMocks.state.current = next;
  for (const listener of inventoryMocks.listeners) listener();
}

const summary = (input: {
  readonly id: string;
  readonly directory?: string;
  readonly phase?: Session.Phase;
  readonly delegation?: boolean;
}): Session.SessionSummary =>
  sessionSummary({
    id: id(input.id),
    workspaceId: "ws_1",
    directory: input.directory ?? "/repo/honk",
    createdAt: "2026-08-07T00:00:00.000Z",
    phase: input.phase ?? "idle",
    updatedAt: "2026-08-07T00:00:00.000Z",
    ...(input.delegation === true
      ? { delegation: { delegationOf: id("ses_parent"), role: "sidekick" } }
      : {}),
  });

async function loadStore(values: Map<string, string>, windowID: string) {
  bridgeMocks.windowID.current = windowID;
  const log = stubWindow(values);
  vi.resetModules();
  const store = await import("./tab-store");
  return { store, log };
}

beforeEach(() => {
  inventoryMocks.listeners.clear();
  inventoryMocks.state.current = { status: "connecting", sessions: [], error: null };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tab store", () => {
  it("persists per window under the new namespace and never reads opencode keys", async () => {
    const values = new Map<string, string>();
    values.set("honk:opencode:window-tabs:legacy", JSON.stringify({ tabs: ["ses_old"] }));
    const first = await loadStore(values, "window-a");

    const router = bindFakeRouter(first.store, "/");
    router.visit("/chat/ses_a");
    router.visit("/chat/ses_b");
    first.store.actions.reorder(2, 1);
    first.store.actions.activate("ses_b");

    const touched = [...first.log.reads, ...first.log.writes];
    expect(touched.every((key) => key.startsWith("honk:tabs:v1:"))).toBe(true);
    expect(touched.some((key) => key.includes("window-a"))).toBe(true);

    const restored = await loadStore(values, "window-a");
    expect(restored.store.getSnapshot().tabs).toEqual([id("ses_b"), id("ses_a")]);
    expect(restored.store.getSnapshot().activeId).toBe(id("ses_b"));

    const other = await loadStore(values, "window-b");
    expect(other.store.getSnapshot().tabs).toEqual([]);
  });

  it("maps strip indexes across the pinned Home slot and skips Home on closeActive", async () => {
    const values = new Map<string, string>();
    const { store } = await loadStore(values, "window-reorder");
    const router = bindFakeRouter(store, "/");
    router.visit("/chat/ses_1");
    router.visit("/chat/ses_2");

    store.actions.reorder(2, 1);
    expect(store.getSnapshot().tabs).toEqual([id("ses_2"), id("ses_1")]);
    // Home is immovable: nothing lands at or moves from slot 0.
    store.actions.reorder(0, 2);
    expect(store.getSnapshot().tabs).toEqual([id("ses_2"), id("ses_1")]);

    store.actions.activate("home");
    store.actions.closeActive();
    expect(store.getSnapshot().tabs).toHaveLength(2);
  });

  it("reconciles only against ready frames and drops delegation-owned sessions", async () => {
    const values = new Map<string, string>();
    const { store } = await loadStore(values, "window-reconcile");
    const router = bindFakeRouter(store, "/");
    router.visit("/chat/ses_live");
    router.visit("/chat/ses_child");
    router.visit("/chat/ses_stale");

    publishInventory({ status: "failed", sessions: [], error: "boom" });
    publishInventory({ status: "disconnected", sessions: [], error: null });
    expect(store.getSnapshot().tabs).toHaveLength(3);

    publishInventory({
      status: "ready",
      sessions: [
        summary({ id: "ses_live", directory: "/repo/live" }),
        summary({ id: "ses_child", delegation: true }),
      ],
      error: null,
    });
    expect(store.getSnapshot().tabs).toEqual([id("ses_live")]);
    expect(store.getSnapshot().info["ses_live"]).toEqual({ directory: "/repo/live" });
    // The active tab died to a machine correction, so the route repair replaces.
    expect(router.navigations.at(-1)).toEqual({
      href: "/chat/ses_live",
      replace: true,
    });
  });

  it("keeps a delegation-owned deep link on its route without a tab", async () => {
    const values = new Map<string, string>();
    const { store } = await loadStore(values, "window-child");
    const router = bindFakeRouter(store, "/");
    router.visit("/chat/ses_tab");

    // The inventory already names the child, so no tab flickers in.
    publishInventory({
      status: "ready",
      sessions: [summary({ id: "ses_tab" }), summary({ id: "ses_child", delegation: true })],
      error: null,
    });
    const before = router.navigations.length;
    router.visit("/chat/ses_child");
    expect(store.getSnapshot().tabs).toEqual([id("ses_tab")]);
    expect(store.getSnapshot().activeId).toBeNull();
    expect(router.navigations).toHaveLength(before);

    // A child learned about only at the ready frame loses its slot but keeps
    // its route: selection falls to Home with no navigation.
    inventoryMocks.state.current = { status: "connecting", sessions: [], error: null };
    router.visit("/chat/ses_late_child");
    expect(store.getSnapshot().activeId).toBe(id("ses_late_child"));
    publishInventory({
      status: "ready",
      sessions: [summary({ id: "ses_tab" }), summary({ id: "ses_late_child", delegation: true })],
      error: null,
    });
    expect(store.getSnapshot().tabs).toEqual([id("ses_tab")]);
    expect(store.getSnapshot().activeId).toBeNull();
    expect(router.navigations.at(-1)?.href).not.toBe("/chat/ses_tab");
  });

  it("closes workspace tabs by directory equality and spares an unknown one", async () => {
    const values = new Map<string, string>();
    const { store } = await loadStore(values, "window-workspace");
    const router = bindFakeRouter(store, "/");
    router.visit("/chat/ses_alpha1");
    router.visit("/chat/ses_alpha2");
    router.visit("/chat/ses_beta");
    router.visit("/chat/ses_unknown");

    publishInventory({
      status: "ready",
      sessions: [
        summary({ id: "ses_alpha1", directory: "/repo/alpha" }),
        summary({ id: "ses_alpha2", directory: "/repo/alpha" }),
        summary({ id: "ses_beta", directory: "/repo/beta" }),
        summary({ id: "ses_unknown", directory: "/repo/unknown" }),
      ],
      error: null,
    });

    store.actions.closeWorkspaceTabs("ses_alpha1");
    // Same directory string, so both alpha tabs go; a sibling repo is untouched.
    expect(store.getSnapshot().tabs).toEqual([id("ses_beta"), id("ses_unknown")]);

    // A tab the inventory never placed has no directory to compare, so the
    // sweep declines rather than guessing which tabs share its workspace.
    store.actions.closeWorkspaceTabs("ses_missing");
    expect(store.getSnapshot().tabs).toEqual([id("ses_beta"), id("ses_unknown")]);
  });
});

type TabStoreModule = typeof import("./tab-store");

const decodeHref = Schema.decodeUnknownOption(Schema.String);

interface FakeRouter {
  readonly navigations: { readonly href: string; readonly replace: boolean }[];
  readonly visit: (href: string) => void;
}

function bindFakeRouter(store: TabStoreModule, initialHref: string): FakeRouter {
  const navigations: { readonly href: string; readonly replace: boolean }[] = [];
  const location = { href: initialHref };
  const listeners = new Set<(event: { toLocation: { href: string } }) => void>();
  const visit = (href: string): void => {
    location.href = href;
    for (const listener of listeners) listener({ toLocation: { href } });
  };
  store.bindTabRouter({
    subscribe(_eventType, listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigate(options) {
      const href = Option.getOrElse(decodeHref(options.href), () => "/");
      navigations.push({ href, replace: options["replace"] === true });
      visit(href);
    },
    state: { location },
  });
  return { navigations, visit };
}
