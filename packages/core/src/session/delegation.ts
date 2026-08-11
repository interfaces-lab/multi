// The delegation mechanism, whole: the pure rules — how a requested target
// resolves, what a result may cost the parent's context, what marks a linked
// session at birth — and the effectful runner that composes them over real
// linked sessions, the single-flight lock, and the task tool. `./service`
// constructs the runner with its session runtime through {@link
// DelegationDeps}. Catalog data lives in `./subagents`, fusion seating in
// `./fusion`.

import type {
  AgentHarnessTool,
  AgentHarnessOptions,
  JsonlSessionMetadata,
  JsonlSessionRepo,
  Session as PiSession,
  SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { AgentHarnessError, SessionError } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Effect, Option, Schema, Semaphore } from "effect";
import { type Static, Type } from "typebox";

import { Mcp } from "../mcp";
import { Models } from "../models";
import type { Workspace } from "../workspace";
import type { Phase, PiError, ThinkingLevel } from "./contract";
import { DelegationLink, SessionId } from "./contract";
import { fusionOf, type Pairing, type Stop } from "./fusion";
import type { Arm, Preset } from "./subagents";
import { delegationPrompt, SIDEKICK_PROMPT } from "./subagents";

/**
 * Runs one Pi operation, keeping Pi's typed failures and Pi's crashes apart.
 *
 * A rejection that is a Pi error class is an expected outcome — a busy
 * harness, steering while idle, a broken session read — and lands on the
 * error channel as itself. Anything else is a bug and stays a defect.
 *
 * Interruption is deliberately not wired to `harness.abort()`: a run belongs
 * to the session, not to the caller that happened to await it, and a client
 * that disconnects mid-prompt must never end work in progress (spec section
 * 10). Ending a run is its own command. Lives here because the runner and
 * `./service` land on the same harnesses; both import the one boundary.
 */
export const runPi = <A>(run: () => Promise<A>): Effect.Effect<A, PiError> =>
  Effect.promise(run).pipe(
    Effect.catchDefect((cause) =>
      cause instanceof AgentHarnessError || cause instanceof SessionError
        ? Effect.fail(cause)
        : Effect.die(cause),
    ),
  );

/** The one admission gate shared by commands, delegation, and deletion. */
export interface SessionLifecycle {
  closed: boolean;
  /** Pi promises started under admission and still touching this session. */
  activeRuns: number;
  readonly admission: Semaphore.Semaphore;
}

/** Tracks a started Pi promise until settlement without coupling it to its caller. */
export const trackPiRun = <A>(lifecycle: SessionLifecycle, run: () => Promise<A>): Promise<A> => {
  lifecycle.activeRuns += 1;
  let promise: Promise<A>;
  try {
    promise = run();
  } catch (error) {
    lifecycle.activeRuns -= 1;
    throw error;
  }
  const settled = (): void => {
    lifecycle.activeRuns -= 1;
  };
  void promise.then(settled, settled);
  return promise;
};

