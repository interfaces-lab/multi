// The provider sign-in state machine over Honk Core's models namespace. Flow
// transitions live in a pure reducer so the login state machine is testable
// without DOM; the factory takes the client so tests inject a faux, and the
// panel that mounts a store owns its lifetime. The provider rows themselves
// live in ./chat/model-catalog — a credential change here just refreshes that
// shared catalog.

import type { HonkClient } from "@honk/core";
import { Models } from "@honk/core/models";

import { describeError } from "./chat/client";
import { refreshCatalog } from "./chat/model-catalog";

export type LoginNotice = Extract<
  Models.LoginEvent,
  { kind: "open_url" | "device_code" | "info" | "progress" }
>;
export type LoginPrompt = Extract<Models.LoginEvent, { kind: "prompt" }>;

export type ProviderFlow =
  | { readonly kind: "api-key"; readonly providerId: string; readonly saving: boolean }
  | {
      readonly kind: "oauth";
      readonly providerId: string;
      readonly notices: readonly LoginNotice[];
      readonly prompt: LoginPrompt | null;
      readonly answering: boolean;
    }
  | { readonly kind: "signing-out"; readonly providerId: string };

export type ProviderAuthState = {
  readonly flow: ProviderFlow | null;
  readonly error: string | null;
};

export type ProviderAuthEvent =
  | { readonly type: "begin-api-key"; readonly providerId: string }
  | { readonly type: "api-key-saving" }
  | { readonly type: "begin-oauth"; readonly providerId: string }
  | { readonly type: "login-frame"; readonly frame: Models.LoginEvent }
  | { readonly type: "login-ended" }
  | { readonly type: "answer-sent" }
  | { readonly type: "answer-settled"; readonly promptId: string }
  | { readonly type: "answer-failed"; readonly message: string }
  | { readonly type: "begin-sign-out"; readonly providerId: string }
  | { readonly type: "flow-closed" }
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "cancel" };

export const INITIAL_PROVIDER_AUTH_STATE: ProviderAuthState = Object.freeze<ProviderAuthState>({
  flow: null,
  error: null,
});

export function reduceProviderAuth(
  state: ProviderAuthState,
  event: ProviderAuthEvent,
): ProviderAuthState {
  switch (event.type) {
    case "begin-api-key":
      if (state.flow !== null) return state;
      return {
        ...state,
        flow: { kind: "api-key", providerId: event.providerId, saving: false },
        error: null,
      };
    case "api-key-saving":
      if (state.flow?.kind !== "api-key") return state;
      return { ...state, flow: { ...state.flow, saving: true }, error: null };
    case "begin-oauth":
      if (state.flow !== null) return state;
      return {
        ...state,
        flow: {
          kind: "oauth",
          providerId: event.providerId,
          notices: [],
          prompt: null,
          answering: false,
        },
        error: null,
      };
    case "login-frame": {
      const flow = state.flow;
      if (flow?.kind !== "oauth") return state;
      const frame = event.frame;
      if (frame.kind === "done") return { ...state, flow: null };
      if (frame.kind === "prompt") {
        return { ...state, flow: { ...flow, prompt: frame, answering: false } };
      }
      return { ...state, flow: { ...flow, notices: [...flow.notices, frame] } };
    }
    case "login-ended":
      // Stream over without `done`: cancelled, failed upstream, or the
      // localhost callback finished the flow. A pending prompt is void either
      // way (models.ts: no cancellation frame is ever sent).
      if (state.flow?.kind !== "oauth") return state;
      return { ...state, flow: null };
    case "answer-sent":
      if (state.flow?.kind !== "oauth" || state.flow.prompt === null) return state;
      return { ...state, flow: { ...state.flow, answering: true }, error: null };
    case "answer-settled":
      if (state.flow?.kind !== "oauth") return state;
      // The next prompt frame can beat the answer's response; only the prompt
      // that was answered clears, never its successor.
      if (state.flow.prompt?.promptId !== event.promptId) return state;
      return { ...state, flow: { ...state.flow, prompt: null, answering: false } };
    case "answer-failed":
      // The prompt stays so the user can retry a mistyped code.
      if (state.flow?.kind !== "oauth") return state;
      return { ...state, flow: { ...state.flow, answering: false }, error: event.message };
    case "begin-sign-out":
      if (state.flow !== null) return state;
      return {
        ...state,
        flow: { kind: "signing-out", providerId: event.providerId },
        error: null,
      };
    case "flow-closed":
      return { ...state, flow: null };
    case "failed":
      // An api-key save failure keeps the form open for a retry; every other
      // flow closes on failure.
      if (state.flow?.kind === "api-key") {
        return { ...state, flow: { ...state.flow, saving: false }, error: event.message };
      }
      return { ...state, flow: null, error: event.message };
    case "cancel":
      return { ...state, flow: null, error: null };
  }
}

