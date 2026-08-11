import type { HonkClient } from "@honk/core";
import type { Models } from "@honk/core/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProviderAuthStore,
  INITIAL_PROVIDER_AUTH_STATE,
  reduceProviderAuth,
  type ProviderAuthEvent,
} from "./provider-auth";

const { refreshCatalog } = vi.hoisted(() => ({
  refreshCatalog: vi.fn(() => Promise.resolve()),
}));

vi.mock("./chat/model-catalog", () => ({ refreshCatalog }));

beforeEach(() => {
  refreshCatalog.mockClear();
});

function play(events: readonly ProviderAuthEvent[], from = INITIAL_PROVIDER_AUTH_STATE) {
  return events.reduce(reduceProviderAuth, from);
}

const openUrl: Models.LoginEvent = { kind: "open_url", url: "https://auth.example.test" };
const progress: Models.LoginEvent = { kind: "progress", message: "Waiting for the browser…" };
const prompt: Models.LoginEvent = {
  kind: "prompt",
  promptId: "prompt_1",
  promptType: "manual_code",
  message: "Paste the code",
};

describe("reduceProviderAuth", () => {
  it("accumulates notice frames in arrival order", () => {
    const state = play([
      { type: "begin-oauth", providerId: "anthropic" },
      { type: "login-frame", frame: openUrl },
      { type: "login-frame", frame: progress },
    ]);
    expect(state.flow).toMatchObject({
      kind: "oauth",
      notices: [openUrl, progress],
      prompt: null,
    });
  });

  it("replaces a pending prompt with the newest prompt frame", () => {
    const second: Models.LoginEvent = {
      kind: "prompt",
      promptId: "prompt_2",
      promptType: "select",
      message: "Choose an account",
      options: [{ id: "personal", label: "Personal" }],
    };
    const state = play([
      { type: "begin-oauth", providerId: "anthropic" },
      { type: "login-frame", frame: prompt },
      { type: "login-frame", frame: second },
    ]);
    expect(state.flow).toMatchObject({ kind: "oauth", prompt: second });
  });

  it("closes the flow on the done frame", () => {
    const state = play([
      { type: "begin-oauth", providerId: "anthropic" },
      { type: "login-frame", frame: openUrl },
      { type: "login-frame", frame: { kind: "done" } },
    ]);
    expect(state.flow).toBeNull();
  });

  it("voids a pending prompt when the stream ends without done", () => {
    const state = play([
      { type: "begin-oauth", providerId: "anthropic" },
      { type: "login-frame", frame: prompt },
      { type: "login-ended" },
    ]);
    expect(state.flow).toBeNull();
  });

  it("only clears the prompt the answer settled, never a successor", () => {
    const second: Models.LoginEvent = {
      kind: "prompt",
      promptId: "prompt_2",
      promptType: "text",
      message: "One more thing",
    };
    const base = [
      { type: "begin-oauth", providerId: "anthropic" },
      { type: "login-frame", frame: prompt },
      { type: "answer-sent" },
    ] satisfies readonly ProviderAuthEvent[];
    const settled = play([...base, { type: "answer-settled", promptId: "prompt_1" }]);
    expect(settled.flow).toMatchObject({ kind: "oauth", prompt: null });
    // The next prompt frame beat the answer's response: it must survive.
    const raced = play([
      ...base,
      { type: "login-frame", frame: second },
      { type: "answer-settled", promptId: "prompt_1" },
    ]);
    expect(raced.flow).toMatchObject({ kind: "oauth", prompt: second });
  });

  it("ignores begin events while a flow is active", () => {
    const oauth = play([{ type: "begin-oauth", providerId: "anthropic" }]);
    expect(play([{ type: "begin-api-key", providerId: "openai" }], oauth)).toBe(oauth);
    expect(play([{ type: "begin-oauth", providerId: "openai" }], oauth)).toBe(oauth);
    expect(play([{ type: "begin-sign-out", providerId: "openai" }], oauth)).toBe(oauth);
  });

  it("keeps the api-key form open after a failed save", () => {
    const state = play([
      { type: "begin-api-key", providerId: "openai" },
      { type: "api-key-saving" },
      { type: "failed", message: "models.credential_failed: nope" },
    ]);
    expect(state.flow).toEqual({ kind: "api-key", providerId: "openai", saving: false });
    expect(state.error).toBe("models.credential_failed: nope");
  });

  it("clears the flow and error on cancel", () => {
    const state = play([
      { type: "begin-api-key", providerId: "openai" },
      { type: "failed", message: "boom" },
      { type: "cancel" },
    ]);
    expect(state.flow).toBeNull();
    expect(state.error).toBeNull();
  });
});

// A push-driven login stream: the test controls when frames arrive and sees
// whether the store cancelled via `return`.
interface LoginStreamController {
  readonly iterable: AsyncIterable<Models.LoginEvent>;
  readonly wasReturned: () => boolean;
  readonly push: (frame: Models.LoginEvent) => void;
  readonly end: () => void;
}

