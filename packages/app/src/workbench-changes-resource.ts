import type { Git, HonkClient } from "@honk/core";
import * as React from "react";

import { getHonkClient } from "./chat/client";
import { errorMessage } from "./error-message";
import type { WorkbenchSessionRef } from "./workbench-frame";

const CHANGES_RESOURCE_GRACE_MS = 30_000;

// The three comparisons Honk Core can answer: `git.status`/`git.diff` mode
// "git" (working tree vs HEAD), mode "branch" (merge-base of the default
// branch vs the working tree), and the session's newest settled turn via
// `session.changes` + `git.checkpointDiff` over the turn's checkpoints.
type ChangesScope = "git" | "branch" | "lastTurn";

type ChangesReady = {
  readonly branch: string | null;
  readonly defaultBranch: string | null;
  readonly files: readonly Git.FileChange[];
  readonly diffs: ReadonlyMap<string, Git.FileDiff>;
  // The file list paints from status immediately; patches stream in after. While true,
  // an absent patch means "still loading" rather than "binary/oversized".
  readonly diffsPending: boolean;
};

type ChangesSnapshot =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | ({ readonly phase: "ready" } & ChangesReady);

type ChangesResource = {
  readonly getSnapshot: () => ChangesSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: () => void;
  readonly observeThreadRunning: (isRunning: boolean) => void;
};

type ChangesClient = {
  readonly git: Pick<HonkClient["git"], "status" | "diff" | "checkpointDiff">;
  readonly session: Pick<HonkClient["session"], "changes">;
};
type ChangesClientResolver = () => ChangesClient | null;

const changesResources = new Map<string, ChangesResource>();
const INITIAL_CHANGES_SNAPSHOT: ChangesSnapshot = Object.freeze({ phase: "loading" });

function indexDiffs(diffs: readonly Git.FileDiff[]): ReadonlyMap<string, Git.FileDiff> {
  return new Map(diffs.map((diff) => [diff.file, Object.freeze(diff)]));
}

function createChangesResource(
  sessionRef: WorkbenchSessionRef,
  scope: ChangesScope,
  resolveClient: ChangesClientResolver = getHonkClient,
): ChangesResource {
  let snapshot = INITIAL_CHANGES_SNAPSHOT;
  let requested = false;
  let inFlight = false;
  let refreshQueued = false;
  let sequence = 0;
  let lastThreadRunning: boolean | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const key = changesResourceKey(sessionRef, scope);
  const { sessionId, workspaceId } = sessionRef;

  const publish = (next: ChangesSnapshot): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const load = async (client: ChangesClient, current: number): Promise<void> => {
    // Every scope answers status first: the branch chip needs `branch` and
    // `defaultBranch` regardless of which comparison the cards show, and the
    // working-tree/branch scopes get their early file list from the same call.
    const status =
      scope === "branch"
        ? await client.git.status({ workspaceId, mode: "branch" })
        : await client.git.status({ workspaceId });
    if (sequence !== current) return;
    const branch = status.branch;
    const defaultBranch = status.defaultBranch;

    if (scope === "git" || scope === "branch") {
      publish({
        phase: "ready",
        branch,
        defaultBranch,
        files: Object.freeze([...status.files]),
        diffs: new Map(),
        diffsPending: true,
      });
      const diffs = await client.git.diff({ workspaceId, mode: scope });
      if (sequence !== current || snapshot.phase !== "ready") return;
      publish({ ...snapshot, diffs: indexDiffs(diffs), diffsPending: false });
      return;
    }

    // Last turn: the session's change receipt names the turn and its files;
    // the patches are the diff between that turn's checkpoint and the one
    // before it (`<sessionId>/<entryId>`, with "base" before the first turn).
    const { turns } = await client.session.changes({ sessionId });
    if (sequence !== current) return;
    const lastTurn = turns.at(-1);
    if (lastTurn === undefined || lastTurn.files.length === 0) {
      publish({
        phase: "ready",
        branch,
        defaultBranch,
        files: Object.freeze([]),
        diffs: new Map(),
        diffsPending: false,
      });
      return;
    }
    publish({
      phase: "ready",
      branch,
      defaultBranch,
      files: Object.freeze([...lastTurn.files]),
      diffs: new Map(),
      diffsPending: true,
    });
    const diffs = await client.git.checkpointDiff({
      workspaceId,
      from: `${sessionId}/${turns.at(-2)?.entryId ?? "base"}`,
      to: `${sessionId}/${lastTurn.entryId}`,
    });
    if (sequence !== current || snapshot.phase !== "ready") return;
    publish({ ...snapshot, diffs: indexDiffs(diffs), diffsPending: false });
  };

  const refresh = (): void => {
    requested = true;
    if (inFlight) {
      refreshQueued = true;
      return;
    }
    const client = resolveClient();
    if (client === null) {
      publish({ phase: "error", message: "Honk Core is not connected yet." });
      return;
    }

    inFlight = true;
    const currentSequence = ++sequence;
    void load(client, currentSequence)
      .catch((error: unknown) => {
        if (sequence !== currentSequence) return;
        publish({ phase: "error", message: errorMessage(error) });
      })
      .finally(() => {
        if (sequence !== currentSequence) return;
        inFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          refresh();
        }
      });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      listeners.add(listener);
      if (!requested) refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          releaseTimer = setTimeout(() => {
            if (listeners.size === 0) changesResources.delete(key);
          }, CHANGES_RESOURCE_GRACE_MS);
        }
      };
    },
    refresh,
    observeThreadRunning(isRunning) {
      if (lastThreadRunning === true && !isRunning) refresh();
      lastThreadRunning = isRunning;
    },
  };
}

function changesResourceKey(sessionRef: WorkbenchSessionRef, scope: ChangesScope): string {
  return `${sessionRef.sessionId}:${sessionRef.workspaceId}:${scope}`;
}

// One resource per scope: switching scopes swaps the resource rather than mutating a
// shared one, so the grace timer keeps the previous scope warm for an instant switch back.
function changesResourceFor(sessionRef: WorkbenchSessionRef, scope: ChangesScope): ChangesResource {
  const key = changesResourceKey(sessionRef, scope);
  const existing = changesResources.get(key);
  if (existing !== undefined) return existing;
  const created = createChangesResource(sessionRef, scope);
  changesResources.set(key, created);
  return created;
}

function useWorkbenchChangesSnapshot(
  sessionRef: WorkbenchSessionRef,
  scope: ChangesScope,
  isThreadRunning: boolean,
): ChangesSnapshot {
  const resource = changesResourceFor(sessionRef, scope);
  const snapshot = React.useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  React.useEffect(() => {
    resource.observeThreadRunning(isThreadRunning);
  }, [isThreadRunning, resource]);
  return snapshot;
}

function fileStatusGlyph(status: Git.ChangeStatus): "A" | "D" | "M" {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

export { changesResourceFor, createChangesResource, fileStatusGlyph, useWorkbenchChangesSnapshot };
export type { ChangesClient, ChangesResource, ChangesScope, ChangesSnapshot };