export type ProviderAuthStore = {
  readonly getState: () => ProviderAuthState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Keeps the store active for one mounted owner and returns its release function. */
  readonly retain: () => () => void;
  readonly beginApiKey: (providerId: string) => void;
  readonly submitApiKey: (value: string) => Promise<void>;
  /** Direct save for the add-provider dialog; rejects so the caller owns the error line. */
  readonly saveCredential: (providerId: string, key: string) => Promise<void>;
  readonly beginOauth: (providerId: string) => void;
  readonly answerPrompt: (value: string) => Promise<void>;
  readonly signOut: (providerId: string) => Promise<void>;
  readonly cancel: () => void;
};

export function createProviderAuthStore(client: Pick<HonkClient, "models">): ProviderAuthStore {
  let state = INITIAL_PROVIDER_AUTH_STATE;
  let active = true;
  // Guards stale flow completions after cancel or the last owner releases the store.
  let flowSequence = 0;
  let loginFrames: AsyncIterator<Models.LoginEvent> | null = null;
  let retainCount = 0;
  const listeners = new Set<() => void>();

  const dispatch = (event: ProviderAuthEvent): void => {
    if (!active) return;
    const next = reduceProviderAuth(state, event);
    if (next === state) return;
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const endLoginStream = (): void => {
    const frames = loginFrames;
    loginFrames = null;
    if (frames !== null) void frames.return?.(undefined);
  };

  const deactivate = (): void => {
    flowSequence += 1;
    endLoginStream();
    active = false;
    // Reactivation must not resurrect a flow whose stream is already dead —
    // a re-retained owner (StrictMode, Activity reuse) starts from a clean panel.
    state = INITIAL_PROVIDER_AUTH_STATE;
    listeners.clear();
  };

  const beginOauth = (providerId: string): void => {
    if (state.flow !== null) return;
    const sequence = ++flowSequence;
    dispatch({ type: "begin-oauth", providerId });
    const frames = client.models.login({ providerId })[Symbol.asyncIterator]();
    loginFrames = frames;
    void (async () => {
      try {
        for (let next = await frames.next(); next.done !== true; next = await frames.next()) {
          if (sequence !== flowSequence) return;
          const frame = next.value;
          dispatch({ type: "login-frame", frame });
          if (frame.kind === "done") {
            loginFrames = null;
            await refreshCatalog();
            return;
          }
        }
        if (sequence === flowSequence) {
          loginFrames = null;
          dispatch({ type: "login-ended" });
        }
      } catch (error) {
        if (sequence === flowSequence) {
          loginFrames = null;
          dispatch({ type: "failed", message: describeError(error) });
        }
      }
    })();
  };

  const submitApiKey = async (value: string): Promise<void> => {
    const flow = state.flow;
    const key = value.trim();
    if (flow?.kind !== "api-key" || flow.saving || key.length === 0) return;
    const sequence = ++flowSequence;
    dispatch({ type: "api-key-saving" });
    try {
      await client.models.setCredential({ providerId: flow.providerId, key });
      if (sequence !== flowSequence) return;
      dispatch({ type: "flow-closed" });
      await refreshCatalog();
    } catch (error) {
      if (sequence === flowSequence) dispatch({ type: "failed", message: describeError(error) });
    }
  };

  const saveCredential = async (providerId: string, key: string): Promise<void> => {
    await client.models.setCredential({ providerId, key });
    await refreshCatalog();
  };

  const answerPrompt = async (value: string): Promise<void> => {
    const flow = state.flow;
    if (flow?.kind !== "oauth" || flow.prompt === null || flow.answering) return;
    const answer = flow.prompt.promptType === "select" ? value : value.trim();
    if (answer.length === 0) return;
    const promptId = flow.prompt.promptId;
    dispatch({ type: "answer-sent" });
    try {
      await client.models.answerLogin({ promptId, value: answer });
      dispatch({ type: "answer-settled", promptId });
    } catch (error) {
      // models.unknown_login_prompt means the flow settled out of band (the
      // localhost callback won the race): the prompt is over, not broken.
      if (error instanceof Models.UnknownLoginPromptError) {
        dispatch({ type: "answer-settled", promptId });
      } else dispatch({ type: "answer-failed", message: describeError(error) });
    }
  };

  const signOut = async (providerId: string): Promise<void> => {
    if (state.flow !== null) return;
    const sequence = ++flowSequence;
    dispatch({ type: "begin-sign-out", providerId });
    try {
      await client.models.deleteCredential({ providerId });
      if (sequence !== flowSequence) return;
      dispatch({ type: "flow-closed" });
      await refreshCatalog();
    } catch (error) {
      if (sequence === flowSequence) dispatch({ type: "failed", message: describeError(error) });
    }
  };

  const cancel = (): void => {
    flowSequence += 1;
    endLoginStream();
    dispatch({ type: "cancel" });
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retain() {
      retainCount += 1;
      active = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retainCount -= 1;
        if (retainCount === 0) deactivate();
      };
    },
    beginApiKey(providerId) {
      dispatch({ type: "begin-api-key", providerId });
    },
    submitApiKey,
    saveCredential,
    beginOauth,
    answerPrompt,
    signOut,
    cancel,
  };
}
