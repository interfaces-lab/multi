/**
 * The client surface of Honk Core: everything a renderer needs to talk to a
 * running host, and nothing a host needs to run.
 *
 * This module imports only contract modules — schemas, typed errors, and
 * command catalogs — so a browser bundle that starts here never reaches a
 * Node builtin. The host graph (services, the MCP process manager, the
 * writer lease) lives behind `./honk-core`, exported as `@honk/core/host`.
 *
 * Two ways to obtain a {@link HonkClient}:
 *
 * - {@link createHonkClient} attaches to a host in another process, over HTTP.
 * - `createHonkCore(...).client()` from `@honk/core/host` attaches in
 *   process; it builds the same facade through the shared {@link makeSdk}.
 *
 * @example
 * ```ts
 * import { createHonkClient } from "@honk/core";
 *
 * const sdk = await createHonkClient(connection);
 *
 * const opened = await sdk.workspace.open({ directory });
 * if (opened.type === "trust_required") {
 *   await sdk.workspace.trust({ directory: opened.directory });
 * }
 *
 * const workspace = await sdk.workspace.open({ directory });
 * if (workspace.type !== "ready") return;
 *
 * const session = await sdk.session.create({ workspaceId: workspace.id });
 * await sdk.session.prompt({ sessionId: session.id, text: "Explain the auth flow" });
 *
 * const state = await sdk.session.reload({ sessionId: session.id });
 * render(state.entries);
 * ```
 *
 * @see spec/core.md section 6 for the construction contract this module implements.
 * @module
 */

