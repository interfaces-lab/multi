/**
 * The private live runtime around one persisted Pi session.
 *
 * Pi owns the agent loop and transcript. This module only binds Pi's harness
 * to a trusted workspace, arms its resources, and folds harness events into
 * the host state needed by commands and streams.
 */

import type {
  AgentHarnessEvent,
  AgentHarnessOptions,
  AgentHarnessResources,
  QueueUpdateEvent,
  Session as PiSession,
  SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { AgentHarness, SessionError } from "@earendil-works/pi-agent-core";
import type { Models as PiModels } from "@earendil-works/pi-ai";
import { Effect, PubSub, Ref, Schema, Semaphore, SubscriptionRef } from "effect";

import type { Models } from "../models";
import type { Resources } from "../resources";
import { Tools } from "../tools";
import { Websearch } from "../websearch";
import { Workspace } from "../workspace";
import type { Phase, SessionId, ThinkingLevel } from "./contract";
import type { DelegationState, HarnessShape, SessionLifecycle } from "./delegation";
import { runPi } from "./delegation";
import { modelOf, thinkingLevelOf } from "./attribution";

interface ActiveBranchReader {
  readonly getEntries: () => Promise<SessionTreeEntry[]>;
  readonly getLeafId: () => Promise<string | null>;
  readonly getBranch: (fromId?: string) => Promise<SessionTreeEntry[]>;
}

/** Reads an active branch and an append-log cursor that cannot skip its entries. */
export async function readStableBranch(
  session: ActiveBranchReader,
): Promise<{ readonly entries: SessionTreeEntry[]; readonly entrySeq: number }> {
  for (;;) {
    const beforeLeaf = await session.getLeafId();
    const before = await session.getEntries();
    // An explicit leaf makes the branch read independent of a concurrent
    // navigation. `null` is the empty tree; passing `undefined` there would
    // ask Pi to reread whichever leaf became active in the meantime.
    const entries = beforeLeaf === null ? [] : await session.getBranch(beforeLeaf);
    const after = await session.getEntries();
    const afterLeaf = await session.getLeafId();
    if (before.length === after.length && beforeLeaf === afterLeaf) {
      return { entries, entrySeq: after.length };
    }
  }
}

/** Which trusted workspace this session runs in right now. */
export interface SessionBinding {
  workspace: Workspace.Info;
  env: Workspace.ExecutionEnv;
}

/** One captured checkpoint and the workspace repository that owns it. */
export interface Snapshot {
  readonly entryId: string;
  readonly workspaceId: Workspace.WorkspaceId;
}

const createWorkspaceHarness = (input: {
  readonly session: PiSession;
  readonly models: PiModels;
  readonly model: AgentHarnessOptions["model"];
  readonly thinkingLevel: AgentHarnessOptions["thinkingLevel"];
  readonly binding: SessionBinding;
  readonly shape: HarnessShape;
}): AgentHarness<{ readonly env: Workspace.ExecutionEnv }> => {
  const builtins = Tools.builtins();
  const executionTools =
    input.shape.readOnly === true
      ? builtins.filter((tool) => Tools.writesOf(tool.name, {}).kind === "none")
      : [...builtins];
  return new AgentHarness({
    session: input.session,
    models: input.models,
    model: input.model,
    ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
    ...(input.shape.systemPrompt === undefined ? {} : { systemPrompt: input.shape.systemPrompt }),
    tools: [
      ...executionTools,
      Websearch.makeWebsearchTool(),
      ...(input.shape.mcp === undefined ? [] : [input.shape.mcp]),
      ...(input.shape.task === undefined ? [] : [input.shape.task]),
    ],
    // Resolve at each turn snapshot: `/cd` changes the next turn without
    // changing the workspace under a run already in progress.
    toolContext: () => ({ env: input.binding.env }),
  });
};

export type WorkspaceHarness = AgentHarness<{ readonly env: Workspace.ExecutionEnv }>;

/** Host-only state for one open Pi session. Never serialized or exposed. */
export interface SessionRegistryEntry {
  readonly lifecycle: SessionLifecycle;
}

/** The ownership surface required to close a live session. */
export interface LiveSessionOwnership extends SessionRegistryEntry {
  readonly harness: { abort(): Promise<unknown> };
  readonly unsubscribe: () => void;
  readonly events: PubSub.PubSub<AgentHarnessEvent>;
}

export interface LiveSession extends LiveSessionOwnership {
  readonly session: PiSession;
  readonly harness: WorkspaceHarness;
  readonly origin: SessionBinding;
  readonly binding: SessionBinding;
  readonly snapshots: Snapshot[];
  entrySeq: number;
  readonly phase: SubscriptionRef.SubscriptionRef<Phase>;
  readonly queue: { last: QueueUpdateEvent | undefined };
  readonly delegation: DelegationState;
}

/** The live harness values that must move together with a selected branch. */
export interface LiveRuntime {
  readonly binding: SessionBinding;
  readonly model: AgentHarnessOptions["model"];
  readonly thinkingLevel: ThinkingLevel;
  readonly resources: AgentHarnessResources;
}

/** Captures the exact live values so a failed navigation can put them back. */
export const liveRuntimeOf = (live: LiveSession): LiveRuntime => ({
  binding: { workspace: live.binding.workspace, env: live.binding.env },
  model: live.harness.getModel(),
  thinkingLevel: live.harness.getThinkingLevel(),
  resources: live.harness.getResources(),
});

/** Rebinds Pi's public harness state to the branch that is now active. */
export const applyLiveRuntime = (live: LiveSession, runtime: LiveRuntime) =>
  runPi(async () => {
    const currentModel = live.harness.getModel();
    if (currentModel.provider !== runtime.model.provider || currentModel.id !== runtime.model.id) {
      await live.harness.setModel(runtime.model);
    }
    if (live.harness.getThinkingLevel() !== runtime.thinkingLevel) {
      await live.harness.setThinkingLevel(runtime.thinkingLevel);
    }
    await live.harness.setResources(runtime.resources);
    if (live.binding.workspace.id !== runtime.binding.workspace.id) {
      live.binding.workspace = runtime.binding.workspace;
      live.binding.env = runtime.binding.env;
    }
  });

const WorkspaceChangeData = Schema.Struct({ workspaceId: Workspace.WorkspaceId });

/** Walks `/cd` records once, attributing each entry and returning the last workspace. */
export const workspaceTrail = Effect.fnUntraced(function* (
  workspaces: Workspace.Interface,
  entries: readonly SessionTreeEntry[],
  origin: Workspace.Info,
) {
  const attributed: Snapshot[] = [{ entryId: "base", workspaceId: origin.id }];
  let workspace = origin;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "honk.workspace_change") {
      const decoded = yield* Schema.decodeUnknownEffect(WorkspaceChangeData)(entry.data).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      if (decoded !== undefined) {
        const target = yield* workspaces
          .find({ workspaceId: decoded.workspaceId })
          .pipe(Effect.orElseSucceed(() => undefined));
        if (target !== undefined) workspace = target;
      }
    }
    attributed.push({ entryId: entry.id, workspaceId: workspace.id });
  }
  return { attributed, workspace };
});

