// The chat session store keeps the watch subscription and reducer fold at
// module level so components stay effect-free. Surfaces read one stable
// snapshot through useSyncExternalStore. A visited desktop tab retains its
// handle while inactive, so returning to it does not cold-load the transcript.

import * as React from "react";

import type { HonkClient } from "@honk/core";
import type { Session } from "@honk/core/session";

import { getSnapshot as getTabSnapshot, subscribe as subscribeTabs } from "../tab-store";
import type { ModelChoice } from "./chat-controller";
import type { ChatEvent, ChatState } from "./chat-model";
import { initialState, reduce } from "./chat-model";
import type { ComposerMessage } from "./composer-store";
import {
  describeError,
  getHonkClient,
  getSnapshot as getCoreSnapshot,
  subscribe as subscribeCore,
} from "./client";

interface SessionHandle {
  surfaceRefs: number;
  tabRetained: boolean;
  state: ChatState;
  readonly listeners: Set<() => void>;
  stop: (() => void) | null;
}

const handles = new Map<Session.SessionId, SessionHandle>();
const visitedTabs = new Set<Session.SessionId>();

function handleOf(sessionId: Session.SessionId): SessionHandle {
  let handle = handles.get(sessionId);
  if (handle === undefined) {
    handle = {
      surfaceRefs: 0,
      tabRetained: false,
      state: initialState,
      listeners: new Set(),
      stop: null,
    };
    handles.set(sessionId, handle);
  }
  return handle;
}

function disposeHandle(sessionId: Session.SessionId, handle: SessionHandle): void {
  handle.stop?.();
  handle.stop = null;
  handles.delete(sessionId);
  visitedTabs.delete(sessionId);
}

function tabIsOpen(sessionId: Session.SessionId): boolean {
  return getTabSnapshot().tabs.includes(sessionId);
}

function reconcileTabRetention(): void {
  for (const [sessionId, handle] of handles) {
    handle.tabRetained = visitedTabs.has(sessionId) && tabIsOpen(sessionId);
    if (handle.surfaceRefs === 0 && !handle.tabRetained) {
      disposeHandle(sessionId, handle);
    }
  }
}

subscribeTabs(reconcileTabRetention);

function dispatch(handle: SessionHandle, event: ChatEvent): void {
  const next = reduce(handle.state, event);
  if (next === handle.state) return;
  handle.state = next;
  for (const listener of handle.listeners) listener();
}

/**
 * Consumes the session watch (spec/core.md section 9): one authoritative read
 * at attach, advisory events between, a repair read at each commit point. The
 * store only maps frames to reducer events.
 */
function startWatch(
  handle: SessionHandle,
  sessionId: Session.SessionId,
  client: HonkClient,
): () => void {
  let disposed = false;
  const frames = client.session.watch({ sessionId })[Symbol.asyncIterator]();
  dispatch(handle, { type: "attached", sessionId });
  void (async () => {
    try {
      for (let next = await frames.next(); next.done !== true; next = await frames.next()) {
        if (disposed) return;
        const frame = next.value;
        dispatch(
          handle,
          frame.type === "state"
            ? { type: "state", entries: frame.entries, phase: frame.phase, turns: frame.turns }
            : { type: "event", event: frame.event },
        );
      }
      if (!disposed) dispatch(handle, { type: "stream_ended" });
    } catch (error) {
      if (!disposed) dispatch(handle, { type: "failed", message: describeError(error) });
    }
  })();
  return () => {
    disposed = true;
    void frames.return?.(undefined);
  };
}

/**
 * Opens the session's watch on first retain and closes it on last release.
 * Waits for the core boot store when the client is still connecting.
 */