import { Effect, Layer, ManagedRuntime, Option, Schema, Scope, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { Commands as CommandCatalog } from "./commands/contract";
import { Files } from "./files";
import { Git } from "./git";
import { Mcp } from "./mcp/contract";
import { Models } from "./models";
import { Session } from "./session/contract";
import { Skills } from "./skills/contract";
import { Workspace } from "./workspace";

/** Versioned wire fingerprint. A Pi pin change is a Core protocol change. */
export const HONK_CORE_PROTOCOL = Object.freeze({
  core: 1,
  pi: "0.83.0",
});

const HonkCoreHandshake = Schema.Struct({
  core: Schema.Literal(HONK_CORE_PROTOCOL.core),
  pi: Schema.Literal(HONK_CORE_PROTOCOL.pi),
});
const decodeHonkCoreHandshake = Schema.decodeUnknownOption(HonkCoreHandshake);

export class HonkClientConnectionError extends Error {
  constructor(
    readonly reason: "unauthorized" | "invalid_handshake" | "protocol_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "HonkClientConnectionError";
  }
}

// Pi and Honk error classes are re-exported here so an application narrows
// every SDK rejection from one import without depending on AgentHarness
// (spec/core.md section 6). The Pi classes are the real ones: a rejected
// sdk.session call carries the same instance Pi threw.
export { AgentHarnessError, SessionError } from "./pi-errors";
// Tools ships the write-attribution classifier (`Tools.writesOf`) so surfaces
// share one read-shaped/write-shaped split with the checkpoint gate instead
// of keeping a second tool list.
export { Tools } from "./tool-writes";
// `Commands` is reserved by React Native's native-component codegen transform, even in ordinary
// TypeScript modules. The domain remains available as `@honk/core/commands`; this non-reserved
// alias keeps the root convenience export bundle-safe for native clients.
export { CommandCatalog, Files, Git, Mcp, Models, Session, Skills, Workspace };

/**
 * The complete Honk command catalog: one RPC group covering every namespace.
 *
 * Hosts serve this group and clients derive from it, so the wire contract has
 * exactly one owner. Merging happens here rather than in a host package so a
 * desktop, web, or test host cannot assemble a different catalog.
 *
 * @category catalog
 */
export const Rpcs = Workspace.Rpcs.merge(
  Session.Rpcs,
  Files.Rpcs,
  Git.Rpcs,
  Models.Rpcs,
  Mcp.Rpcs,
  Skills.Rpcs,
  CommandCatalog.Rpcs,
);

/**
 * A request/response SDK method derived from its RPC definition.
 *
 * The client repeats no payload, result, or error type: `Call` reads the
 * payload and success types straight off the `Rpc`, so a schema change in
 * `session` or `workspace` reaches the public API with no edit here.
 *
 * The returned promise fulfills with the success value or rejects with the
 * owning domain's error instance. Effect's `runPromise` squashes the failure
 * cause, so `catch` receives the real `Workspace.OpenError` or
 * `Session.NotFoundError` — not a wrapper to unpack.
 *
 * @example
 * ```ts
 * try {
 *   await sdk.session.reload({ sessionId });
 * } catch (error: unknown) {
 *   if (error instanceof Session.NotFoundError) forgetSession(sessionId);
 *   else throw error;
 * }
 * ```
 *
 * @category types
 */
export type Call<Method> = Method extends (
  input: infer Input,
) => Effect.Effect<infer Success, infer _Failure, infer _Requirements>
  ? (input: Input) => Promise<Success>
  : never;

/**
 * A streaming SDK method derived from its RPC definition.
 *
 * Streams reach Promise-world callers as an `AsyncIterable`, so `for await`
 * consumes them and `break` or `return` detaches. Detaching closes only this
 * subscription; the run continues and other clients keep receiving events.
 *
 * @example
 * ```ts
 * for await (const frame of sdk.session.events({ sessionId })) {
 *   if (frame.type === "live") await reloadAuthoritative();
 *   else applyEvent(frame.event);
 * }
 * ```
 *
 * @category types
 */
export type Subscribe<Method> = Method extends (
  input: infer Input,
) => Effect.Effect<
  Stream.Stream<infer Success, infer _StreamFailure, infer _StreamRequirements>,
  infer _Failure,
  infer _Requirements
>
  ? (input: Input) => AsyncIterable<Success>
  : Method extends (
        input: infer Input,
      ) => Stream.Stream<infer Success, infer _Failure, infer _Requirements>
    ? (input: Input) => AsyncIterable<Success>
    : never;

/**
 * One SDK namespace, derived from a domain's `commands` record: one
 * {@link Call} per command. The namespaces below repeat no method lists — a
 * command added to a domain's record appears here with no edit.
 *
 * @category types
 */
export type NamespaceOf<Service> = {
  readonly [K in keyof Service as Service[K] extends (
    input: infer _Input,
  ) => Effect.Effect<infer _Success, infer _Failure, infer _Requirements>
    ? K
    : never]: Call<Service[K]>;
};

/**
 * One interface attached to a running core.
 *
 * Namespaces group calls; they do not hide execution. Every method takes one
 * object argument so the SDK can add optional fields without positional
 * overloads, and every returned value is plain data that can live in
 * application state or cross a worker boundary.
 *
 * A client owns its connection, its subscriptions, and its disposable reload
 * buffer. The core owns sessions, harnesses, storage, and the writer lease.
 *
 * @category client
 */
export interface HonkClient {
  /**
   * Workspace trust: the only permission gate in Honk.
   *
   * `open` answers `trust_required` for a directory the user has not trusted,
   * which is a product state and not a failure. It must not read
   * workspace-controlled configuration or create a harness before that check.
   */
  readonly workspace: NamespaceOf<Omit<Workspace.Interface, "find" | "env" | "locate">>;

  /**
   * Session lifecycle and run control, each call landing on the real Pi
   * `AgentHarness` for that session.
   *
   * `reload` is the authoritative read: idempotent, safe while a run is
   * active, and independent of which clients are attached. `events` is the
   * temporary notification channel that lets an attached interface update
   * without reloading after every change.
   */
  readonly session: NamespaceOf<Omit<Session.Interface, "events" | "watchInventory">> & {
    readonly events: (input: {
      readonly sessionId: Session.SessionId;
    }) => AsyncIterable<Session.EventsFrame>;

    /**
     * The cross-session inventory as a stream: each frame is the full
     * `session.list` output, re-read when a session is created, deleted,
     * restored, or changes phase. A home screen renders every frame whole.
     */
    readonly watchInventory: (
      input: Readonly<Record<string, never>>,
    ) => AsyncIterable<Session.ListOutput>;

    /**
     * The read-to-live handoff, packaged (spec section 9): subscribe, then
     * one authoritative read, then advisory events with a repair read at
     * each commit point — serialized, so reads never overlap. A surface
     * renders `state` frames as truth and `event` frames as liveness, and
     * reimplements no timing rules of its own.
     */
    readonly watch: (input: {
      readonly sessionId: Session.SessionId;
    }) => AsyncIterable<SessionWatchFrame>;
  };

  /**
   * Reading and writing inside a trusted workspace.
   *
   * Every path is workspace-relative in both directions, and one that escapes
   * the workspace directory fails rather than resolving. No absolute host path
   * reaches a client.
   */
  readonly files: NamespaceOf<Files.Interface>;

  /**
   * Version control for a trusted workspace.
   *
   * Workspace-scoped by nature: `status` and `diff` answer "what changed in
   * this checkout", which is a different question from
   * {@link HonkClient.session.changes}'s "what did this conversation change".
   * A review surface intersects the two.
   *
   * Checkpoints are the snapshot primitive under per-turn changes: hidden
   * whole-workspace commits the session layer captures on every settled turn,
   * diffs to answer "what did *this* turn do", and restores to revert to one.
   */
  readonly git: NamespaceOf<Git.Interface>;

  /**
   * The provider catalog and the credentials that unlock it.
   *
   * `list` is the settings read: every provider with its auth status and
   * models, configured or not. `setCredential` stores an API key;
   * `deleteCredential` is logout, OAuth included. Which model a session runs
   * on is chosen at {@link HonkClient.session.create} and recorded in the
   * transcript.
   */
  /**
   * MCP server definitions and process lifetime for a trusted workspace.
   *
   * Configuration comes from the standard files; Honk-owned changes write an
   * override file per workspace and never rewrite the shared ones. Servers
   * are lazy — `connect` overrides that explicitly and resolves only after
   * the server is connected. The tools themselves stay behind the one `mcp`
   * proxy tool and never appear in this namespace.
   */
  readonly mcp: NamespaceOf<Omit<Mcp.Interface, "run">>;

  /**
   * The skills a trusted workspace defines, for a composer's `/` menu.
   *
   * Listing only. A skill runs through
   * {@link HonkClient.session.runSkill}, because running one is a turn in a
   * conversation and turns belong to `sdk.session` — the same split
   * `session.runGitAction` makes against `sdk.git`.
   */
  readonly skills: NamespaceOf<Skills.Interface>;

  /**
   * The prompt-template commands a trusted workspace defines.
   *
   * Same split as {@link HonkClient.skills}: this namespace lists them, and
   * {@link HonkClient.session.runCommand} runs one.
   */
  readonly commands: NamespaceOf<CommandCatalog.Interface>;

  readonly models: NamespaceOf<
    Omit<Models.Interface, "collection" | "resolve" | "resolveAvailable" | "login">
  > & {
    /**
     * The interactive OAuth relay: subscribe, render each frame, answer
     * `prompt` frames through `answerLogin`, and treat the closing `done`
     * frame as the stored credential. Ending the stream cancels the flow.
     */
    readonly login: Subscribe<Models.Interface["login"]>;
  };

  /**
   * Detaches this interface.
   *
   * Closing a client ends its subscriptions and releases its resources. It
   * does not close the core and does not stop an active run: a browser
   * refresh or a lost phone connection must never end work in progress.
   */
  readonly close: () => Promise<void>;
}

type SnakeCase<Name extends string> = Name extends `${infer Head}${infer Tail}`
  ? `${Head extends Lowercase<Head> ? "" : "_"}${Lowercase<Head>}${SnakeCase<Tail>}`
  : "";

type RpcEffect<Method> = Method extends (input: infer Input) => Promise<infer Success>
  ? (input: Input) => Effect.Effect<Success, unknown>
  : Method extends (input: infer Input) => AsyncIterable<infer Success>
    ? (input: Input) => Stream.Stream<Success, unknown>
    : never;

type RpcCalls<Prefix extends string, Namespace> = {
  readonly [Key in keyof Namespace as Key extends string
    ? `${Prefix}.${SnakeCase<Key>}`
    : never]: RpcEffect<Namespace[Key]>;
};

type HonkRpcClient = RpcCalls<"workspace", HonkClient["workspace"]> &
  RpcCalls<"session", Omit<HonkClient["session"], "watch">> &
  RpcCalls<"files", HonkClient["files"]> &
  RpcCalls<"git", HonkClient["git"]> &
  RpcCalls<"mcp", HonkClient["mcp"]> &
  RpcCalls<"skills", HonkClient["skills"]> &
  RpcCalls<"commands", HonkClient["commands"]> &
  RpcCalls<"models", HonkClient["models"]>;

/**
 * Builds the namespace facade over a flat RPC client.
 *
 * Written once and shared by `createHonkCore` (in `@honk/core/host`) and
 * {@link createHonkClient}: the two constructors differ only in transport and
 * `close`, so the method wiring must not exist twice. Method types derive from
 * the {@link Rpcs} definitions through {@link NamespaceOf}, so a missing or
 * misbound method is a type error, not a runtime surprise.
 *
 * `run` executes one request/response effect; `iterate` turns a stream into
 * the caller's `AsyncIterable`. Both close over the constructor's runtime.
 */
export const makeSdk = (
  rpc: HonkRpcClient,
  run: <A, EX>(effect: Effect.Effect<A, EX>) => Promise<A>,
  iterate: <A, EX>(stream: Stream.Stream<A, EX>) => AsyncIterable<A>,
): Omit<HonkClient, "close"> => {
  const session = {
    create: (input) => run(rpc["session.create"](input)),
    prompt: (input) => run(rpc["session.prompt"](input)),
    editMessage: (input) => run(rpc["session.edit_message"](input)),
    steer: (input) => run(rpc["session.steer"](input)),
    followUp: (input) => run(rpc["session.follow_up"](input)),
    runGitAction: (input) => run(rpc["session.run_git_action"](input)),
    runSkill: (input) => run(rpc["session.run_skill"](input)),
    runCommand: (input) => run(rpc["session.run_command"](input)),
    abort: (input) => run(rpc["session.abort"](input)),
    reload: (input) => run(rpc["session.reload"](input)),
    changes: (input) => run(rpc["session.changes"](input)),
    setWorkspace: (input) => run(rpc["session.set_workspace"](input)),
    setThinkingLevel: (input) => run(rpc["session.set_thinking_level"](input)),
    setModel: (input) => run(rpc["session.set_model"](input)),
    revert: (input) => run(rpc["session.revert"](input)),
    list: (input) => run(rpc["session.list"](input)),
    get: (input) => run(rpc["session.get"](input)),
    delete: (input) => run(rpc["session.delete"](input)),
    events: (input) => iterate(rpc["session.events"](input)),
    watchInventory: (input) => iterate(rpc["session.watch_inventory"](input)),
  } satisfies Omit<HonkClient["session"], "watch">;

  return {
    workspace: {
      open: (input) => run(rpc["workspace.open"](input)),
      trust: (input) => run(rpc["workspace.trust"](input)),
    },
    session: { ...session, watch: (input) => watchSession(session, input) },
    files: {
      find: (input) => run(rpc["files.find"](input)),
      list: (input) => run(rpc["files.list"](input)),
      read: (input) => run(rpc["files.read"](input)),
      write: (input) => run(rpc["files.write"](input)),
      delete: (input) => run(rpc["files.delete"](input)),
      createDirectory: (input) => run(rpc["files.create_directory"](input)),
      rename: (input) => run(rpc["files.rename"](input)),
    },
    git: {
      status: (input) => run(rpc["git.status"](input)),
      diff: (input) => run(rpc["git.diff"](input)),
      filePatch: (input) => run(rpc["git.file_patch"](input)),
      fileImage: (input) => run(rpc["git.file_image"](input)),
      fileContent: (input) => run(rpc["git.file_content"](input)),
      branches: (input) => run(rpc["git.branches"](input)),
      checkout: (input) => run(rpc["git.checkout"](input)),
      pull: (input) => run(rpc["git.pull"](input)),
      discard: (input) => run(rpc["git.discard"](input)),
      captureCheckpoint: (input) => run(rpc["git.capture_checkpoint"](input)),
      checkpoints: (input) => run(rpc["git.checkpoints"](input)),
      checkpointChanges: (input) => run(rpc["git.checkpoint_changes"](input)),
      checkpointDiff: (input) => run(rpc["git.checkpoint_diff"](input)),
      restoreCheckpoint: (input) => run(rpc["git.restore_checkpoint"](input)),
      restoreFiles: (input) => run(rpc["git.restore_files"](input)),
      deleteCheckpoints: (input) => run(rpc["git.delete_checkpoints"](input)),
    },
    mcp: {
      list: (input) => run(rpc["mcp.list"](input)),
      status: (input) => run(rpc["mcp.status"](input)),
      connect: (input) => run(rpc["mcp.connect"](input)),
      disconnect: (input) => run(rpc["mcp.disconnect"](input)),
      add: (input) => run(rpc["mcp.add"](input)),
      update: (input) => run(rpc["mcp.update"](input)),
      remove: (input) => run(rpc["mcp.remove"](input)),
      login: (input) => run(rpc["mcp.login"](input)),
      logout: (input) => run(rpc["mcp.logout"](input)),
    },
    skills: {
      list: (input) => run(rpc["skills.list"](input)),
      reload: (input) => run(rpc["skills.reload"](input)),
    },
    commands: {
      list: (input) => run(rpc["commands.list"](input)),
      reload: (input) => run(rpc["commands.reload"](input)),
    },
    models: {
      list: (input) => run(rpc["models.list"](input)),
      setCredential: (input) => run(rpc["models.set_credential"](input)),
      deleteCredential: (input) => run(rpc["models.delete_credential"](input)),
      answerLogin: (input) => run(rpc["models.answer_login"](input)),
      login: (input) => iterate(rpc["models.login"](input)),
    },
  };
};

/**
 * What {@link createHonkClient} needs to reach a running host.
 *
 * @category construction
 */
export interface HonkConnection {
  /** Base URL of a host serving {@link Rpcs}, e.g. `http://127.0.0.1:9163`. */
  readonly url: string;
  /** Bearer credential required by the Core host for every RPC request. */
  readonly bearerToken: string;
}

export const HonkConnectionSchema = Schema.Struct({
  url: Schema.String,
  bearerToken: Schema.String,
});

const verifyProtocol = async (connection: HonkConnection): Promise<void> => {
  const response = await fetch(
    new URL("/core/v1/handshake", `${connection.url.replace(/\/+$/, "")}/`),
    { headers: { authorization: `Bearer ${connection.bearerToken}` } },
  );
  if (response.status === 401) {
    throw new HonkClientConnectionError("unauthorized", "This Honk access is no longer valid.");
  }
  if (!response.ok) {
    throw new HonkClientConnectionError(
      "invalid_handshake",
      `Honk Core handshake failed (${response.status}).`,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new HonkClientConnectionError(
      "invalid_handshake",
      "Honk Core returned an invalid handshake.",
    );
  }
  Option.match(decodeHonkCoreHandshake(value), {
    onNone: () => {
      throw new HonkClientConnectionError(
        "protocol_mismatch",
        "This Honk app and computer use incompatible Core versions.",
      );
    },
    onSome: () => undefined,
  });
};

/**
 * Attaches a {@link HonkClient} to a host over HTTP.
 *
 * The remote counterpart of `HonkCore.client` (in `@honk/core/host`): the
 * same interface, the same command catalog, with ndjson framing so the
 * session events stream flows over a chunked response. Both constructors
 * build their facade through the one shared {@link makeSdk}, so the two
 * cannot drift.
 *
 * @example
 * ```ts
 * const sdk = await createHonkClient(connection);
 * const workspace = await sdk.workspace.open({ directory });
 * ```
 *
 * @category construction
 */
export const createHonkClient = async (connection: HonkConnection): Promise<HonkClient> => {
  await verifyProtocol(connection);
  const runtime = ManagedRuntime.make(
    RpcClient.layerProtocolHttp({
      url: `${connection.url.replace(/\/+$/, "")}/rpc`,
      transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(connection.bearerToken)),
    }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RpcSerialization.layerNdjson)),
  );
  const context = await runtime.context().catch(async (cause: unknown) => {
    await runtime.dispose();
    throw cause;
  });

  // The client lives in the runtime's own scope, so it lasts until close().
  const rpc = await runtime.runPromise(
    RpcClient.make(Rpcs).pipe(Effect.provideService(Scope.Scope, runtime.scope)),
  );

  return {
    ...makeSdk(
      rpc,
      (effect) => runtime.runPromise(effect),
      (stream) => Stream.toAsyncIterableWith(stream, context),
    ),
    close: () => runtime.dispose(),
  };
};

