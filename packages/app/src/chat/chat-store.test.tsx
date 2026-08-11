import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Session } from "@honk/core/session";

import type { CoreChat } from "./chat-store";
import { markSessionTabVisited, retainSession, sessionStateOf, useCoreSession } from "./chat-store";

const clientMocks = vi.hoisted(() => ({
  getHonkClient: vi.fn((): unknown => null),
  getSnapshot: vi.fn((): unknown => ({ status: "connecting" })),
}));

const tabMocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const tabs: { current: string[] } = { current: [] };
  return {
    listeners,
    tabs,
  };
});

vi.mock("./client", () => ({
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  getHonkClient: clientMocks.getHonkClient,
  getSnapshot: clientMocks.getSnapshot,
  subscribe: () => () => {},
}));

vi.mock("../tab-store", () => ({
  getSnapshot: () => ({ tabs: tabMocks.tabs.current }),
  subscribe: (listener: () => void) => {
    tabMocks.listeners.add(listener);
    return () => {
      tabMocks.listeners.delete(listener);
    };
  },
}));

function publishTabs(tabs: readonly Session.SessionId[]): void {
  tabMocks.tabs.current = [...tabs];
  for (const listener of tabMocks.listeners) listener();
}

beforeEach(() => {
  publishTabs([]);
  clientMocks.getHonkClient.mockReturnValue(null);
  clientMocks.getSnapshot.mockReturnValue({ status: "connecting" });
});

