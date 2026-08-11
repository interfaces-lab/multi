// The inventory store, in chat-store's shape: one module-level watch over
// core's `session.watchInventory`, refcounted so it runs only while a surface
// shows the list, folded by the pure reducer in inventory-model.

import * as React from "react";

import type { HonkClient } from "@honk/core";

import type { InventoryEvent, InventoryState } from "./inventory-model";
import { initialInventory, reduceInventory } from "./inventory-model";
import {
  describeError,
  getSnapshot as getCoreSnapshot,
  subscribe as subscribeCore,
} from "./client";

interface InventoryHandle {
  refs: number;
  state: InventoryState;
  readonly listeners: Set<() => void>;
  stop: (() => void) | null;
}

const handle: InventoryHandle = {
  refs: 0,
  state: initialInventory,
  listeners: new Set(),
  stop: null,
};

function dispatch(event: InventoryEvent): void {
  const next = reduceInventory(handle.state, event);
  if (next === handle.state) return;
  handle.state = next;
  for (const listener of handle.listeners) listener();
}

function startWatch(client: HonkClient): () => void {
  let disposed = false;
  const frames = client.session.watchInventory({})[Symbol.asyncIterator]();
  void (async () => {
    try {
      for (let next = await frames.next(); next.done !== true; next = await frames.next()) {
        if (disposed) return;
        dispatch({ type: "frame", sessions: next.value.sessions });
      }
      if (!disposed) dispatch({ type: "stream_ended" });
    } catch (error) {
      if (!disposed) dispatch({ type: "failed", message: describeError(error) });
    }
  })();
  return () => {
    disposed = true;
    void frames.return?.(undefined);
  };
}

/** Opens the watch on first retain, closes it on last release. */
export function retainInventory(): () => void {
  handle.refs += 1;
  if (handle.refs === 1) {
    let stopWatch: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    const tryStart = (): boolean => {
      const core = getCoreSnapshot();
      if (core.status === "ready") {
        stopWatch = startWatch(core.client);
        return true;
      }
      if (core.status === "unavailable") {
        dispatch({ type: "failed", message: "Honk Core is not available in this host." });
        return true;
      }
      return false;
    };
    if (!tryStart()) {
      unsubscribe = subscribeCore(() => {
        if (tryStart()) {
          unsubscribe?.();
          unsubscribe = null;
        }
      });
    }
    handle.stop = () => {
      unsubscribe?.();
      stopWatch?.();
    };
  }
  return () => {
    handle.refs -= 1;
    if (handle.refs === 0) {
      handle.stop?.();
      handle.stop = null;
      // The folded state stays: every frame is the full authoritative list, so
      // a fresh retain (a StrictMode replay, a route revisit) paints the cached
      // snapshot and lets the reattached watch's first frame replace it.
    }
  };
}

/** Module-level reads for non-React subscribers (thread notifications). */
export function getInventorySnapshot(): InventoryState {
  return handle.state;
}

export function subscribeInventory(listener: () => void): () => void {
  handle.listeners.add(listener);
  return () => {
    handle.listeners.delete(listener);
  };
}

/** Attaches to the inventory: the store folds, the component only reads. */
export function useInventory(): InventoryState {
  React.useEffect(() => retainInventory(), []);
  return React.useSyncExternalStore(
    (onStoreChange) => {
      handle.listeners.add(onStoreChange);
      return () => {
        handle.listeners.delete(onStoreChange);
      };
    },
    () => handle.state,
    () => initialInventory,
  );
}
