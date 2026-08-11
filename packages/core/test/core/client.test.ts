// The construction contract from spec/core.md section 6: createHonkCore
// resolves ready or rejects, core.client() is synchronous, and one core can
// hand out several independent clients.

import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";

import type { HonkClient, SessionWatchCalls } from "../../src/client";
import { watchSession } from "../../src/client";
import { createHonkCore } from "../../src/honk-core";
import { Files } from "../../src/files";
import { Session } from "../../src/session";
import { createExecutionEnv, gatedResponse, messageEntries, textOf } from "../../src/testing";
import { Workspace } from "../../src/workspace";

const startCore = async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const faux = fauxProvider();
  const collection = createModels();
  collection.setProvider(faux.provider);
  const core = await createHonkCore({
    // Fresh per core: the data directory is stateful now, and a shared fixed
    // path would leak sessions and lease conflicts between runs.
    dataDirectory: await mkdtemp(join(tmpdir(), "honk-core-data-")),
    createModels: () => collection,
    generateSessionTitle: Session.generatePromptSessionTitle,
    createExecutionEnv,
  });
  return { core, faux };
};

// Trust is a first-class step, never an implicit retry: the first open refuses,
// consent is recorded, the second open is ready. Trust canonicalizes through
// the real filesystem, so the directory must exist.
const openTrusted = async (sdk: HonkClient, directory: string) => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
  const refused = await sdk.workspace.open({ directory });
  expect(refused.type).toBe("trust_required");
  await sdk.workspace.trust({ directory });
  const opened = await sdk.workspace.open({ directory });
  if (opened.type !== "ready") throw new Error("expected a ready workspace after trust");
  return opened;
};

