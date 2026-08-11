// Pins the catalog store's contract: one models.list per run no matter how
// many subscribers attach (or how often StrictMode remounts them), deferred
// until core connects, retried after a failure, refreshed on demand — and the
// phase the account panels read: failed on the initial load, rows kept with an
// error line when a refresh fails over a ready catalog.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Models } from "@honk/core/models";

import { providerSummary } from "../test-fixtures";

interface CatalogClient {
  readonly models: {
    readonly list: () => Promise<{ readonly providers: readonly Models.ProviderSummary[] }>;
  };
}

type CatalogCoreSnapshot =
  | { readonly status: "connecting" }
  | { readonly status: "ready"; readonly client: CatalogClient };

const core: {
  snapshot: CatalogCoreSnapshot;
  readonly listeners: Set<() => void>;
} = {
  snapshot: { status: "connecting" },
  listeners: new Set(),
};

const list = vi.fn<() => Promise<{ providers: readonly Models.ProviderSummary[] }>>();

vi.mock("./client", () => ({
  getSnapshot: () => core.snapshot,
  subscribe: (listener: () => void) => {
    core.listeners.add(listener);
    return () => core.listeners.delete(listener);
  },
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const provider = (id: string): Models.ProviderSummary => providerSummary({ id });

const readyCore = (): void => {
  core.snapshot = {
    status: "ready",
    client: { models: { list } },
  };
  for (const listener of core.listeners) listener();
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const loadStore = () => import("./model-catalog");

beforeEach(() => {
  vi.resetModules();
  core.snapshot = { status: "connecting" };
  core.listeners.clear();
  list.mockReset();
});

describe("model catalog store", () => {
  it("fetches once no matter how many subscribers attach", async () => {
    const store = await loadStore();
    readyCore();
    list.mockResolvedValue({ providers: [provider("anthropic")] });

    const first = vi.fn();
    const second = vi.fn();
    store.subscribeCatalog(first);
    store.subscribeCatalog(second);
    await flush();
    store.subscribeCatalog(vi.fn());
    await flush();

    expect(list).toHaveBeenCalledTimes(1);
    expect(store.getCatalogPhase()).toMatchObject({
      status: "ready",
      providers: [{ id: "anthropic" }],
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("waits for core to connect, then fetches once", async () => {
    const store = await loadStore();
    list.mockResolvedValue({ providers: [provider("openai")] });

    store.subscribeCatalog(vi.fn());
    expect(list).not.toHaveBeenCalled();
    expect(store.getCatalogPhase()).toEqual({ status: "loading" });

    readyCore();
    await flush();

    expect(list).toHaveBeenCalledTimes(1);
    expect(store.getCatalogPhase()).toMatchObject({
      status: "ready",
      providers: [{ id: "openai" }],
    });
  });

  it("reports an initial failure as failed and retries on the next subscriber", async () => {
    const store = await loadStore();
    readyCore();
    list.mockRejectedValueOnce(new Error("core restarting"));

    store.subscribeCatalog(vi.fn());
    await flush();
    expect(store.getCatalogPhase()).toEqual({ status: "failed", message: "core restarting" });

    list.mockResolvedValue({ providers: [provider("anthropic")] });
    store.subscribeCatalog(vi.fn());
    await flush();

    expect(list).toHaveBeenCalledTimes(2);
    expect(store.getCatalogPhase()).toMatchObject({
      status: "ready",
      providers: [{ id: "anthropic" }],
    });
  });

  it("refreshCatalog publishes the refetched providers", async () => {
    const store = await loadStore();
    readyCore();
    list.mockResolvedValue({ providers: [provider("anthropic")] });

    const listener = vi.fn();
    store.subscribeCatalog(listener);
    await flush();

    list.mockResolvedValue({ providers: [provider("anthropic"), provider("openai")] });
    await store.refreshCatalog();

    expect(store.getCatalogPhase()).toMatchObject({
      status: "ready",
      providers: [{ id: "anthropic" }, { id: "openai" }],
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps the rows when a refresh fails over a ready catalog, then clears the error", async () => {
    const store = await loadStore();
    readyCore();
    list.mockResolvedValue({ providers: [provider("anthropic")] });

    store.subscribeCatalog(vi.fn());
    await flush();

    list.mockRejectedValueOnce(new Error("offline"));
    await store.refreshCatalog();

    expect(store.getCatalogPhase()).toMatchObject({ status: "ready", error: "offline" });
    expect(store.getCatalogPhase()).toMatchObject({
      status: "ready",
      providers: [{ id: "anthropic" }],
    });

    list.mockResolvedValue({ providers: [provider("anthropic")] });
    await store.refreshCatalog();

    expect(store.getCatalogPhase()).toMatchObject({ status: "ready", error: null });
  });

  it("shows loading when refreshing out of failed, then settles", async () => {
    const store = await loadStore();
    readyCore();
    list.mockRejectedValueOnce(new Error("core restarting"));

    store.subscribeCatalog(vi.fn());
    await flush();
    expect(store.getCatalogPhase().status).toBe("failed");

    list.mockResolvedValue({ providers: [provider("anthropic")] });
    const settled = store.refreshCatalog();
    expect(store.getCatalogPhase()).toEqual({ status: "loading" });
    await settled;

    expect(store.getCatalogPhase()).toMatchObject({ status: "ready", error: null });
    expect(store.getCatalogPhase()).toMatchObject({
      status: "ready",
      providers: [{ id: "anthropic" }],
    });
  });
});