function loginStream(): LoginStreamController {
  let done = false;
  let returned = false;
  const buffered: Models.LoginEvent[] = [];
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const iterable: AsyncIterable<Models.LoginEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Models.LoginEvent>> {
          while (buffered.length === 0 && !done) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
          const frame = buffered.shift();
          if (frame !== undefined) return { value: frame, done: false };
          return { value: undefined, done: true };
        },
        async return(): Promise<IteratorResult<Models.LoginEvent>> {
          done = true;
          returned = true;
          notify();
          return { value: undefined, done: true };
        },
      };
    },
  };
  return {
    iterable,
    wasReturned: () => returned,
    push(frame: Models.LoginEvent) {
      buffered.push(frame);
      notify();
    },
    end() {
      done = true;
      notify();
    },
  };
}

function fakeClient(stream: LoginStreamController) {
  const models = {
    list: vi.fn(() => Promise.resolve({ providers: [] })),
    setCredential: vi.fn(() => Promise.resolve(undefined)),
    deleteCredential: vi.fn(() => Promise.resolve(undefined)),
    answerLogin: vi.fn(() => Promise.resolve(undefined)),
    login: vi.fn(() => stream.iterable),
  } satisfies HonkClient["models"];
  return { client: { models }, models };
}

describe("createProviderAuthStore", () => {
  it("refreshes the shared catalog after the done frame, without its own list", async () => {
    const stream = loginStream();
    const { client, models } = fakeClient(stream);
    const store = createProviderAuthStore(client);

    store.beginOauth("anthropic");
    stream.push(openUrl);
    stream.push({ kind: "done" });
    await vi.waitFor(() => {
      expect(refreshCatalog).toHaveBeenCalledTimes(1);
    });
    expect(models.list).not.toHaveBeenCalled();
    expect(store.getState().flow).toBeNull();
  });

  it("saveCredential stores the key, refreshes the catalog, and rejects to the caller", async () => {
    const stream = loginStream();
    const { client, models } = fakeClient(stream);
    const store = createProviderAuthStore(client);

    await store.saveCredential("deepseek", "sk-test");
    expect(models.setCredential).toHaveBeenCalledWith({ providerId: "deepseek", key: "sk-test" });
    expect(refreshCatalog).toHaveBeenCalledTimes(1);

    models.setCredential.mockRejectedValueOnce(new Error("bad key"));
    await expect(store.saveCredential("deepseek", "sk-bad")).rejects.toThrow("bad key");
    // The dialog owns the failure line; nothing refreshed behind it.
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
  });

  it("releasing the last owner ends the live stream and resets to the initial state", async () => {
    const stream = loginStream();
    const { client } = fakeClient(stream);
    const store = createProviderAuthStore(client);
    const release = store.retain();

    store.beginOauth("anthropic");
    stream.push(prompt);
    await vi.waitFor(() => {
      expect(store.getState().flow).toMatchObject({ kind: "oauth", prompt });
    });

    release();
    expect(store.getState()).toEqual(INITIAL_PROVIDER_AUTH_STATE);
    await vi.waitFor(() => {
      expect(stream.wasReturned()).toBe(true);
    });
    // Release is idempotent: StrictMode may invoke a cleanup it already ran.
    release();
    expect(store.getState()).toEqual(INITIAL_PROVIDER_AUTH_STATE);
  });

  it("re-retaining after release reactivates the store for a fresh flow", async () => {
    const first = loginStream();
    const { client, models } = fakeClient(first);
    const store = createProviderAuthStore(client);

    // StrictMode's mount → cleanup → remount on the same store instance.
    store.retain()();
    const release = store.retain();

    const second = loginStream();
    models.login.mockReturnValueOnce(second.iterable);
    store.beginOauth("anthropic");
    second.push(openUrl);
    await vi.waitFor(() => {
      expect(store.getState().flow).toMatchObject({ kind: "oauth", notices: [openUrl] });
    });
    release();
  });

  it("keeps the store active while any owner still holds a retain", async () => {
    const stream = loginStream();
    const { client } = fakeClient(stream);
    const store = createProviderAuthStore(client);
    const releaseFirst = store.retain();
    const releaseSecond = store.retain();

    store.beginOauth("anthropic");
    stream.push(prompt);
    await vi.waitFor(() => {
      expect(store.getState().flow).toMatchObject({ kind: "oauth", prompt });
    });

    releaseFirst();
    expect(store.getState().flow).toMatchObject({ kind: "oauth", prompt });
    expect(stream.wasReturned()).toBe(false);

    releaseSecond();
    expect(store.getState()).toEqual(INITIAL_PROVIDER_AUTH_STATE);
    await vi.waitFor(() => {
      expect(stream.wasReturned()).toBe(true);
    });
  });

  it("cancel ends the login stream and dismisses the flow", async () => {
    const stream = loginStream();
    const { client } = fakeClient(stream);
    const store = createProviderAuthStore(client);

    store.beginOauth("anthropic");
    stream.push(prompt);
    await vi.waitFor(() => {
      expect(store.getState().flow).toMatchObject({ kind: "oauth", prompt });
    });

    store.cancel();
    expect(store.getState().flow).toBeNull();
    await vi.waitFor(() => {
      expect(stream.wasReturned()).toBe(true);
    });
  });
});
