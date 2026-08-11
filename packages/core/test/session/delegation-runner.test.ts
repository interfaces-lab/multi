// The delegation runner at its deps seam: the single-flight lock's
// discipline (a held lock refuses another delegation), the stale-lock release
// the next user message performs, and
// the abort routing that turns an unfinished child into a failed
// delegation — and the child session every opened delegation names in its
// result. Stubbed collaborators, real runner.

import type {
  JsonlSessionCreateOptions,
  JsonlSessionListOptions,
  JsonlSessionMetadata,
  SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import {
  InMemorySessionStorage,
  JsonlSessionRepo,
  Session as PiSession,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { Effect, Semaphore } from "effect";
import { describe, expect, it } from "vitest";

import type { Models } from "../../src/models";
import { Workspace } from "../../src/workspace";
import { SessionId } from "../../src/session/contract";
import type { DelegationResult, DelegationSession } from "../../src/session/delegation";
import { makeDelegationRunner, releaseStaleLock } from "../../src/session/delegation";
import { seatingOf } from "../../src/session/fusion";
import type { Arm, Preset } from "../../src/session/subagents";
import { createTestStorage } from "../../src/testing";

const fauxArm: Arm = {
  model: { providerId: "faux", modelId: "faux-model" },
  thinkingLevel: "low",
};

const presets: readonly Preset[] = [
  {
    name: "review",
    label: "Review",
    description: "Reviews code without editing.",
    arm: fauxArm,
    prompt: "Review only.",
  },
];

interface StubChild {
  readonly prompt: () => Promise<AssistantMessage>;
  readonly abort?: () => Promise<unknown>;
  readonly closed?: boolean;
}

const until = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  expect(check()).toBe(true);
};

const makeWorld = (
  options: { readonly children?: readonly StubChild[]; readonly failSnapshot?: boolean } = {},
) => {
  const live = new Map<SessionId, DelegationSession>();
  const registered: SessionId[] = [];
  const settled: SessionId[] = [];
  const deleted: string[] = [];
  let closed = 0;
  let childCount = 0;
  const children = [...(options.children ?? [])];

  const stubPiSession = (
    id: string,
    entries: readonly SessionTreeEntry[],
  ): PiSession<JsonlSessionMetadata> => {
    const metadata: JsonlSessionMetadata = {
      id,
      createdAt: "2026-08-05T10:00:00.000Z",
      cwd: "/tmp/honk-runner-tests",
      path: `/tmp/honk-runner-tests/${id}.jsonl`,
    };
    return new PiSession(new InMemorySessionStorage({ metadata, entries: [...entries] }));
  };

  const env = createTestStorage();
  const binding: DelegationSession["binding"] = {
    workspace: {
      id: Workspace.WorkspaceId.make("ws-1"),
      directory: Workspace.WorkspaceDirectory.make("/tmp/honk-runner-tests"),
    },
    env,
  };

  const addParent = (id: string, entries: readonly SessionTreeEntry[]): DelegationSession => {
    const parent: DelegationSession = {
      session: stubPiSession(id, entries),
      harness: {
        prompt: async () => fauxAssistantMessage("parent: unused"),
        abort: async () => ({}),
      },
      binding,
      delegation: { active: false, sidekick: null },
      lifecycle: { closed: false, activeRuns: 0, admission: Semaphore.makeUnsafe(1) },
    };
    live.set(SessionId.make(id), parent);
    return parent;
  };

  const catalog: Models.ListOutput = {
    providers: [
      {
        id: "faux",
        name: "Faux",
        configured: true,
        methods: [],
        models: [{ id: "faux-model", name: "Faux Model" }],
      },
    ],
  };
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-model" }] });
  const model = faux.getModel();
  const models: Pick<Models.Interface, "list" | "resolve" | "resolveAvailable"> = {
    list: () => Effect.succeed(catalog),
    resolve: () => Effect.succeed(model),
    resolveAvailable: () => Effect.succeed(model),
  };

  class StubRepo extends JsonlSessionRepo {
    override create(_options: JsonlSessionCreateOptions): Promise<PiSession<JsonlSessionMetadata>> {
      return Promise.resolve(stubPiSession(`child-${String((childCount += 1))}`, []));
    }

    override list(_options?: JsonlSessionListOptions): Promise<JsonlSessionMetadata[]> {
      return Promise.resolve([]);
    }

    override delete(metadata: JsonlSessionMetadata): Promise<void> {
      deleted.push(metadata.id);
      return Promise.resolve();
    }
  }

  const runner = makeDelegationRunner<DelegationSession>({
    repo: new StubRepo({ fs: env, sessionsRoot: "sessions" }),
    models,
    presets,
    pairings: seatingOf([
      { stop: "low", main: fauxArm, sidekick: { ...fauxArm, thinkingLevel: "medium" } },
    ]),
    mcp: { run: () => Effect.succeed("") },
    liveOf: (sessionId) => Effect.sync(() => live.get(sessionId)),
    register: (sessionId, opened) =>
      Effect.sync(() => {
        live.set(sessionId, opened);
        registered.push(sessionId);
        return true;
      }),
    restore: () => Effect.succeed(undefined),
    makeLiveSession: (session) =>
      Effect.sync((): DelegationSession => {
        const child = children.shift() ?? {
          prompt: async () => fauxAssistantMessage("child: answer"),
        };
        return {
          session,
          harness: {
            prompt: child.prompt,
            abort: child.abort ?? (async () => ({})),
          },
          binding,
          delegation: { active: false, sidekick: null },
          lifecycle: {
            closed: child.closed ?? false,
            activeRuns: 0,
            admission: Semaphore.makeUnsafe(1),
          },
        };
      }),
    closeLiveSession: () =>
      Effect.sync(() => {
        closed += 1;
      }),
    captureSnapshot: () =>
      options.failSnapshot ? Effect.die(new Error("snapshot failed")) : Effect.void,
    settleSnapshot: (sessionId) =>
      Effect.sync(() => {
        settled.push(sessionId);
      }),
  });

  const delegate = (input: {
    readonly parentId: string;
    readonly subagentType: string;
    readonly signal?: AbortSignal;
  }): Promise<DelegationResult> =>
    Effect.runPromise(
      runner.runDelegation({
        parentId: SessionId.make(input.parentId),
        subagentType: input.subagentType,
        prompt: "delegated task",
        signal: input.signal,
      }),
    );

  return { addParent, delegate, registered, settled, deleted, closed: () => closed };
};

describe("the single-flight lock", () => {
  it("a held lock refuses a normal delegation and leaves the lock alone", async () => {
    const world = makeWorld();
    const parent = world.addParent("parent-1", []);
    parent.delegation.active = true;

    const result = await world.delegate({ parentId: "parent-1", subagentType: "review" });
    expect(result.text).toContain("already in flight");
    // A refusal opened nothing, so it names nothing.
    expect(result.sessionId).toBeUndefined();
    expect(parent.delegation.active).toBe(true);
    expect(world.registered).toHaveLength(0);
  });

  it("a never-settling child wedges the lock until the next user message frees it", async () => {
    const world = makeWorld({
      children: [{ prompt: () => new Promise<AssistantMessage>(() => undefined) }],
    });
    const parent = world.addParent("parent-1", []);

    void world.delegate({ parentId: "parent-1", subagentType: "review" });
    await until(() => parent.delegation.active);

    // While the parent runs, its harness is busy: the lock stays.
    releaseStaleLock(parent.delegation, "turn");
    expect(parent.delegation.active).toBe(true);

    // The next user prompt reaches an idle harness: the stale lock frees,
    // and a fresh delegation proceeds where it would have been refused.
    releaseStaleLock(parent.delegation, "idle");
    expect(parent.delegation.active).toBe(false);
    const result = await world.delegate({ parentId: "parent-1", subagentType: "review" });
    expect(result.text).toContain("child: answer");
  });
});

describe("abort routing", () => {
  it("does not start a delegated turn after its child session closes", async () => {
    let promptStarted = false;
    const world = makeWorld({
      children: [
        {
          closed: true,
          prompt: async () => {
            promptStarted = true;
            return fauxAssistantMessage("should not run");
          },
        },
      ],
    });
    world.addParent("parent-1", []);

    const result = await world.delegate({ parentId: "parent-1", subagentType: "review" });

    expect(result.text).toContain("delegation failed");
    expect(promptStarted).toBe(false);
  });

  it("the parent's abort signal aborts the child harness", async () => {
    let settle!: (message: AssistantMessage) => void;
    let promptStarted = false;
    let aborted = false;
    const world = makeWorld({
      children: [
        {
          prompt: () => {
            promptStarted = true;
            return new Promise<AssistantMessage>((resolve) => {
              settle = resolve;
            });
          },
          abort: async () => {
            aborted = true;
            settle({ ...fauxAssistantMessage("partial"), stopReason: "aborted" });
            return {};
          },
        },
      ],
    });
    const parent = world.addParent("parent-1", []);

    const controller = new AbortController();
    const pending = world.delegate({
      parentId: "parent-1",
      subagentType: "review",
      signal: controller.signal,
    });
    await until(() => promptStarted);

    controller.abort();
    const result = await pending;
    expect(aborted).toBe(true);
    expect(result.text).toContain("delegation failed");
    expect(parent.delegation.active).toBe(false);
  });

  it("an aborted child answer is a failed delegation, never clipped text", async () => {
    const world = makeWorld({
      children: [
        { prompt: async () => ({ ...fauxAssistantMessage("partial"), stopReason: "aborted" }) },
      ],
    });
    world.addParent("parent-1", []);

    const result = await world.delegate({ parentId: "parent-1", subagentType: "review" });
    expect(result.text).toContain("delegation failed");
    expect(result.text).not.toContain("partial");
  });

  it("an errored child answer carries the provider's message inline", async () => {
    const world = makeWorld({
      children: [
        {
          prompt: async () => ({
            ...fauxAssistantMessage(""),
            stopReason: "error",
            errorMessage: "provider exploded",
          }),
        },
      ],
    });
    world.addParent("parent-1", []);

    const result = await world.delegate({ parentId: "parent-1", subagentType: "review" });
    expect(result.text).toContain("delegation failed");
    expect(result.text).toContain("provider exploded");
  });
});

describe("child creation", () => {
  it("delegates settled-turn checkpointing to the session service", async () => {
    const world = makeWorld();
    world.addParent("parent-1", []);

    await world.delegate({ parentId: "parent-1", subagentType: "review" });

    expect(world.settled).toEqual(["child-1"]);
  });

  it("removes the transcript and runtime when setup fails before registration", async () => {
    const world = makeWorld({ failSnapshot: true });
    world.addParent("parent-1", []);

    await expect(world.delegate({ parentId: "parent-1", subagentType: "review" })).rejects.toThrow(
      "snapshot failed",
    );
    expect(world.registered).toEqual([]);
    expect(world.deleted).toEqual(["child-1"]);
    expect(world.closed()).toBe(1);
  });
});
