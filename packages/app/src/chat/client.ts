// Honk Core boot store. Promises live here so components stay effect-free,
// and surfaces read one stable snapshot through useSyncExternalStore.
// `HonkClient` comes from @honk/core —
// the same interface an in-process host hands out — so when the transport
// changes (HTTP now, IPC per spec/core.md section 6) only the connect step
// in this file changes.

import { useSyncExternalStore } from "react";

import type { HonkClient } from "@honk/core";
import { createHonkClient } from "@honk/core";

import { getHonkCoreConnection } from "../desktop-bridge";

export type CoreSnapshot =
  | { readonly status: "connecting" }
  // This host has no core endpoint: web, or an older desktop preload.
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly client: HonkClient };

const INITIAL_SNAPSHOT: CoreSnapshot = Object.freeze({ status: "connecting" });

const listeners = new Set<() => void>();
let snapshot: CoreSnapshot = INITIAL_SNAPSHOT;
let started = false;

function emit(next: CoreSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): CoreSnapshot {
  return snapshot;
}

export function getServerSnapshot(): CoreSnapshot {
  return INITIAL_SNAPSHOT;
}

export function useHonkCore(): CoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Kick off the connection before React mounts (called from start-app, like startConnection). */
export function startHonkCore(): void {
  if (started) return;
  started = true;
  void (async () => {
    const connection = await getHonkCoreConnection();
    if (connection === null) {
      emit({ status: "unavailable" });
      return;
    }
    const client = await createHonkClient(connection);
    emit({ status: "ready", client });
  })();
}

/** Synchronous read for imperative handlers; null until the store is ready. */
export function getHonkClient(): HonkClient | null {
  return snapshot.status === "ready" ? snapshot.client : null;
}

export function requireHonkClient(): HonkClient {
  const client = getHonkClient();
  if (client === null) throw new Error("Honk Core is not connected yet.");
  return client;
}

/** One readable line for a rejected core call: `code: message` when typed. */
export function describeError(error: unknown): string {
  if (error instanceof Object && Reflect.has(error, "code") && Reflect.has(error, "message")) {
    return `${String(Reflect.get(error, "code"))}: ${String(Reflect.get(error, "message"))}`;
  }
  return String(error);
}