/** Resolves the persisted branch into the complete live harness state it owns. */
export const runtimeForBranch = Effect.fnUntraced(function* (input: {
  readonly live: LiveSession;
  readonly entries: readonly SessionTreeEntry[];
  readonly workspaces: Workspace.Interface;
  readonly models: Models.Interface;
  readonly resources: Resources.Interface;
}) {
  const recordedModel = modelOf(input.entries);
  if (recordedModel === undefined) {
    return yield* Effect.fail(
      new SessionError("invalid_session", "Honk session has no recorded model"),
    );
  }
  const model = yield* input.models.resolve(recordedModel);
  const { workspace } = yield* workspaceTrail(
    input.workspaces,
    input.entries,
    input.live.origin.workspace,
  );
  const env =
    workspace.id === input.live.origin.workspace.id
      ? input.live.origin.env
      : workspace.id === input.live.binding.workspace.id
        ? input.live.binding.env
        : yield* input.workspaces.env({ workspaceId: workspace.id }).pipe(Effect.orDie);
  const binding = { workspace, env };
  return {
    binding,
    model,
    thinkingLevel: thinkingLevelOf(input.entries) ?? "off",
    resources: yield* loadResources(input.resources, binding),
  } satisfies LiveRuntime;
});

/** Detaches host listeners and settles one live Pi harness. Safe during teardown. */
export const closeLiveSession = Effect.fnUntraced(function* (session: LiveSessionOwnership) {
  session.lifecycle.closed = true;
  yield* session.lifecycle.admission.withPermit(Effect.void);
  yield* Effect.sync(session.unsubscribe).pipe(Effect.ignore);
  yield* PubSub.shutdown(session.events);
  yield* Effect.tryPromise(() => session.harness.abort()).pipe(Effect.ignore);
});

