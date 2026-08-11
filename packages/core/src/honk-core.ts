/**
 * The host entry point to Honk Core.
 *
 * Two functions define the whole surface:
 *
 * - {@link createHonkCore} starts one host for one data directory. It resolves
 *   after the host owns its stores and services, or rejects. There is no
 *   `init()`, no `ready` promise, and no `isReady` flag.
 * - {@link HonkCore.client} attaches one in-process interface to that running
 *   host. It is synchronous because the core is already ready, and it never
 *   starts a second core.
 *
 * The client surface — `HonkClient`, `createHonkClient`, and the command
 * catalog `Rpcs` — lives in `./client`, exported as `@honk/core`. That module
 * reaches only contract modules, so a browser bundle can hold it; this one
 * owns the service graph and is Node-only (MCP child processes, subscription
 * shaping, the writer lease).
 *
 * @example
 * ```ts
 * import { createHonkCore } from "@honk/core/host";
 *
 * await using core = await createHonkCore({ dataDirectory, createExecutionEnv });
 * const sdk = core.client();
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

import type { CredentialStore, MutableModels } from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import type { RpcGroup } from "effect/unstable/rpc";
import { RpcClient, RpcServer } from "effect/unstable/rpc";

import { AnthropicSubscription } from "./anthropic-subscription";
import type { HonkClient } from "./client";
import { makeSdk, Rpcs } from "./client";
import { Commands } from "./commands";
import { Files } from "./files";
import { Git } from "./git";
import { Lease } from "./lease";
import { Mcp } from "./mcp";
import { Models } from "./models";
import { Resources } from "./resources";
import { Session } from "./session";
import { Skills } from "./skills";
import { Workspace } from "./workspace";

// Construction's own failure mode, re-exported beside the constructor:
// createHonkCore rejects with LeaseError while another host's lease is fresh.
export { LeaseError } from "./lease";

/**
 * Everything {@link createHonkCore} needs to own a data directory.
 *
 * @category construction
 */
export interface HonkCoreOptions {
  /**
   * The directory this core owns.
   *
   * Pi session transcripts live under `sessions/`, trust decisions in
   * `workspaces.json`, provider credentials in `auth.json`, and the writer
   * lease in `lease`. One live core per data directory: construction fails
   * with {@link Lease.LeaseError} while another host's lease is fresh.
   */
  readonly dataDirectory: string;

  /**
   * Replaces the built-in provider catalog. A test seam, not configuration.
   *
   * Production omits it: the core builds `builtinModels({ credentials })`
   * over its own persisted credential store, so every Pi provider is present
   * and a stored key or ambient env var unlocks it (spec section 11). Tests
   * pass a collection carrying Pi's faux provider, whose auth always
   * resolves — fixtures run offline with no credential setup.
   */
  readonly createModels?: (credentials: CredentialStore) => MutableModels;

  /** Subagent catalog and fusion seating overrides; tests inject faux arms. */
  readonly presets?: readonly Session.Preset[];
  readonly pairings?: readonly Session.Pairing[];

  /** Background session-title generator override. Tests use an offline implementation. */
  readonly generateSessionTitle?: Session.GenerateSessionTitle;

  /**
   * Builds the filesystem and shell environment for one trusted workspace.
   *
   * Injected rather than imported so `@honk/core` carries no platform
   * dependency of its own. A Node host passes
   * `(cwd) => new NodeExecutionEnv({ cwd })`; a test passes the same thing or a
   * stub. One instance per workspace is shared by the Pi harness's tools,
   * `sdk.files`, and `sdk.git`, which is what keeps the workspace directory the
   * boundary for all three.
   */
  readonly createExecutionEnv: Workspace.LayerOptions["createExecutionEnv"];
}

/**
 * A running Honk Core host.
 *
 * The host outlives every interface attached to it. Renderer reloads, network
 * drops, and closed clients leave it running; only the host lifecycle closes
 * the core and releases its writer lease.
 *
 * @category construction
 */
export interface HonkCore {
  /**
   * Attaches another in-process interface to this core.
   *
   * Synchronous by contract: the core is already ready, so there is nothing to
   * await. In-process clients speak the same {@link Rpcs} group as remote ones
   * with the serialization step removed, which keeps one command catalog
   * rather than a fast path that can drift from the wire path.
   */
  readonly client: () => HonkClient;