/** Runs one short session transaction while deletion is excluded. */
export const runAdmitted = <A, E, E2, R>(
  lifecycle: SessionLifecycle,
  onClosed: () => E2,
  run: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | E2, R> =>
  lifecycle.admission.withPermit(
    Effect.suspend(
      (): Effect.Effect<A, E | E2, R> => (lifecycle.closed ? Effect.fail(onClosed()) : run()),
    ),
  );

/**
 * Starts one Pi harness operation while deletion is excluded, then releases
 * the gate before awaiting the model. Closing flips `closed` before waiting
 * on the same permit, so a stale live-session reference cannot start work.
 */
export const runAdmittedPi = <A, E>(
  lifecycle: SessionLifecycle,
  onClosed: () => E,
  run: () => Promise<A>,
): Effect.Effect<A, E | PiError> =>
  Effect.gen(function* () {
    type Start =
      | { readonly _tag: "Started"; readonly promise: Promise<A> }
      | { readonly _tag: "Failed"; readonly error: unknown };
    const started = yield* runAdmitted(lifecycle, onClosed, () =>
      Effect.sync((): Start => {
        try {
          return { _tag: "Started", promise: trackPiRun(lifecycle, run) };
        } catch (error) {
          return { _tag: "Failed", error };
        }
      }),
    );
    return yield* runPi(() =>
      started._tag === "Started" ? started.promise : Promise.reject(started.error),
    );
  });

/** Who a resolved delegation runs: a catalog preset, or fusion's executor. */
export type Target =
  | { readonly kind: "preset"; readonly preset: Preset }
  | { readonly kind: "sidekick"; readonly arm: Arm };

export type Resolution =
  | { readonly target: Target; readonly coercedFrom?: string }
  | { readonly refusal: string };

/**
 * Resolves a requested `subagent_type` (spec/honk-built-ins.md section 9,
 * "Delegation rules").
 *
 * Rejection teaches: a single-model primary's unknown name fails with the
 * valid list, because the static tool description invites invented names
 * and the error is the documentation. Fusion coerces: the orchestrator
 * meant "delegate this" and the stop already decided to whom — the
 * coercion is reported, never silent, and never applies outside fusion.
 */
export const resolveTarget = (
  requested: string,
  context: { readonly pairing: Pairing | null; readonly available: readonly Preset[] },
): Resolution => {
  const preset = context.available.find((candidate) => candidate.name === requested);
  if (preset !== undefined) return { target: { kind: "preset", preset } };

  if (context.pairing !== null) {
    const target: Target = { kind: "sidekick", arm: context.pairing.sidekick };
    return requested === "sidekick" ? { target } : { target, coercedFrom: requested };
  }

  const names = context.available.map((candidate) => candidate.name).join(", ");
  return {
    refusal: `honk: unknown subagent_type "${requested}". Valid values: ${names}.`,
  };
};

/**
 * What a delegation may return into the parent's context. The full answer
 * always survives in the child's own transcript; the budget only bounds
 * what rides back inline. Failed delegations bypass the budget at the call
 * site — debugging is never blinded by the cap.
 */
export const RESULT_BUDGET = 24_000;

export const clipResult = (text: string): string =>
  text.length <= RESULT_BUDGET
    ? text
    : `${text.slice(0, RESULT_BUDGET)}\n\n[Truncated at ${String(RESULT_BUDGET)} characters — the delegation's full transcript remains in its session.]`;

/**
 * Reads a stored session's birth mark ({@link DelegationLink}, written into
 * Pi's create metadata), or nothing for a top-level chat.
 */
export const linkOf = (metadata: unknown): DelegationLink | null =>
  Option.getOrNull(Schema.decodeUnknownOption(DelegationLink)(metadata));

/**
 * The single-flight delegation lock and the persistent sidekick cache
 * (spec/honk-built-ins.md section 9). The lock mutates only inside the
 * runner's finalizer-guarded scope and in {@link releaseStaleLock}; the
 * cache is exactly that — a cache — and the durable truth is the linked
 * session's birth mark.
 */
export interface DelegationState {
  active: boolean;
  sidekick: SessionId | null;
}

/**
 * Frees a delegation lock the runner's finalizer failed to release — "the
 * next user message frees it explicitly" (spec section 9). Guarded on the
 * idle phase because an in-flight delegation rides a busy harness whose
 * prompt would be refused anyway; only a stale lock ever clears here.
 */
export const releaseStaleLock = (state: DelegationState, phase: Phase): void => {
  if (phase === "idle") state.active = false;
};

const taskSchema = Type.Object({
  subagent_type: Type.String({
    description: "Which subagent runs the task. The valid values are listed in your instructions.",
  }),
  prompt: Type.String({ description: "The complete, self-contained task for the subagent." }),
});
type TaskArgs = Static<typeof taskSchema>;

/**
 * What one delegation hands back: the text the model reads, and the linked
 * session it ran in when there was one.
 *
 * The id rides the tool result's `details` rather than its text, because it
 * is for the surface, not the model: without it two delegations to the same
 * role are indistinguishable, and a delegation row cannot name the child
 * transcript it should open. A refused delegation opened nothing and carries
 * no id.
 */
export interface DelegationResult {
  readonly text: string;
  readonly sessionId?: SessionId;
}

/**
 * The delegation tool. Static on purpose: the description never enumerates
 * targets — the session's system prompt does — so the tool list never
 * changes and the setTools recompute never fires for delegation. The abort
 * signal is the parent run's: it reaches the runner so aborting the parent
 * turn aborts the child harness instead of waiting out a child nobody
 * stopped.
 */
const makeTaskTool = (
  run: (args: TaskArgs, signal: AbortSignal | undefined) => Promise<DelegationResult>,
): AgentHarnessTool<{ readonly env: Workspace.ExecutionEnv }, typeof taskSchema> => ({
  name: "task",
  label: "Task",
  description:
    "Delegate a scoped task to a subagent. Valid subagent_type values are listed in your instructions.",
  parameters: taskSchema,
  execute: async (
    _toolCallId: string,
    params: TaskArgs,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _context: { readonly env: Workspace.ExecutionEnv },
  ) => {
    const result = await run(params, signal);
    return {
      content: [{ type: "text", text: result.text }],
      details: result.sessionId === undefined ? undefined : { sessionId: result.sessionId },
    };
  },
});
type TaskTool = AgentHarnessTool<{ readonly env: Workspace.ExecutionEnv }, typeof taskSchema>;

/**
 * How a harness's capabilities differ from the plain workspace default.
 * Provisioning, not permission (spec/honk-built-ins.md section 9): a
 * read-only subagent's harness is built with read-shaped tools, the task
 * tool exists only on primaries with resolvable targets, and a role prompt
 * is constructed in rather than appended by a hook that could miss a turn.
 */
export interface HarnessShape {
  readonly readOnly?: boolean;
  readonly task?: TaskTool;
  readonly mcp?: Mcp.ProxyTool;
  readonly systemPrompt?: string;
}

/** The text blocks of a subagent's final answer, joined. */
const assistantText = (message: AssistantMessage): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

/** Whether the exact provider route and model exist in Pi's catalog. */
const knownModel = (catalog: Models.ListOutput, ref: Models.ModelRef): boolean =>
  catalog.providers.some(
    (provider) =>
      provider.id === ref.providerId && provider.models.some((entry) => entry.id === ref.modelId),
  );

/**
 * The slice of the host's per-session runtime state the runner drives.
 * Structural on purpose: the service's live-session record satisfies it, and
 * the runner never learns about phase refs, event pubsubs, or snapshots.
 */
export interface DelegationSession {
  readonly session: PiSession;
  readonly harness: {
    prompt(text: string): Promise<AssistantMessage>;
    abort(): Promise<unknown>;
  };
  readonly binding: { workspace: Workspace.Info; env: Workspace.ExecutionEnv };
  readonly delegation: DelegationState;
  readonly lifecycle: SessionLifecycle;
}

interface LinkedSessionAcquisition<S> {
  readonly session: PiSession<JsonlSessionMetadata>;
  readonly metadata: JsonlSessionMetadata;
  readonly id: SessionId;
  opened: S | undefined;
  committed: boolean;
}

/** What the runner needs from the session service, and nothing else. */
export interface DelegationDeps<S extends DelegationSession> {
  readonly repo: JsonlSessionRepo;
  readonly models: Pick<Models.Interface, "list" | "resolve" | "resolveAvailable">;
  readonly presets: readonly Preset[];
  readonly pairings: Readonly<Record<Stop, Pairing>>;
  readonly mcp: Pick<Mcp.Interface, "run">;
  readonly liveOf: (sessionId: SessionId) => Effect.Effect<S | undefined>;
  /** Enters an opened linked session into the live map. */
  readonly register: (sessionId: SessionId, opened: S) => Effect.Effect<boolean>;
  readonly restore: (sessionId: SessionId) => Effect.Effect<S | undefined, unknown>;
  readonly makeLiveSession: (
    session: PiSession,
    binding: DelegationSession["binding"],
    model: AgentHarnessOptions["model"],
    thinkingLevel: ThinkingLevel,
    shape: HarnessShape,
    entrySeq: number,
  ) => Effect.Effect<S>;
  readonly closeLiveSession: (opened: S) => Effect.Effect<void>;
  readonly captureSnapshot: (
    sessionId: SessionId,
    found: S,
    entryId: string,
  ) => Effect.Effect<void>;
  readonly settleSnapshot: (sessionId: SessionId, found: S) => Effect.Effect<void, unknown>;
}

/**
 * Builds the delegation runtime over one session service's state.
 *
 * The service constructs it once per layer; the runner hands back the
 * capabilities the service wires into sessions — a primary's shape (task
 * tool and delegation prompt), a linked child's shape, and arm resolution
 * for fusion's create and restore checks.
 */
export const makeDelegationRunner = <S extends DelegationSession>(deps: DelegationDeps<S>) => {
  /** Resolves one exact, currently runnable arm. */
  const armModel = (ref: Models.ModelRef) => deps.models.resolveAvailable(ref);

  /**
   * The presets this host can actually run: arms routed against one read of
   * the live catalog. An unresolvable preset is absent, never broken.
   */
  const knownPresets = Effect.gen(function* () {
    const catalog = yield* deps.models.list({});
    return deps.presets.filter((preset) => knownModel(catalog, preset.arm.model));
  });

  /** A restored linked session gets its birth role's shape, never a primary's. */
  const childShapeFor = (role: string): HarnessShape => {
    if (role === "sidekick") return { systemPrompt: SIDEKICK_PROMPT };
    const preset = deps.presets.find((candidate) => candidate.name === role);
    return preset === undefined
      ? { readOnly: true }
      : { readOnly: true, systemPrompt: preset.prompt };
  };

  /**
   * Opens a delegation-owned session: a real, durable Pi session marked at
   * birth so the link survives any restart and no surface infers kind. The
   * same construction pipeline as every session — chosen tools and a role
   * prompt are the only differences. The child gets its own binding, fixed
   * to the parent's workspace as of this delegation: a live child must not
   * follow the parent's later `/cd`, because its restored self would not —
   * restore rebuilds a child's binding from the child's own transcript.
   */
  const makeLinkedSession = Effect.fnUntraced(function* (input: {
    readonly parentId: SessionId;
    readonly binding: DelegationSession["binding"];
    readonly arm: Arm;
    readonly role: string;
    readonly systemPrompt: string;
    readonly readOnly: boolean;
  }) {
    const model = yield* armModel(input.arm.model);
    const binding = { workspace: input.binding.workspace, env: input.binding.env };
    return yield* Effect.acquireUseRelease(
      Effect.gen(function* () {
        const session = yield* runPi(() =>
          deps.repo.create({
            cwd: binding.workspace.directory,
            metadata: { delegationOf: input.parentId, role: input.role },
          }),
        );
        const metadata = yield* runPi(() => session.getMetadata());
        const created: LinkedSessionAcquisition<S> = {
          session,
          metadata,
          id: SessionId.make(metadata.id),
          opened: undefined,
          committed: false,
        };
        return created;
      }),
      (created) =>
        Effect.gen(function* () {
          // Durable from birth, exactly as create records a top-level session.
          yield* runPi(() => created.session.appendModelChange(model.provider, model.id));
          yield* runPi(() => created.session.appendThinkingLevelChange(input.arm.thinkingLevel));
          const entrySeq = (yield* runPi(() => created.session.getEntries())).length;
          const liveSession = yield* deps.makeLiveSession(
            created.session,
            binding,
            model,
            input.arm.thinkingLevel,
            {
              readOnly: input.readOnly,
              systemPrompt: input.systemPrompt,
            },
            entrySeq,
          );
          created.opened = liveSession;
          yield* deps.captureSnapshot(created.id, liveSession, "base");

          // Registration and ownership transfer are one uninterruptible step:
          // cleanup must never delete a session the registry already owns.
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              if (!(yield* deps.register(created.id, liveSession))) {
                // The registry rejected and closed this runtime; only its
                // transcript remains ours to clean up.
                created.opened = undefined;
                return yield* Effect.die(new Error(`Session id collision: ${created.id}`));
              }
              created.committed = true;
            }),
          );
          return { id: created.id, opened: liveSession };
        }),
      (created) =>
        created.committed
          ? Effect.void
          : Effect.gen(function* () {
              if (created.opened !== undefined) yield* deps.closeLiveSession(created.opened);
              yield* runPi(() => deps.repo.delete(created.metadata)).pipe(Effect.ignore);
            }),
    );
  });

  /**
   * The persistent executor for one fusion session. Reuse resolves the
   * cache first, then the durable birth marks — a restart cannot orphan
   * the sidekick.
   */
  const sidekickSession = Effect.fnUntraced(function* (parentId: SessionId, found: S, arm: Arm) {
    const cached = found.delegation.sidekick;
    if (cached !== null) {
      const hit = yield* deps.liveOf(cached);
      if (hit !== undefined) return { id: cached, opened: hit };
    }
    const listed = yield* runPi(() => deps.repo.list());
    const stored = listed
      .filter((metadata) => {
        const link = linkOf(metadata.metadata);
        return link !== null && link.delegationOf === parentId && link.role === "sidekick";
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (stored !== undefined) {
      const id = SessionId.make(stored.id);
      const restored = yield* deps.restore(id);
      if (restored !== undefined) {
        found.delegation.sidekick = id;
        return { id, opened: restored };
      }
    }
    const made = yield* makeLinkedSession({
      parentId,
      binding: found.binding,
      arm,
      role: "sidekick",
      systemPrompt: SIDEKICK_PROMPT,
      readOnly: false,
    });
    found.delegation.sidekick = made.id;
    return made;
  });

  /**
   * The child's turn, with the parent's abort propagated: aborting the
   * parent turn aborts the child harness, so the parent's own abort — which
   * waits for its tools — never waits on a child nobody told to stop.
   */
  const runChildTurn = (
    opened: DelegationSession,
    prompt: string,
    signal: AbortSignal | undefined,
  ): Effect.Effect<AssistantMessage, PiError> =>
    runAdmittedPi(
      opened.lifecycle,
      () => new AgentHarnessError("invalid_state", "AgentHarness is closed"),
      () => {
        const { harness } = opened;
        const run = harness.prompt(prompt);
        if (signal !== undefined) {
          const onAbort = () => void harness.abort().catch(() => undefined);
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
            void run
              .finally(() => signal.removeEventListener("abort", onAbort))
              .catch(() => undefined);
          }
        }
        return run;
      },
    );

  /**
   * Runs one delegation to settlement and returns the tool result: the text
   * the model reads, and the child session it ran in.
   *
   * Never fails: every outcome — refusal, busy, child error — is text the
   * model can act on, so the task tool needs no error channel and the
   * single-flight lock releases structurally around the whole run.
   */
  const runDelegation = Effect.fn("Session.delegate")(function* (input: {
    readonly parentId: SessionId;
    readonly subagentType: string;
    readonly prompt: string;
    readonly signal: AbortSignal | undefined;
  }) {
    const found = yield* deps.liveOf(input.parentId);
    if (found === undefined || found.lifecycle.closed) {
      return { text: "honk: the delegating session is no longer open." };
    }
    const entries = yield* runPi(() => found.session.getEntries()).pipe(
      Effect.orElseSucceed((): readonly SessionTreeEntry[] => []),
    );
    const available = yield* knownPresets;
    const stop = fusionOf(entries);
    const resolution = resolveTarget(input.subagentType, {
      pairing: stop === null ? null : deps.pairings[stop],
      available,
    });
    if ("refusal" in resolution) return { text: resolution.refusal };
    if (found.delegation.active) {
      return {
        text: "honk: a delegation is already in flight for this session; wait for it to finish.",
      };
    }
    found.delegation.active = true;
    const target = resolution.target;
    return yield* Effect.gen(function* () {
      const child =
        target.kind === "sidekick"
          ? yield* sidekickSession(input.parentId, found, target.arm)
          : yield* makeLinkedSession({
              parentId: input.parentId,
              binding: found.binding,
              arm: target.preset.arm,
              role: target.preset.name,
              systemPrompt: target.preset.prompt,
              readOnly: true,
            });
      const answer = yield* runChildTurn(child.opened, input.prompt, input.signal);
      // An aborted or errored child still wrote whatever it wrote first.
      yield* deps.settleSnapshot(child.id, child.opened).pipe(Effect.ignore);
      // The child's id rides every outcome that opened one, failures
      // included: a delegation row links to the transcript that explains it.
      if (answer.stopReason === "error" || answer.stopReason === "aborted") {
        // A run that did not finish is a failed delegation, never a
        // success-looking clipped answer.
        return {
          text: `honk: delegation failed — ${answer.errorMessage ?? `the subagent run ${answer.stopReason}`}`,
          sessionId: child.id,
        };
      }
      const result = clipResult(assistantText(answer));
      // Coercion is loud (spec/honk-built-ins.md section 9): the result
      // names the substitution so the orchestrator learns the catalog.
      return {
        text:
          resolution.coercedFrom === undefined
            ? result
            : `honk: delegated to the paired sidekick (subagent_type "${resolution.coercedFrom}" is not a preset).\n\n${result}`,
        sessionId: child.id,
      };
    }).pipe(
      // Failures return inline and unbudgeted — debugging is never
      // blinded by the result cap. A failure here broke before or around
      // the child, so there is no id to hand back.
      Effect.catch((error) =>
        Effect.succeed({
          text: `honk: delegation failed — ${error instanceof Error ? error.message : String(error)}`,
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          found.delegation.active = false;
        }),
      ),
    );
  });

  /**
   * The static MCP proxy tool for one session. It resolves its workspace
   * through the live binding at call time, so `/cd` moves it with the
   * session, and it never rejects — the runner turns every failure into
   * text the model can act on.
   */
  const mcpToolFor = (sessionId: SessionId): Mcp.ProxyTool =>
    Mcp.makeProxyTool((params, signal) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const found = yield* deps.liveOf(sessionId);
          if (found === undefined) return "honk: this session is no longer open.";
          return yield* deps.mcp.run({
            workspaceId: found.binding.workspace.id,
            params,
            ...(signal === undefined ? {} : { signal }),
          });
        }),
      ),
    );

  /**
   * A primary's capabilities: the task tool and the delegation prompt,
   * present exactly when there is something to delegate to. A session
   * with no resolvable targets gets neither — capabilities appear as the
   * catalog resolves them, not as dead chrome for the model.
   */
  const primaryShape = Effect.fnUntraced(function* (sessionId: SessionId, stop: Stop | null) {
    const available = yield* knownPresets;
    if (available.length === 0 && stop === null) {
      return { mcp: mcpToolFor(sessionId) } satisfies HarnessShape;
    }
    if (stop !== null) {
      const pairing = deps.pairings[stop];
      // Restoration needs catalog identity, not a current credential: logout
      // must not make an existing Fusion transcript unreadable. But an arm
      // removed from the catalog is no longer the machine that transcript
      // names, so never restore it as a task-capable approximation.
      yield* deps.models.resolve(pairing.main.model);
      yield* deps.models.resolve(pairing.sidekick.model);
    }
    return {
      mcp: mcpToolFor(sessionId),
      task: makeTaskTool((args, signal) =>
        Effect.runPromise(
          runDelegation({
            parentId: sessionId,
            subagentType: args.subagent_type,
            prompt: args.prompt,
            signal,
          }),
        ),
      ),
      systemPrompt: delegationPrompt(available, stop !== null),
    } satisfies HarnessShape;
  });

  return { armModel, childShapeFor, primaryShape, runDelegation };
};