/**
 * One frame of {@link HonkClient.session.watch}.
 *
 * `state` is authoritative: committed entries, run phase, and per-turn
 * change receipts from one consistent read. `event` is advisory — Pi's live
 * event, for streaming text and activity — and is always eventually followed
 * by the `state` frame that makes it durable or moot.
 *
 * @category client
 */
export type SessionWatchFrame =
  | {
      readonly type: "state";
      readonly entries: readonly Session.SessionTreeEntry[];
      readonly phase: Session.Phase;
      readonly turns: Session.ChangesOutput["turns"];
    }
  | { readonly type: "event"; readonly event: Session.AgentHarnessEvent };

/** The session calls a watch composes; both client constructors pass their own. */
export interface SessionWatchCalls {
  readonly reload: HonkClient["session"]["reload"];
  readonly changes: HonkClient["session"]["changes"];
  readonly events: HonkClient["session"]["events"];
}

/**
 * The watch policy, once, for every client (spec/core.md section 9).
 *
 * The `live` head frame proves the subscription is active before the first
 * authoritative read, so nothing can slip between subscribe and reload.
 * After that, a commit point — a message committed, a run settled, a run
 * started (which committed the prompt) — triggers one repair read; the
 * generator serializes them by construction, so reads never overlap and a
 * burst of events cannot pile up concurrent reloads. Receipts refresh only
 * where they can change: at attach and at settlement.
 *
 * Pi's public entry cursor keeps repair reads bounded to entries committed
 * since the previous state frame. The watch accumulates those entries only in
 * this disposable client buffer; Pi remains the transcript owner.
 */
