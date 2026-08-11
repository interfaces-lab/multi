// Resolves a chat session's workspace identity — which trusted workspace it
// runs in and where that workspace lives on disk. Both values are fixed at
// creation (`session.list` reports the origin even after a `/cd`), so one
// read per session is enough and no watch is needed. Same shape as
// chat-store: the promise lives here, components read a stable snapshot.

import * as React from "react";

import type { Session } from "@honk/core/session";
import type { Workspace } from "@honk/core/workspace";

import {
  describeError,
  getSnapshot as getCoreSnapshot,
  subscribe as subscribeCore,
} from "./client";

export type SessionWorkspace = {
  readonly workspaceId: Workspace.WorkspaceId;
  readonly directory: string;
};

export type SessionWorkspaceSnapshot =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly workspace: SessionWorkspace };

interface WorkspaceHandle {
  snapshot: SessionWorkspaceSnapshot;
  started: boolean;
  readonly listeners: Set<() => void>;
}

const LOADING: SessionWorkspaceSnapshot = Object.freeze({ status: "loading" });
const handles = new Map<string, WorkspaceHandle>();

function handleOf(sessionId: Session.SessionId): WorkspaceHandle {
  let handle = handles.get(sessionId);
  if (handle === undefined) {
    handle = { snapshot: LOADING, started: false, listeners: new Set() };
    handles.set(sessionId, handle);
  }
  return handle;
}

function publish(handle: WorkspaceHandle, snapshot: SessionWorkspaceSnapshot): void {
  handle.snapshot = Object.freeze(snapshot);
  for (const listener of handle.listeners) listener();
}

function load(handle: WorkspaceHandle, sessionId: Session.SessionId): void {
  if (handle.started) return;
  handle.started = true;
  const start = (): boolean => {
    const core = getCoreSnapshot();
    if (core.status === "connecting") return false;
    if (core.status === "unavailable") {
      publish(handle, { status: "failed", message: "Honk Core is not available in this host." });
      return true;
    }
    void core.client.session.list({}).then(
      ({ sessions }) => {
        const summary = sessions.find((candidate) => candidate.id === sessionId);
        if (summary === undefined) {
          publish(handle, { status: "failed", message: "Honk does not know this session." });
          return;
        }
        publish(handle, {
          status: "ready",
          workspace: { workspaceId: summary.workspaceId, directory: summary.directory },
        });
      },
      (error: unknown) => {
        // Allow a retry on the next subscriber: a transient failure must not
        // pin the workbench closed for the session's lifetime.
        handle.started = false;
        publish(handle, { status: "failed", message: describeError(error) });
      },
    );
    return true;
  };
  if (start()) return;
  const unsubscribe = subscribeCore(() => {
    if (start()) unsubscribe();
  });
}

/** The session's workspace identity; loading until core answers the first read. */
export function useSessionWorkspace(sessionId: Session.SessionId): SessionWorkspaceSnapshot {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      const handle = handleOf(sessionId);
      handle.listeners.add(onStoreChange);
      load(handle, sessionId);
      return () => {
        handle.listeners.delete(onStoreChange);
      };
    },
    () => handles.get(sessionId)?.snapshot ?? LOADING,
    () => LOADING,
  );
}