export function retainSession(sessionId: Session.SessionId): () => void {
  const handle = handleOf(sessionId);
  handle.surfaceRefs += 1;
  if (handle.stop === null) {
    let stopWatch: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    const tryStart = (): boolean => {
      const core = getCoreSnapshot();
      if (core.status === "ready") {
        stopWatch = startWatch(handle, sessionId, core.client);
        return true;
      }
      if (core.status === "unavailable") {
        dispatch(handle, { type: "failed", message: "Honk Core is not available in this host." });
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
  let released = false;
  return () => {
    if (released) return;
    released = true;
    handle.surfaceRefs -= 1;
    if (handle.surfaceRefs === 0 && !handle.tabRetained) {
      disposeHandle(sessionId, handle);
    }
  };
}

/** Keeps an already-visited top-level tab live while its route is inactive. */
export function markSessionTabVisited(sessionId: Session.SessionId): void {
  if (!tabIsOpen(sessionId)) return;
  visitedTabs.add(sessionId);
  handleOf(sessionId).tabRetained = true;
}

export interface CoreChat {
  readonly state: ChatState;
  readonly prompt: (message: ComposerMessage) => Promise<void>;
  readonly editMessage: (
    entryId: string,
    message: ComposerMessage,
    selection?: {
      readonly model?: ModelChoice;
      readonly thinkingLevel: Session.ThinkingLevel;
    },
  ) => Promise<void>;
  readonly steer: (message: ComposerMessage) => Promise<void>;
  /**
   * Queues text for after the current run (contract.ts FollowUp). Settles
   * through the events stream: Pi answers with a `queue_update` frame and
   * the reducer folds it into the tray.
   */
  readonly followUp: (message: ComposerMessage) => Promise<void>;
  /**
   * Ends the run and resolves with the queued messages Pi cleared, so the
   * composer can put the user's words back in the editor (contract.ts Abort).
   */
  readonly stop: () => Promise<Session.AbortOutput>;
  /** Starts an agent-driven Git action; the transcript shows it as a chip. */
  readonly runGitAction: (action: Session.GitActionId) => Promise<void>;
  /**
   * Sets the thinking level. No optimistic dispatch: Pi answers with
   * a `thinking_level_update` event and the reducer folds it in.
   */
  readonly setThinkingLevel: (level: Session.ThinkingLevel) => Promise<void>;
  /**
   * Moves the session to another model. Same shape as the level above: core
   * resolves the reference, Pi answers with a `model_update` event, and the
   * reducer folds the truth back.
   */
  readonly setModel: (model: ModelChoice) => Promise<void>;
}

const disconnected = (): Promise<never> =>
  Promise.reject(new Error("Honk Core is not connected yet."));

// RPC refusals belong to the control that initiated them. Session health
// comes only from the watch; a busy prompt or late abort cannot poison a live
// authoritative stream.
function invoke<A>(run: (client: HonkClient) => Promise<A>): Promise<A> {
  const client = getHonkClient();
  if (client === null) return disconnected();
  return run(client);
}

/** The store's read outside React: the fold so far, initial before attach. */
export function sessionStateOf(sessionId: Session.SessionId): ChatState {
  return handles.get(sessionId)?.state ?? initialState;
}

/** Attaches to a session: the store folds, the component only reads. */
export function useCoreSession(sessionId: Session.SessionId): CoreChat {
  React.useEffect(() => retainSession(sessionId), [sessionId]);
  const state = React.useSyncExternalStore(
    (onStoreChange) => {
      const handle = handleOf(sessionId);
      handle.listeners.add(onStoreChange);
      return () => {
        handle.listeners.delete(onStoreChange);
      };
    },
    () => sessionStateOf(sessionId),
    () => initialState,
  );

  return {
    state,
    prompt: (message) => invoke((client) => client.session.prompt({ sessionId, ...message })),
    // The edit form owns its pending and error state. Core may refuse a stale
    // entry or a run that became busy; neither refusal makes the live session
    // untrustworthy, and Pi's tree/agent events drive the successful branch.
    editMessage: (entryId, message, selection) =>
      invoke((client) =>
        client.session.editMessage({ sessionId, entryId, ...message, ...selection }),
      ),
    steer: (message) => invoke((client) => client.session.steer({ sessionId, ...message })),
    followUp: (message) => invoke((client) => client.session.followUp({ sessionId, ...message })),
    stop: () => invoke((client) => client.session.abort({ sessionId })),
    runGitAction: (action) =>
      invoke((client) => client.session.runGitAction({ sessionId, action })),
    setThinkingLevel: (level) =>
      invoke((client) => client.session.setThinkingLevel({ sessionId, thinkingLevel: level })),
    setModel: (model) => invoke((client) => client.session.setModel({ sessionId, model })),
  };
}