export async function* watchSession(
  calls: SessionWatchCalls,
  input: { readonly sessionId: Session.SessionId },
): AsyncGenerator<SessionWatchFrame, void, undefined> {
  let entries: readonly Session.SessionTreeEntry[] = [];
  let afterEntrySeq: number | undefined;
  let turns: Session.ChangesOutput["turns"] = [];

  const state = async (refreshTurns: boolean): Promise<SessionWatchFrame> => {
    if (refreshTurns) {
      // A workspace without a repository has no receipts; that must not end
      // the watch, so a failed changes read keeps the previous receipts.
      turns = await calls.changes(input).then(
        (output) => output.turns,
        () => turns,
      );
    }
    const snapshot = await calls.reload({
      ...input,
      ...(afterEntrySeq === undefined ? {} : { afterEntrySeq }),
    });
    entries = afterEntrySeq === undefined ? snapshot.entries : [...entries, ...snapshot.entries];
    afterEntrySeq = snapshot.entrySeq;
    return { type: "state", entries, phase: snapshot.phase, turns };
  };

  for await (const frame of calls.events(input)) {
    if (frame.type === "live") {
      yield await state(true);
      continue;
    }
    yield { type: "event", event: frame.event };
    const kind = frame.event.type;
    if (kind === "session_tree") {
      // Tree navigation changes which append-only entries form the active
      // branch. Reset the cursor and replace from Pi's authoritative branch;
      // appending a log tail cannot remove descendants of the old branch.
      entries = [];
      afterEntrySeq = undefined;
      yield await state(true);
    } else if (kind === "agent_start" || kind === "message_end") {
      yield await state(false);
    } else if (kind === "settled") {
      yield await state(true);
    }
  }
}