/** A session registry parameterized by the ownership cleanup its entries require. */
export const makeSessionRegistry = <S extends SessionRegistryEntry>(
  close: (opened: S) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const sessions = yield* Ref.make<ReadonlyMap<SessionId, S>>(new Map());
    const deleted = new Set<SessionId>();
    type RegistryChange = readonly [S | undefined, ReadonlyMap<SessionId, S>];

    const register = Effect.fnUntraced(function* (sessionId: SessionId, opened: S) {
      const entered = yield* Ref.modify(sessions, (map): RegistryChange => {
        if (deleted.has(sessionId)) return [undefined, map];
        const raced = map.get(sessionId);
        if (raced !== undefined) return [raced, map];
        return [opened, new Map(map).set(sessionId, opened)];
      });
      if (entered !== opened) yield* close(opened);
      return entered;
    });

    const remove = (sessionId: SessionId) =>
      Ref.modify(sessions, (map): RegistryChange => {
        deleted.add(sessionId);
        const opened = map.get(sessionId);
        if (opened !== undefined) opened.lifecycle.closed = true;
        const next = new Map(map);
        next.delete(sessionId);
        return [opened, next];
      });

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const opened = [...(yield* Ref.get(sessions)).values()];
        yield* Ref.set(sessions, new Map());
        yield* Effect.forEach(opened, close, {
          concurrency: "unbounded",
          discard: true,
        });
      }),
    );

    return {
      get: (sessionId: SessionId) => Effect.map(Ref.get(sessions), (map) => map.get(sessionId)),
      snapshot: Ref.get(sessions),
      deleted: (sessionId: SessionId) => deleted.has(sessionId),
      register,
      remove,
    };
  });

/** The live-session registry: atomic restore races, deletion tombstones, and teardown. */
export const makeLiveSessionRegistry = makeSessionRegistry<LiveSession>(closeLiveSession);

/** Loads the resources belonging to one workspace. */
export const loadResources = Effect.fnUntraced(function* (
  resources: Resources.Interface,
  binding: SessionBinding,
) {
  const loaded = yield* resources
    .load({ workspaceId: binding.workspace.id })
    .pipe(Effect.orElseSucceed(() => ({ skills: [], promptTemplates: [] })));
  return {
    skills: [...loaded.skills],
    promptTemplates: [...loaded.promptTemplates],
  };
});

/** Opens one Pi harness and folds its transient events into host runtime state. */
export const openLiveSession = Effect.fnUntraced(function* (input: {
  readonly session: PiSession;
  readonly origin: SessionBinding;
  readonly binding: SessionBinding;
  readonly snapshots: Snapshot[];
  readonly entrySeq: number;
  readonly model: AgentHarnessOptions["model"];
  readonly thinkingLevel: AgentHarnessOptions["thinkingLevel"];
  readonly shape: HarnessShape;
  readonly models: Models.Interface;
  readonly resources: Resources.Interface;
  readonly inventoryChanged: PubSub.PubSub<void>;
}) {
  const harness = createWorkspaceHarness({
    session: input.session,
    models: input.models.collection,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    binding: input.binding,
    shape: input.shape,
  });

  // A resource scan must not make an otherwise valid conversation
  // unrestorable. Pi-level harness failures still surface on explicit `/cd`.
  const loaded = yield* loadResources(input.resources, input.binding);
  yield* runPi(() => harness.setResources(loaded)).pipe(Effect.ignore);

  const events = yield* PubSub.unbounded<AgentHarnessEvent>();
  const phase = yield* SubscriptionRef.make<Phase>("idle");
  const queue: LiveSession["queue"] = { last: undefined };

  // Pi's `settled` event follows pending transcript writes, so `idle` means
  // durable. The last complete queue frame repairs subscribers that attach
  // after Pi's most recent queue update.
  const unsubscribe = harness.subscribe((event) => {
    if (event.type === "agent_start") {
      Effect.runSync(SubscriptionRef.set(phase, "turn"));
      PubSub.publishUnsafe(input.inventoryChanged, undefined);
    }
    if (event.type === "queue_update") queue.last = event;
    if (event.type === "settled") {
      Effect.runSync(SubscriptionRef.set(phase, "idle"));
      PubSub.publishUnsafe(input.inventoryChanged, undefined);
      queue.last = undefined;
    }
    PubSub.publishUnsafe(events, event);
  });

  return {
    session: input.session,
    harness,
    unsubscribe,
    events,
    phase,
    origin: input.origin,
    binding: input.binding,
    snapshots: input.snapshots,
    entrySeq: input.entrySeq,
    queue,
    delegation: { active: false, sidekick: null },
    lifecycle: { closed: false, activeRuns: 0, admission: Semaphore.makeUnsafe(1) },
  } satisfies LiveSession;
});