describe("createHonkCore", () => {
  it("drives a session end to end through the public sdk", async () => {
    const { core, faux } = await startCore();
    const sdk = core.client();

    const workspace = await openTrusted(sdk, "/tmp/honk-core-test/repo");
    const session = await sdk.session.create({ workspaceId: workspace.id });

    faux.setResponses([() => Promise.resolve(fauxAssistantMessage("Hello from Pi."))]);
    await sdk.session.prompt({ sessionId: session.id, text: "Say hello" });

    const state = await sdk.session.reload({ sessionId: session.id });
    expect(state.phase).toBe("idle");
    expect(messageEntries(state.entries).map(textOf)).toEqual(["Say hello", "Hello from Pi."]);

    await core.close();
  });

  it("aborts and settles a live Pi harness before close returns", async () => {
    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, "/tmp/honk-core-test/close-running");
    const session = await sdk.session.create({ workspaceId: workspace.id });
    const gated = gatedResponse("never delivered");
    let markAborted!: () => void;
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    faux.setResponses([
      async (context, options, state, model) => {
        const signal = options?.signal;
        if (signal?.aborted === true) markAborted();
        else signal?.addEventListener("abort", markAborted, { once: true });
        return gated.response(context, options, state, model);
      },
    ]);

    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const watching = (async () => {
      for await (const frame of sdk.session.events({ sessionId: session.id })) {
        if (frame.type === "event" && frame.event.type === "agent_start") {
          markStarted();
          break;
        }
      }
    })();
    const running = sdk.session.prompt({ sessionId: session.id, text: "wait" }).catch(() => {});
    await started;
    await watching;

    await core.close();
    await aborted;
    await running;
  });

  it("hands out independent clients from one core", async () => {
    const { core } = await startCore();
    const first = core.client();
    const second = core.client();

    const workspace = await openTrusted(first, "/tmp/honk-core-test/shared");

    // Trust is core state, not client state: the second client sees it without
    // repeating the flow.
    const opened = await second.workspace.open({ directory: "/tmp/honk-core-test/shared" });
    expect(opened).toMatchObject({ type: "ready", id: workspace.id });

    // Closing one interface leaves the core and its other interfaces running.
    await first.close();
    const session = await second.session.create({ workspaceId: workspace.id });
    expect(session.workspaceId).toBe(workspace.id);

    await core.close();
  });

  it("rejects with the owning error class, not a wrapper", async () => {
    const { core } = await startCore();
    const sdk = core.client();

    await expect(
      sdk.session.reload({ sessionId: Session.SessionId.make("nope") }),
    ).rejects.toBeInstanceOf(Session.NotFoundError);

    // A relative directory has no canonical form the core may resolve.
    await expect(sdk.workspace.open({ directory: "relative/path" })).rejects.toBeInstanceOf(
      Workspace.OpenError,
    );

    await core.close();
  });

  it("streams events as an async iterable that detaches on break", async () => {
    const { core, faux } = await startCore();
    const sdk = core.client();

    const workspace = await openTrusted(sdk, "/tmp/honk-core-test/events");
    const session = await sdk.session.create({ workspaceId: workspace.id });

    const seen: string[] = [];
    const watching = (async () => {
      for await (const frame of sdk.session.events({ sessionId: session.id })) {
        seen.push(frame.type === "live" ? "live" : frame.event.type);
        if (frame.type === "event" && frame.event.type === "settled") break;
      }
    })();

    // The head frame proves the subscription is live before the prompt runs, so
    // prompting cannot outrun the stream.
    faux.setResponses([() => Promise.resolve(fauxAssistantMessage("Streamed."))]);
    await sdk.session.prompt({ sessionId: session.id, text: "Stream something" });
    await watching;

    expect(seen[0]).toBe("live");
    expect(seen).toContain("agent_start");
    expect(seen.at(-1)).toBe("settled");

    await core.close();
  });

  it("watch hands a surface authoritative state frames around advisory events", async () => {
    const { core, faux } = await startCore();
    const sdk = core.client();

    const workspace = await openTrusted(sdk, "/tmp/honk-core-test/watch");
    const session = await sdk.session.create({ workspaceId: workspace.id });

    const frames: { readonly type: string; readonly texts?: readonly (string | undefined)[] }[] =
      [];
    const watching = (async () => {
      for await (const frame of sdk.session.watch({ sessionId: session.id })) {
        if (frame.type === "state") {
          const texts = messageEntries(frame.entries).map(textOf);
          frames.push({ type: "state", texts });
          // The state after settlement carries the whole committed turn.
          if (texts.length === 2) break;
        } else {
          frames.push({ type: frame.event.type });
        }
      }
    })();

    faux.setResponses([() => Promise.resolve(fauxAssistantMessage("Watched."))]);
    await sdk.session.prompt({ sessionId: session.id, text: "Watch this" });
    await watching;

    // Attach delivers authoritative truth before any event.
    expect(frames[0]).toEqual({ type: "state", texts: [] });
    // Every event is eventually followed by a state frame, and the final
    // state holds the committed conversation.
    expect(frames.map((frame) => frame.type)).toContain("agent_start");
    const finalState = frames.at(-1);
    expect(finalState?.type).toBe("state");
    expect(finalState?.texts).toEqual(["Watch this", "Watched."]);

    await core.close();
  });

  it("watch reloads only the unseen Pi entry tail", async () => {
    const sessionId = Session.SessionId.make("session-1");
    const first: Session.SessionTreeEntry = {
      type: "custom",
      id: "entry-1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "test",
    };
    const second: Session.SessionTreeEntry = { ...first, id: "entry-2", parentId: first.id };
    const reloadInputs: unknown[] = [];
    const reloads: Session.ReloadOutput[] = [
      { entries: [first], phase: "idle", entrySeq: 1 },
      { entries: [second], phase: "idle", entrySeq: 2 },
    ];
    const eventFrames: readonly Session.EventsFrame[] = [
      { type: "live" },
      { type: "event", event: { type: "settled", nextTurnCount: 0 } },
    ];
    const calls: SessionWatchCalls = {
      reload: async (input) => {
        reloadInputs.push(input);
        const next = reloads.shift();
        if (next === undefined) throw new Error("unexpected reload");
        return next;
      },
      changes: async () => ({ turns: [] }),
      events: async function* () {
        yield* eventFrames;
      },
    };

    const states = [];
    for await (const frame of watchSession(calls, { sessionId })) {
      if (frame.type === "state") states.push(frame);
    }

    expect(reloadInputs).toEqual([{ sessionId }, { sessionId, afterEntrySeq: 1 }]);
    expect(states.at(-1)?.entries).toEqual([first, second]);
  });

  it("watch replaces the active branch after tree navigation, then resumes from the log cursor", async () => {
    const sessionId = Session.SessionId.make("session-tree");
    const root: Session.SessionTreeEntry = {
      type: "custom",
      id: "root",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "test",
    };
    const old = { ...root, id: "old", parentId: root.id };
    const revised = { ...root, id: "revised", parentId: root.id };
    const answer = { ...root, id: "answer", parentId: revised.id };
    const reloadInputs: unknown[] = [];
    const reloads: Session.ReloadOutput[] = [
      { entries: [root, old], phase: "idle", entrySeq: 2 },
      { entries: [root, revised], phase: "idle", entrySeq: 3 },
      { entries: [answer], phase: "turn", entrySeq: 4 },
    ];
    const eventFrames: readonly Session.EventsFrame[] = [
      { type: "live" },
      {
        type: "event",
        event: {
          type: "session_tree",
          oldLeafId: old.id,
          newLeafId: root.id,
        },
      },
      {
        type: "event",
        event: { type: "agent_start" },
      },
    ];
    const calls: SessionWatchCalls = {
      reload: async (input) => {
        reloadInputs.push(input);
        const next = reloads.shift();
        if (next === undefined) throw new Error("unexpected reload");
        return next;
      },
      changes: async () => ({ turns: [] }),
      events: async function* () {
        yield* eventFrames;
      },
    };

    const states = [];
    for await (const frame of watchSession(calls, { sessionId })) {
      if (frame.type === "state") states.push(frame);
    }

    expect(reloadInputs).toEqual([{ sessionId }, { sessionId }, { sessionId, afterEntrySeq: 3 }]);
    expect(states.map((state) => state.entries)).toEqual([
      [root, old],
      [root, revised],
      [root, revised, answer],
    ]);
  });
});

describe("sdk.files through the public client", () => {
  it("reads and writes inside a trusted workspace and refuses an escape", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const directory = await mkdtemp(join(tmpdir(), "honk-sdk-files-"));
    const { core } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);

    await sdk.files.write({
      workspaceId: workspace.id,
      path: "notes/todo.md",
      content: "# Todo\n",
    });
    const read = await sdk.files.read({ workspaceId: workspace.id, path: "notes/todo.md" });
    expect(read).toMatchObject({ type: "text", text: "# Todo\n" });

    const listed = await sdk.files.list({ workspaceId: workspace.id, path: "notes" });
    expect(listed.map((entry) => entry.path)).toContain("notes/todo.md");

    // The workspace directory is the boundary, through the public client too.
    await expect(
      sdk.files.read({ workspaceId: workspace.id, path: "../escape.txt" }),
    ).rejects.toBeInstanceOf(Files.EscapeError);

    await core.close();
  });
});
