// The draft's canonical owner: a module-level store, so the prompt text
// survives route changes. Home and /chat read the same "start" entry — one
// start surface, wherever it renders — and each thread keys by its session
// id. In memory on purpose: the draft's job is to outlive navigation, not an
// app restart.

import * as React from "react";

import type { Session } from "@honk/core/session";

export interface ComposerMessage {
  readonly text: string;
  readonly images: readonly Session.PromptImage[];
}

export const EMPTY_MESSAGE: ComposerMessage = Object.freeze({ text: "", images: [] });

const drafts = new Map<string, ComposerMessage>();
const listeners = new Set<() => void>();

export const draftKeyOf = (sessionId: Session.SessionId | null): string => sessionId ?? "start";

export const readDraft = (key: string): ComposerMessage => drafts.get(key) ?? EMPTY_MESSAGE;

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function writeDraft(key: string, message: ComposerMessage): void {
  if (message.text.length === 0 && message.images.length === 0) drafts.delete(key);
  else drafts.set(key, message);
  for (const listener of listeners) listener();
}

/**
 * Puts cleared text back in the editor without losing anything typed since:
 * the restored words come first, the newer draft after. One path for every
 * restore — a rejected send, a stop's cleared queue, a failed first prompt.
 */
export function restoreDraft(key: string, message: ComposerMessage): void {
  if (message.text.length === 0 && message.images.length === 0) return;
  const current = readDraft(key);
  writeDraft(key, {
    text:
      current.text.length === 0
        ? message.text
        : message.text.length === 0
          ? current.text
          : `${message.text}\n\n${current.text}`,
    images: [...message.images, ...current.images],
  });
}

export function useDraft(
  key: string,
): readonly [ComposerMessage, (message: ComposerMessage) => void] {
  // The server snapshot reads the same store: a static render shows a
  // prefilled draft rather than an empty box that hydrates late.
  const draft = React.useSyncExternalStore(
    subscribeDrafts,
    () => readDraft(key),
    () => readDraft(key),
  );
  const setDraft = (message: ComposerMessage) => writeDraft(key, message);
  return [draft, setDraft];
}

/** The prompt's axis of the composer machine; the surface axis is the session. */
export type PromptPhase = "empty" | "draft" | "submitting";

// Submitting wins over text: a locked composer never re-arms its send.
export const promptPhaseOf = (message: ComposerMessage, submitting: boolean): PromptPhase =>
  submitting
    ? "submitting"
    : message.text.length > 0 || message.images.length > 0
      ? "draft"
      : "empty";

/**
 * The three core verbs a submit can become (contract.ts Prompt / FollowUp /
 * Steer). Idle Enter prompts; running Enter queues a follow-up; running
 * Cmd/Ctrl+Enter steers the run in flight.
 */
export type SubmitVerb = "prompt" | "followUp" | "steer";

export const submitVerbOf = (running: boolean, sendNow: boolean): SubmitVerb =>
  !running ? "prompt" : sendNow ? "steer" : "followUp";

export type SubmitLabel = "Send" | "Queue" | "Steer";

/**
 * The submit button's label and aria name what pressing Enter will do right
 * now. `sendNow` is the held Cmd/Ctrl modifier — while it is down, Enter
 * steers, and the button says so; without it "Steer" would be a chord the
 * button could never name.
 */
export const submitLabelOf = (
  phase: PromptPhase,
  running: boolean,
  sendNow: boolean,
): SubmitLabel => (phase === "submitting" || !running ? "Send" : sendNow ? "Steer" : "Queue");

/**
 * What one keydown in the editor means. An open mention menu owns
 * Enter/Tab/Arrows and the first Escape before the send branch ever sees
 * them; Shift+Enter stays a newline (the browser default, so "newline" means
 * do nothing).
 */
export type ComposerKeyAction =
  | "none"
  | "newline"
  | "submit"
  | "submit-now"
  | "menu-accept"
  | "menu-close"
  | "menu-up"
  | "menu-down";

export const composerKeyActionOf = (
  key: { readonly key: string; readonly shiftKey: boolean; readonly mod: boolean },
  menuOpen: boolean,
): ComposerKeyAction => {
  if (menuOpen) {
    switch (key.key) {
      case "ArrowDown":
        return "menu-down";
      case "ArrowUp":
        return "menu-up";
      case "Escape":
        return "menu-close";
      case "Enter":
      case "Tab":
        return "menu-accept";
      default:
        break;
    }
  }
  if (key.key !== "Enter") return "none";
  if (key.shiftKey) return "newline";
  return key.mod ? "submit-now" : "submit";
};

/** What a start-surface submit does; only a resting draft with a folder starts. */
export type StartSubmit =
  | "ignore"
  | "choose-folder"
  | { readonly message: ComposerMessage; readonly directory: string };

// A submit while the session is being created changes nothing: the editor is
// locked with the text visible, and only success clears it.
export const startSubmitOf = (
  draft: ComposerMessage,
  submitting: boolean,
  directory: string | null,
): StartSubmit => {
  if (promptPhaseOf(draft, submitting) !== "draft") return "ignore";
  if (directory === null) return "choose-folder";
  return { message: draft, directory };
};
