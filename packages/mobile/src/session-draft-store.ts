import type { Session } from "@honk/core/session";
import * as React from "react";

export interface SessionDraft {
  readonly text: string;
  readonly images: readonly Session.PromptImage[];
}

export const EMPTY_SESSION_DRAFT: SessionDraft = Object.freeze({ text: "", images: [] });

const drafts = new Map<string, SessionDraft>();
const listeners = new Map<string, Set<() => void>>();

export const readSessionDraft = (sessionId: string): SessionDraft =>
  drafts.get(sessionId) ?? EMPTY_SESSION_DRAFT;

export const writeSessionDraft = (sessionId: string, draft: SessionDraft): void => {
  if (draft.text.length === 0 && draft.images.length === 0) drafts.delete(sessionId);
  else drafts.set(sessionId, { text: draft.text, images: [...draft.images] });
  listeners.get(sessionId)?.forEach((listener) => listener());
};

const subscribe = (sessionId: string, listener: () => void): (() => void) => {
  const current = listeners.get(sessionId) ?? new Set<() => void>();
  current.add(listener);
  listeners.set(sessionId, current);
  return () => {
    current.delete(listener);
    if (current.size === 0) listeners.delete(sessionId);
  };
};

/**
 * Draft ownership lives outside the route so navigation and late request failures cannot discard
 * authored text. Images stay in memory because their base64 payloads do not belong in SecureStore.
 */
export const useSessionDraft = (
  sessionId: string,
): readonly [SessionDraft, (draft: SessionDraft) => void] => {
  const subscribeToSession = React.useCallback(
    (listener: () => void) => subscribe(sessionId, listener),
    [sessionId],
  );
  const getSnapshot = React.useCallback(() => readSessionDraft(sessionId), [sessionId]);
  const draft = React.useSyncExternalStore(subscribeToSession, getSnapshot, getSnapshot);
  const setDraft = React.useCallback(
    (next: SessionDraft) => writeSessionDraft(sessionId, next),
    [sessionId],
  );
  return [draft, setDraft];
};
