// Async data behind the composer's `/` and `@` menus.
//
// Requests live in external resources so rendering the menu only reads stable
// snapshots. In particular, a render never constructs a new search and then
// asks an effect to synchronize it back into component state.

import * as React from "react";

import type { Commands } from "@honk/core/commands";
import type { HonkClient } from "@honk/core";
import type { Skills } from "@honk/core/skills";
import type { Workspace } from "@honk/core/workspace";

import {
  createMentionSearch,
  mentionSearchIoOf,
  type MentionResults,
  type MentionSearchIo,
} from "./file-mention";

export interface PromptCatalog {
  readonly skills: readonly Skills.Summary[];
  readonly commands: readonly Commands.Summary[];
}

export type MentionResultsSnapshot =
  | { readonly phase: "inactive" }
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly results: MentionResults }
  | { readonly phase: "failed" };

interface PromptCatalogResource {
  readonly getSnapshot: () => PromptCatalog;
  readonly subscribe: (listener: () => void) => () => void;
}

interface MentionResultsResource {
  readonly getSnapshot: () => MentionResultsSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

type PromptCatalogClient = {
  readonly skills: Pick<HonkClient["skills"], "list">;
  readonly commands: Pick<HonkClient["commands"], "list">;
};

const EMPTY_CATALOG: PromptCatalog = Object.freeze({ skills: [], commands: [] });
const INACTIVE_MENTION: MentionResultsSnapshot = Object.freeze({ phase: "inactive" });
const LOADING_MENTION: MentionResultsSnapshot = Object.freeze({ phase: "loading" });
const FAILED_MENTION: MentionResultsSnapshot = Object.freeze({ phase: "failed" });
const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;

const EMPTY_CATALOG_RESOURCE: PromptCatalogResource = {
  getSnapshot: () => EMPTY_CATALOG,
  subscribe: NOOP_SUBSCRIBE,
};
const INACTIVE_MENTION_RESOURCE: MentionResultsResource = {
  getSnapshot: () => INACTIVE_MENTION,
  subscribe: NOOP_SUBSCRIBE,
};

const catalogResources = new WeakMap<
  HonkClient,
  Map<Workspace.WorkspaceId, PromptCatalogResource>
>();
const mentionResources = new WeakMap<
  HonkClient,
  Map<Workspace.WorkspaceId, Map<string, MentionResultsResource>>
>();

export function createPromptCatalogResource(
  client: PromptCatalogClient,
  workspaceId: Workspace.WorkspaceId,
): PromptCatalogResource {
  let snapshot = EMPTY_CATALOG;
  let requested = false;
  const listeners = new Set<() => void>();

  const publish = (next: PromptCatalog): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const load = (): void => {
    if (requested) return;
    requested = true;
    void Promise.all([
      client.skills.list({ workspaceId }).catch(() => []),
      client.commands.list({ workspaceId }).catch(() => []),
    ]).then(([skills, commands]) => {
      publish({ skills, commands });
    });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      load();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createMentionResultsResource(
  io: MentionSearchIo,
  query: string,
  onRelease?: () => void,
): MentionResultsResource {
  let snapshot = LOADING_MENTION;
  let requested = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const publish = (results: MentionResults | null): void => {
    const next: MentionResultsSnapshot =
      results === null ? FAILED_MENTION : { phase: "ready", results };
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const search = createMentionSearch(io, publish);
  const load = (): void => {
    if (requested) return;
    requested = true;
    search.search(query);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      listeners.add(listener);
      load();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        // Give Strict Mode's immediate resubscribe one task to reclaim the
        // resource without issuing the same lookup twice.
        releaseTimer = setTimeout(() => {
          if (listeners.size > 0) return;
          search.stop();
          onRelease?.();
        }, 0);
      };
    },
  };
}

function catalogResourceFor(
  client: HonkClient,
  workspaceId: Workspace.WorkspaceId,
): PromptCatalogResource {
  let byWorkspace = catalogResources.get(client);
  if (byWorkspace === undefined) {
    byWorkspace = new Map();
    catalogResources.set(client, byWorkspace);
  }
  const existing = byWorkspace.get(workspaceId);
  if (existing !== undefined) return existing;
  const created = createPromptCatalogResource(client, workspaceId);
  byWorkspace.set(workspaceId, created);
  return created;
}

function mentionResourceFor(
  client: HonkClient,
  workspaceId: Workspace.WorkspaceId,
  query: string,
): MentionResultsResource {
  let byWorkspace = mentionResources.get(client);
  if (byWorkspace === undefined) {
    byWorkspace = new Map();
    mentionResources.set(client, byWorkspace);
  }
  let byQuery = byWorkspace.get(workspaceId);
  if (byQuery === undefined) {
    byQuery = new Map();
    byWorkspace.set(workspaceId, byQuery);
  }
  const existing = byQuery.get(query);
  if (existing !== undefined) return existing;
  const created = createMentionResultsResource(
    mentionSearchIoOf(client, workspaceId),
    query,
    () => {
      byQuery.delete(query);
      if (byQuery.size === 0) byWorkspace.delete(workspaceId);
    },
  );
  byQuery.set(query, created);
  return created;
}

export function usePromptCatalog(
  client: HonkClient | null,
  workspaceId: Workspace.WorkspaceId | null,
): PromptCatalog {
  const resource =
    client === null || workspaceId === null
      ? EMPTY_CATALOG_RESOURCE
      : catalogResourceFor(client, workspaceId);
  return React.useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
}

export function useMentionResults(
  client: HonkClient | null,
  workspaceId: Workspace.WorkspaceId | null,
  query: string | null,
): MentionResultsSnapshot {
  const resource =
    client === null || workspaceId === null || query === null
      ? INACTIVE_MENTION_RESOURCE
      : mentionResourceFor(client, workspaceId, query);
  return React.useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
}
