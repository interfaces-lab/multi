// The model catalog, fetched once per run and shared by every consumer: the
// pickers read the rows, the settings/setup account panels read the full
// phase. Module state in client.ts's shape: a StrictMode remount or a second
// surface reuses the cached providers instead of re-issuing models.list.

import { useSyncExternalStore } from "react";

import type { HonkClient } from "@honk/core";
import type { Models } from "@honk/core/models";

import {
  describeError,
  getSnapshot as getCoreSnapshot,
  subscribe as subscribeCore,
} from "./client";

export type CatalogPhase =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | {
      readonly status: "ready";
      readonly providers: readonly Models.ProviderSummary[];
      // A refresh that fails over an already-ready catalog keeps the rows and
      // reports here instead of blanking the panel back to failed.
      readonly error: string | null;
    };

const LOADING_PHASE: CatalogPhase = Object.freeze({ status: "loading" });

const listeners = new Set<() => void>();
let phase: CatalogPhase = LOADING_PHASE;
let requested = false;
// One counter guards the initial fetch and every refresh: only the
// last-issued fetch publishes, so a stale response never overwrites a newer one.
let fetchSequence = 0;

function publish(next: CatalogPhase): void {
  phase = Object.freeze(next);
  for (const listener of listeners) listener();
}

async function fetchCatalog(client: Pick<HonkClient, "models">): Promise<void> {
  const sequence = ++fetchSequence;
  try {
    const catalog = await client.models.list({});
    if (sequence !== fetchSequence) return;
    publish({ status: "ready", providers: catalog.providers, error: null });
  } catch (error) {
    if (sequence !== fetchSequence) return;
    if (phase.status === "ready") {
      publish({ status: "ready", providers: phase.providers, error: describeError(error) });
    } else {
      // Drop the latch so the next subscriber retries the initial load.
      requested = false;
      publish({ status: "failed", message: describeError(error) });
    }
  }
}

function fetchWhenReady(): void {
  const core = getCoreSnapshot();
  if (core.status === "connecting") {
    const unsubscribe = subscribeCore(() => {
      if (getCoreSnapshot().status !== "connecting") {
        unsubscribe();
        fetchWhenReady();
      }
    });
    return;
  }
  if (core.status === "unavailable") {
    // No catalog on this host; the panels read useHonkCore directly for the
    // honest terminal state, and the pickers stay empty.
    return;
  }
  void fetchCatalog(core.client);
}

function ensureCatalog(): void {
  if (requested) return;
  requested = true;
  fetchWhenReady();
}

export function subscribeCatalog(listener: () => void): () => void {
  listeners.add(listener);
  ensureCatalog();
  return () => {
    listeners.delete(listener);
  };
}

export function getCatalogPhase(): CatalogPhase {
  return phase;
}

/** Refetches after a credential change; resolves once the fetch settles. Never rejects. */
export async function refreshCatalog(): Promise<void> {
  const core = getCoreSnapshot();
  if (core.status !== "ready") return;
  // A retry from failed shows the skeleton instead of the stale error.
  if (phase.status === "failed") publish(LOADING_PHASE);
  await fetchCatalog(core.client);
}

/** The catalog state: loading, failure, or every provider row. */
export function useCatalogPhase(): CatalogPhase {
  return useSyncExternalStore(subscribeCatalog, getCatalogPhase, () => LOADING_PHASE);
}