  /** Shuts down live Pi harnesses and releases the core's data directory. */
  readonly close: () => Promise<void>;

  /** Supports `await using core = await createHonkCore(...)`. */
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * The core's whole service graph, as one layer that requires nothing.
 *
 * It outputs the RPC handler services for every command in {@link Rpcs} and
 * keeps `Session.Service` and `Workspace.Service` private. There is one
 * assembly of a Honk Core host, and this is it: {@link createHonkCore} runs it
 * in a `ManagedRuntime` for in-process clients, and a host that serves the
 * group over a transport provides this same layer to its RPC server. A host
 * that re-assembled the parts itself could drift from this one.
 *
 * @example
 * ```ts
 * // Serving the same core over a transport instead of in process.
 * RpcServer.layerHttp({ group: Rpcs, path: "/rpc", protocol: "http" }).pipe(
 *   Layer.provide(HonkCore.layer(options)),
 *   Layer.provide(RpcSerialization.layerNdjson),
 * );
 * ```
 *
 * @category construction
 */
export const layer = (options: HonkCoreOptions) => {
  // One environment for everything the host persists: session transcripts,
  // the trust store, credentials, and the lease all live under the data
  // directory and go through this instance.
  const storage = options.createExecutionEnv(options.dataDirectory);

  // Pi loads OAuth flow modules through a bundler-opaque dynamic import,
  // which resolves nowhere once a host is bundled (the Electron main bundle):
  // `models.login` then rejects instantly. Registering the statically
  // imported flows here makes interactive login work in every host by
  // construction; unbundled hosts are unaffected.
  registerBunOAuthFlows();

  // The credential store and the collection are built as a pair: the
  // collection resolves request auth through the same store the models RPCs
  // write, so a key stored through settings unlocks the very next request.
  const credentials = Models.credentialStore(storage);
  const collection = options.createModels?.(credentials) ?? builtinModels({ credentials });
  // The public provider registration seam keeps Anthropic subscription
  // compatibility out of Pi's installed source. Every request still runs
  // through Pi's canonical transport and agent loop.
  AnthropicSubscription.install(collection);
  const modelsLayer = Models.layer({ collection, credentials });
  // One MCP manager map for the host: the session layer's proxy tool and the
  // mcp RPCs must see the same managers, or a connect through settings would
  // start a second process beside the tool's.
  const mcpLayer = Mcp.defaultLayer({ storage });

  // One resource scan for the host, for the same reason: `sdk.skills.list`
  // and the harness `runSkill` invokes must read one list, or the menu would
  // offer a skill Pi cannot find. A `reload` through either namespace is
  // therefore the reload the next turn's harness sees.
  const resourcesLayer = Resources.defaultLayer;

  // One Workspace instance backs both the trust RPCs and session lookup.
  // Providing a second would split the trust store, and a WorkspaceId minted
  // by one half would be unknown to the other.
  const services = Layer.mergeAll(
    // Session captures a checkpoint per settled turn through Git.Service and
    // builds harnesses over Models.Service. The same layer references appear
    // twice, so Effect's layer memoization builds one instance of each,
    // shared with their own RPC handlers.
    Session.layer({
      storage,
      ...(options.presets === undefined ? {} : { presets: options.presets }),
      ...(options.pairings === undefined ? {} : { pairings: options.pairings }),
      ...(options.generateSessionTitle === undefined
        ? {}
        : { generateTitle: options.generateSessionTitle }),
    }).pipe(
      Layer.provide(Git.defaultLayer),
      Layer.provide(modelsLayer),
      Layer.provide(mcpLayer),
      Layer.provide(resourcesLayer),
    ),
    Files.defaultLayer,
    Git.defaultLayer,
    modelsLayer,
    mcpLayer,
    Skills.layer.pipe(Layer.provide(resourcesLayer)),
    Commands.layer.pipe(Layer.provide(resourcesLayer)),
  ).pipe(
    // One Workspace instance for all of them: sessions, files, and git resolve
    // the same trust decisions and share one ExecutionEnv per workspace.
    // TODO(core-migration §6): POSIX paths. A Node host needs NodePath.layer so
    // workspace directories canonicalize the way the platform resolves them.
    Layer.provideMerge(
      Workspace.defaultLayer({ createExecutionEnv: options.createExecutionEnv, storage }),
    ),
  );

  const handlers = Layer.mergeAll(
    Workspace.rpcLayer,
    Session.rpcLayer,
    Files.rpcLayer,
    Git.rpcLayer,
    Models.rpcLayer,
    Mcp.rpcLayer,
    Skills.rpcLayer,
    Commands.rpcLayer,
  ).pipe(Layer.provide(services));

  // The lease gates construction rather than racing beside it. Layer.unwrap
  // also gives it the outer lifetime: dependent services finalize first, then
  // the lease scope removes the file as the host's last act.
  return Layer.unwrap(
    Lease.acquire(storage, options.dataDirectory).pipe(Effect.map(() => handlers)),
  );
};

/**
 * Starts one Honk Core host for one data directory.
 *
 * Construction has no half-ready state. The returned promise resolves only
 * after the host's services are built and usable, and rejects if any required
 * part cannot start — in which case nothing is left running to clean up.
 *
 * @throws Rejects with the layer construction error if the host cannot start.
 *
 * @example
 * ```ts
 * const core = await createHonkCore({ dataDirectory, createExecutionEnv });
 * const desktop = core.client();
 * const inspector = core.client(); // a second interface, still one core
 * ```
 *
 * @category construction
 */
export const createHonkCore = async (options: HonkCoreOptions): Promise<HonkCore> => {
  const runtime = ManagedRuntime.make(layer(options));

  // Awaiting the context is what turns "the layer describes a host" into "the
  // host exists". A failure here is a construction failure, so the runtime is
  // disposed before the rejection escapes.
  const context = await runtime.context().catch(async (cause: unknown) => {
    await runtime.dispose();
    throw cause;
  });

  /**
   * Builds one client over its own scope.
   *
   * The scope is forked from the core's scope, so closing the client releases
   * only this interface while closing the core releases every interface it
   * handed out.
   */
  const client = (): HonkClient => {
    const scope = Scope.forkUnsafe(runtime.scope);

    // Synchronous by construction: the runtime's services are already built,
    // and wiring two in-memory halves together performs no I/O.
    const rpc = runtime.runSync(
      makeInProcessRpcClient().pipe(Effect.provideService(Scope.Scope, scope)),
    );

    return {
      ...makeSdk(
        rpc,
        (effect) => runtime.runPromise(effect),
        (stream) => Stream.toAsyncIterableWith(stream, context),
      ),
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    };
  };

  const close = () => runtime.dispose();

  return { client, close, [Symbol.asyncDispose]: close };
};

/**
 * The in-process transport: a client and a server for the same group, wired
 * directly to each other with no serializer, socket, or HTTP framing.
 *
 * Requests, stream chunks, acknowledgements, and interrupts still travel the
 * normal client/server machinery, so an in-process client exercises the same
 * code path a remote one does. Effect's `RpcTest.makeClient` is the upstream
 * reference for this wiring.
 */
const makeInProcessRpcClient = Effect.fnUntraced(function* () {
  // The two halves are mutually recursive: the server answers requests, so it
  // needs the client's inbox before the client exists. One of them therefore
  // has to be named ahead of its construction, which is why this type is
  // spelled out rather than inferred. `RpcGroup.Rpcs` turns the group value
  // into the RPC union the client constructor is generic over.
  type ClientHalf = Effect.Success<
    ReturnType<typeof RpcClient.makeNoSerialization<RpcGroup.Rpcs<typeof Rpcs>, never, false>>
  >;

  // Holding the write function in a mutable binding keeps that ordering
  // explicit. A definite-assignment assertion would only hide it, and
  // spec/core.md section 14 rules out assertions here.
  let inbox: ClientHalf["write"] | undefined;

  const server = yield* RpcServer.makeNoSerialization(Rpcs, {
    onFromServer: (response) => (inbox === undefined ? Effect.void : inbox(response)),
  });

  const client = yield* RpcClient.makeNoSerialization(Rpcs, {
    supportsAck: true,
    onFromClient: ({ message }) => server.write(0, message),
  });

  inbox = client.write;
  return client.client;
});

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as HonkCore from "./honk-core";