// The probe renders once to capture the hook's command surface; the store
// itself lives at module level, so the commands work without a mounted tree.
const chatOf = (sessionId: Session.SessionId): CoreChat => {
  let chat: CoreChat | null = null;
  function Probe(): null {
    chat = useCoreSession(sessionId);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (chat === null) throw new Error("the probe did not render");
  return chat;
};

// One committed idle frame, then the stream stays open.
const watchOf = (frames: readonly unknown[], onReturn: () => void = () => undefined) => ({
  [Symbol.asyncIterator]: () => {
    let index = 0;
    let closed = false;
    let resolvePending: ((result: IteratorResult<unknown>) => void) | null = null;
    return {
      next: () =>
        index < frames.length
          ? Promise.resolve({ done: false, value: frames[index++] })
          : closed
            ? Promise.resolve({ done: true, value: undefined })
            : new Promise<IteratorResult<unknown>>((resolve) => {
                resolvePending = resolve;
              }),
      return: () => {
        closed = true;
        onReturn();
        resolvePending?.({ done: true, value: undefined });
        resolvePending = null;
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  },
});

const idleFrame = { type: "state", entries: [], phase: "idle", turns: [] };
const message = (text: string) => ({ text, images: [] });
const imageMessage = {
  text: "look here",
  images: [{ data: "pixel", mimeType: "image/png" }],
};

describe("chat store commands", () => {
  it("keeps a visited open tab live and releases it when the tab closes", async () => {
    const sessionId = Session.SessionId.make("ses_retained_tab");
    const stopWatch = vi.fn();
    const watch = vi.fn(() => watchOf([idleFrame], stopWatch));
    const client = { session: { watch } };
    clientMocks.getSnapshot.mockReturnValue({ status: "ready", client });
    clientMocks.getHonkClient.mockReturnValue(client);
    publishTabs([sessionId]);

    const release = retainSession(sessionId);
    markSessionTabVisited(sessionId);
    await vi.waitFor(() => {
      expect(sessionStateOf(sessionId).status).toBe("ready");
    });

    release();
    expect(stopWatch).not.toHaveBeenCalled();
    expect(sessionStateOf(sessionId).status).toBe("ready");

    const releaseRevisit = retainSession(sessionId);
    expect(sessionStateOf(sessionId).status).toBe("ready");
    expect(watch).toHaveBeenCalledTimes(1);
    releaseRevisit();

    publishTabs([]);
    expect(stopWatch).toHaveBeenCalledTimes(1);
    expect(sessionStateOf(sessionId).status).toBe("connecting");
  });

  it("waits for the mounted thread surface before releasing a closed tab", async () => {
    const sessionId = Session.SessionId.make("ses_close_while_mounted");
    const stopWatch = vi.fn();
    const client = { session: { watch: () => watchOf([idleFrame], stopWatch) } };
    clientMocks.getSnapshot.mockReturnValue({ status: "ready", client });
    clientMocks.getHonkClient.mockReturnValue(client);
    publishTabs([sessionId]);

    const release = retainSession(sessionId);
    markSessionTabVisited(sessionId);
    await vi.waitFor(() => {
      expect(sessionStateOf(sessionId).status).toBe("ready");
    });

    publishTabs([]);
    expect(stopWatch).not.toHaveBeenCalled();
    expect(sessionStateOf(sessionId).status).toBe("ready");

    release();
    expect(stopWatch).toHaveBeenCalledTimes(1);
    expect(sessionStateOf(sessionId).status).toBe("connecting");
  });

  it("does not retain a thread without an owning top-level tab", async () => {
    const sessionId = Session.SessionId.make("ses_child_deep_link");
    const stopWatch = vi.fn();
    const client = { session: { watch: () => watchOf([idleFrame], stopWatch) } };
    clientMocks.getSnapshot.mockReturnValue({ status: "ready", client });
    clientMocks.getHonkClient.mockReturnValue(client);

    const release = retainSession(sessionId);
    markSessionTabVisited(sessionId);
    await vi.waitFor(() => {
      expect(sessionStateOf(sessionId).status).toBe("ready");
    });
    release();

    expect(stopWatch).toHaveBeenCalledTimes(1);
    expect(sessionStateOf(sessionId).status).toBe("connecting");
  });

  it("a command with no client rejects with the truth instead of resolving", async () => {
    const chat = chatOf(Session.SessionId.make("ses_no_client"));
    await expect(chat.prompt(message("hi"))).rejects.toThrow("Honk Core is not connected yet.");
    await expect(chat.steer(message("left"))).rejects.toThrow("Honk Core is not connected yet.");
    await expect(chat.stop()).rejects.toThrow("Honk Core is not connected yet.");
    await expect(
      chat.setModel({ providerId: "anthropic", modelId: "claude-opus-5" }),
    ).rejects.toThrow("Honk Core is not connected yet.");
  });

  it("stop surfaces the abort output so the composer can restore cleared text", async () => {
    const cleared = { clearedSteer: [], clearedFollowUp: [] };
    clientMocks.getHonkClient.mockReturnValue({
      session: { abort: vi.fn(() => Promise.resolve(cleared)) },
    });
    const chat = chatOf(Session.SessionId.make("ses_stop"));
    await expect(chat.stop()).resolves.toBe(cleared);
  });

  it("a rejected settings mutation reaches the caller and the session stays alive", async () => {
    const sessionId = Session.SessionId.make("ses_mutation");
    const client = {
      session: {
        watch: () => watchOf([idleFrame]),
        setModel: vi.fn(() => Promise.reject(new Error("models.resolve: unknown model"))),
        setThinkingLevel: vi.fn(() => Promise.reject(new Error("session.not_found: gone"))),
      },
    };
    clientMocks.getSnapshot.mockReturnValue({ status: "ready", client });
    clientMocks.getHonkClient.mockReturnValue(client);

    const release = retainSession(sessionId);
    await vi.waitFor(() => {
      expect(sessionStateOf(sessionId).status).toBe("ready");
    });

    const chat = chatOf(sessionId);
    await expect(
      chat.setModel({ providerId: "anthropic", modelId: "no-such-model" }),
    ).rejects.toThrow("unknown model");
    await expect(chat.setThinkingLevel("high")).rejects.toThrow("session.not_found");
    // The failure was transient: no failed fold, the selector never locks.
    expect(sessionStateOf(sessionId).status).toBe("ready");
    expect(sessionStateOf(sessionId).error).toBeNull();
    release();
  });

  it("a rejected run command leaves session health to the watch", async () => {
    const sessionId = Session.SessionId.make("ses_run_failure");
    const client = {
      session: {
        watch: () => watchOf([idleFrame]),
        prompt: vi.fn(() => Promise.reject(new Error("session.not_found: gone"))),
      },
    };
    clientMocks.getSnapshot.mockReturnValue({ status: "ready", client });
    clientMocks.getHonkClient.mockReturnValue(client);

    const release = retainSession(sessionId);
    await vi.waitFor(() => {
      expect(sessionStateOf(sessionId).status).toBe("ready");
    });

    const chat = chatOf(sessionId);
    await expect(chat.prompt(message("hi"))).rejects.toThrow("session.not_found");
    expect(sessionStateOf(sessionId).status).toBe("ready");
    expect(sessionStateOf(sessionId).error).toBeNull();
    release();
  });

  it("forwards images through every message verb", async () => {
    const sessionId = Session.SessionId.make("ses_images");
    const client = {
      session: {
        prompt: vi.fn(() => Promise.resolve()),
        editMessage: vi.fn(() => Promise.resolve()),
        steer: vi.fn(() => Promise.resolve()),
        followUp: vi.fn(() => Promise.resolve()),
      },
    };
    clientMocks.getHonkClient.mockReturnValue(client);
    const chat = chatOf(sessionId);

    await chat.prompt(imageMessage);
    await chat.editMessage("entry-1", imageMessage);
    await chat.steer(imageMessage);
    await chat.followUp(imageMessage);

    expect(client.session.prompt).toHaveBeenCalledWith({ sessionId, ...imageMessage });
    expect(client.session.editMessage).toHaveBeenCalledWith({
      sessionId,
      entryId: "entry-1",
      ...imageMessage,
    });
    expect(client.session.steer).toHaveBeenCalledWith({ sessionId, ...imageMessage });
    expect(client.session.followUp).toHaveBeenCalledWith({ sessionId, ...imageMessage });
  });

  it("keeps the session live when an edit is refused", async () => {
    const sessionId = Session.SessionId.make("ses_edit_refused");
    const client = {
      session: {
        watch: () => watchOf([idleFrame]),
        editMessage: vi.fn(() => Promise.reject(new Error("session.busy"))),
      },
    };
    clientMocks.getSnapshot.mockReturnValue({ status: "ready", client });
    clientMocks.getHonkClient.mockReturnValue(client);

    const release = retainSession(sessionId);
    await vi.waitFor(() => {
      expect(sessionStateOf(sessionId).status).toBe("ready");
    });

    await expect(chatOf(sessionId).editMessage("entry-1", imageMessage)).rejects.toThrow(
      "session.busy",
    );
    expect(sessionStateOf(sessionId).status).toBe("ready");
    expect(sessionStateOf(sessionId).error).toBeNull();
    release();
  });
});
