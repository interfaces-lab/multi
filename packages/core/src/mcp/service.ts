/**
 * The MCP service: one manager per trusted workspace, owning server
 * definitions, process lifetime, and the metadata cache behind the `mcp`
 * proxy tool and the `sdk.mcp` namespace.
 *
 * Servers are lazy (spec/honk-built-ins.md section 8): opening a workspace
 * starts nothing, a server process starts on the first call that needs it,
 * and the cache answers `search` and `describe` without a live connection.
 * The invariants — reconnect never duplicates a process, killing the
 * workspace kills its servers, an unused server never starts — are enforced
 * by the single-flight connection map and the layer scope's finalizer.
 *
 * @module
 */

import { homedir } from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { Context, Effect, Layer, Option, Path, Ref, Schema, Scope, Semaphore } from "effect";
import type { Rpc } from "effect/unstable/rpc";

import { Workspace } from "../workspace";
import type {
  CacheEntry,
  CachedTool,
  OverridePatch,
  Overrides,
  ServerDefinition,
  ServerTransport,
  StdioTransport,
} from "./config";
import { CacheFile, mergeDefinitions, OverrideFile, parseConfigFile, transportKey } from "./config";
import type {
  Add,
  Connect,
  Disconnect,
  Interface,
  Login,
  Logout,
  ProxyArgs,
  Remove,
  ServerStatus,
  Update,
} from "./contract";
import {
  ConnectError,
  HttpUnsupportedError,
  OauthUnsupportedError,
  Rpcs,
  ServerDisabledError,
  ServerExistsError,
  ServerNotFoundError,
} from "./contract";

/** A definition the proxy can actually start. */
type StdioDefinition = ServerDefinition & { readonly transport: StdioTransport };

/**
 * One trusted workspace's MCP world.
 *
 * `connections` is the no-duplicate-process invariant: the promise enters the
 * map synchronously before anything spawns, so concurrent callers share one
 * start and a reconnect can only follow a removal. Creating a manager reads
 * config and cache files only — never a process — which is what makes the
 * race-convergent creation below safe: a losing manager is dropped unused.
 */
interface McpManager {
  readonly workspace: Workspace.Info;
  readonly shared: {
    readonly global: ReadonlyMap<string, ServerTransport>;
    readonly project: ReadonlyMap<string, ServerTransport>;
  };
  overrides: Overrides;
  definitions: ReadonlyMap<string, ServerDefinition>;
  readonly connections: Map<string, Promise<Client>>;
  readonly metadata: Map<string, CacheEntry>;
  /** Serializes override-file mutations, so no verb loses another's patch. */
  readonly overrideLock: Semaphore.Semaphore;
}

/** Longest tool output the proxy relays before clipping. */
const MAX_RESULT_LENGTH = 30_000;

/** Most matches one search answer carries. */
const MAX_SEARCH_RESULTS = 25;

/** The one name ordering every listing uses. */
const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name < b.name ? -1 : 1;

/**
 * What {@link layer} needs.
 *
 * @category layers
 */
export interface LayerOptions {
  /**
   * The host data directory's environment: override and cache files persist
   * through it, one pair per workspace. The same instance the trust store
   * uses.
   */
  readonly storage: Workspace.ExecutionEnv;

  /**
   * Where the user-global `mcp.json` lives. Defaults to `~/.config/mcp`;
   * tests point it at a directory they control.
   */
  readonly globalConfigDirectory?: string;
}

const make = (
  options: LayerOptions,
): Effect.Effect<Interface, never, Path.Path | Workspace.Service | Scope.Scope> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const workspaces = yield* Workspace.Service;
    const globalDirectory = options.globalConfigDirectory ?? path.join(homedir(), ".config", "mcp");

    // One manager per trusted workspace, created on first use.
    const managers = yield* Ref.make<ReadonlyMap<Workspace.WorkspaceId, McpManager>>(new Map());

    // Killing the workspace kills its servers: the layer scope owns every
    // manager it handed out, and teardown closes each client — the SDK
    // transport ends the child process (stdin end, then SIGTERM, then
    // SIGKILL). Best-effort on purpose, like the workspace env sweep.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const map = yield* Ref.get(managers);
        yield* Effect.forEach(
          [...map.values()],
          (manager) => Effect.promise(() => closeManager(manager)),
          { concurrency: "unbounded", discard: true },
        );
      }),
    );

    /** Reads one file through an environment, treating any failure as absence. */
    const readOptional = Effect.fnUntraced(function* (env: Workspace.ExecutionEnv, file: string) {
      const read = yield* Effect.promise(() => env.readTextFile(file));
      return read.ok ? read.value : undefined;
    });

    const overrideFileOf = (workspaceId: Workspace.WorkspaceId) => `mcp-${workspaceId}.json`;
    const cacheFileOf = (workspaceId: Workspace.WorkspaceId) => `mcp-cache-${workspaceId}.json`;

    /**
     * Reads the Honk override patches. A missing file is the ordinary empty
     * state; a file that exists but does not decode is a broken host store
     * and fails loudly, exactly like the trust store — these are recorded
     * user decisions, not a disposable cache.
     */
    const loadOverrides = Effect.fnUntraced(function* (workspaceId: Workspace.WorkspaceId) {
      const text = yield* readOptional(options.storage, overrideFileOf(workspaceId));
      if (text === undefined) return {} satisfies Overrides;
      return yield* Schema.decodeUnknownEffect(OverrideFile)(JSON.parse(text)).pipe(Effect.orDie);
    });

    /** Reads the metadata cache. Disposable: missing or corrupt starts empty. */
    const loadCache = Effect.fnUntraced(function* (workspaceId: Workspace.WorkspaceId) {
      const text = yield* readOptional(options.storage, cacheFileOf(workspaceId));
      if (text === undefined) return new Map<string, CacheEntry>();
      const decoded = yield* Effect.try((): unknown => JSON.parse(text)).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CacheFile)),
        Effect.option,
      );
      return Option.isNone(decoded)
        ? new Map<string, CacheEntry>()
        : new Map<string, CacheEntry>(Object.entries(decoded.value));
    });

    /** Rewrites the cache file from the manager's live metadata. Best-effort. */
    const persistCache = Effect.fnUntraced(function* (manager: McpManager) {
      const serialized = JSON.stringify(Object.fromEntries(manager.metadata), null, 2);
      yield* Effect.promise(() =>
        options.storage.writeFile(cacheFileOf(manager.workspace.id), `${serialized}\n`),
      );
    });

    /**
     * Applies one updater to the override record, rewrites the file, and
     * folds the result into the manager — all under the manager's lock, so a
     * concurrent verb reads this one's patches instead of overwriting them.
     * A failed write is a broken host store: the decision would not survive a
     * restart, so it dies rather than lying.
     */
    const persistOverrides = (
      manager: McpManager,
      update: (current: Overrides) => Overrides,
    ): Effect.Effect<void> =>
      manager.overrideLock.withPermit(
        Effect.gen(function* () {
          const overrides = update(manager.overrides);
          const written = yield* Effect.promise(() =>
            options.storage.writeFile(
              overrideFileOf(manager.workspace.id),
              `${JSON.stringify(overrides, null, 2)}\n`,
            ),
          );
          if (!written.ok) return yield* Effect.die(written.error);
          manager.overrides = overrides;
          manager.definitions = mergeDefinitions({ ...manager.shared, overrides });
        }),
      );

    /**
     * Resolves the workspace's manager, creating it on first use. Creation
     * reads the trust gate first — config files are workspace-controlled code
     * selection, so nothing is read for an unknown id — then the two shared
     * files, the overrides, and the cache. No process starts here.
     */
    const managerFor = Effect.fnUntraced(function* (workspaceId: Workspace.WorkspaceId) {
      const existing = (yield* Ref.get(managers)).get(workspaceId);
      if (existing) return existing;
      const workspace = yield* workspaces.find({ workspaceId });
      const env = yield* workspaces.env({ workspaceId });
      const globalText = yield* readOptional(
        options.storage,
        path.join(globalDirectory, "mcp.json"),
      );
      const projectText = yield* readOptional(env, ".mcp.json");
      const shared = {
        global: parseConfigFile(globalText ?? ""),
        project: parseConfigFile(projectText ?? ""),
      };
      const overrides = yield* loadOverrides(workspaceId);
      const definitions = mergeDefinitions({ ...shared, overrides });
      const cache = yield* loadCache(workspaceId);
      const metadata = new Map<string, CacheEntry>();
      for (const [name, entry] of cache) {
        const definition = definitions.get(name);
        if (
          definition?.transport.kind === "stdio" &&
          entry.config === transportKey(definition.transport)
        ) {
          metadata.set(name, entry);
        }
      }
      const created: McpManager = {
        workspace,
        shared,
        overrides,
        definitions,
        connections: new Map(),
        metadata,
        overrideLock: Semaphore.makeUnsafe(1),
      };
      // Re-read under update so two concurrent callers converge on one
      // instance; the loser's manager read files and started nothing.
      return yield* Ref.modify(
        managers,
        (map): readonly [McpManager, ReadonlyMap<Workspace.WorkspaceId, McpManager>] => {
          const raced = map.get(workspaceId);
          if (raced) return [raced, map];
          return [created, new Map(map).set(workspaceId, created)];
        },
      );
    });

    /**
     * The one place a server process starts. The promise enters the map
     * before anything spawns, so a concurrent caller joins this start instead
     * of launching a second process; a failed or closed connection removes
     * itself, so the next call may start fresh — reconnection, not
     * duplication.
     */
    const startServer = (manager: McpManager, definition: ServerDefinition): Promise<Client> => {
      const existing = manager.connections.get(definition.name);
      if (existing) return existing;
      const transport = definition.transport;
      if (transport.kind !== "stdio") {
        return Promise.reject(new Error("http transports are unsupported"));
      }
      const started = (async () => {
        const client = new Client({ name: "honk", version: "0.0.0" });
        await client.connect(
          new StdioClientTransport({
            command: transport.command,
            args: [...transport.args],
            env: { ...getDefaultEnvironment(), ...transport.env },
            cwd: transport.cwd ?? manager.workspace.directory,
            stderr: "ignore",
          }),
        );
        const listed = await client.listTools();
        manager.metadata.set(definition.name, {
          config: transportKey(transport),
          tools: listed.tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema,
          })),
        });
        client.onclose = () => {
          if (manager.connections.get(definition.name) === started) {
            manager.connections.delete(definition.name);
          }
        };
        return client;
      })();
      manager.connections.set(definition.name, started);
      started.catch(() => {
        if (manager.connections.get(definition.name) === started) {
          manager.connections.delete(definition.name);
        }
      });
      return started;
    };

    /**
     * {@link startServer} with the typed failure. Callers persist the cache
     * once per operation rather than per connect, so concurrent starts never
     * race writes to the cache file.
     */
    const connectServer = Effect.fnUntraced(function* (
      manager: McpManager,
      definition: ServerDefinition,
    ) {
      return yield* Effect.tryPromise({
        try: () => startServer(manager, definition),
        catch: (cause) =>
          new ConnectError({
            server: definition.name,
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      });
    });

    /** The definition, gated: it must exist, be enabled, and be startable. */
    const startable = Effect.fnUntraced(function* (manager: McpManager, server: string) {
      const definition = manager.definitions.get(server);
      if (definition === undefined) return yield* new ServerNotFoundError({ server });
      if (definition.disabled) return yield* new ServerDisabledError({ server });
      if (definition.transport.kind === "http") return yield* new HttpUnsupportedError({ server });
      return definition;
    });

    /** A server's cached tools, empty once its definition changed under the cache. */
    const cachedTools = (
      manager: McpManager,
      definition: ServerDefinition,
    ): readonly CachedTool[] => {
      if (definition.transport.kind !== "stdio") return [];
      const entry = manager.metadata.get(definition.name);
      return entry !== undefined && entry.config === transportKey(definition.transport)
        ? entry.tools
        : [];
    };

    /** Enabled stdio definitions, the only ones the proxy can serve. */
    const servable = (manager: McpManager): StdioDefinition[] =>
      [...manager.definitions.values()]
        .flatMap((definition): StdioDefinition[] => {
          if (definition.disabled || definition.transport.kind !== "stdio") return [];
          return [{ ...definition, transport: definition.transport }];
        })
        .sort(byName);

    const list = Effect.fn("Mcp.list")(function* (input: {
      readonly workspaceId: Workspace.WorkspaceId;
    }) {
      const manager = yield* managerFor(input.workspaceId);
      const servers = [...manager.definitions.values()].sort(byName).map((definition) => ({
        name: definition.name,
        transport: definition.transport.kind,
        source: definition.source,
        disabled: definition.disabled,
      }));
      return { servers };
    });

    const status = Effect.fn("Mcp.status")(function* (input: {
      readonly workspaceId: Workspace.WorkspaceId;
    }) {
      const manager = yield* managerFor(input.workspaceId);
      const servers = [...manager.definitions.values()].sort(byName).map(
        (definition): ServerStatus => ({
          name: definition.name,
          connected: manager.connections.has(definition.name),
          tools: cachedTools(manager, definition).length,
        }),
      );
      return { servers };
    });

    const connect = Effect.fn("Mcp.connect")(function* (input: Rpc.Payload<typeof Connect>) {
      const manager = yield* managerFor(input.workspaceId);
      const definition = yield* startable(manager, input.server);
      yield* connectServer(manager, definition);
      yield* persistCache(manager);
    });

    const disconnect = Effect.fn("Mcp.disconnect")(function* (
      input: Rpc.Payload<typeof Disconnect>,
    ) {
      const manager = yield* managerFor(input.workspaceId);
      if (!manager.definitions.has(input.server)) {
        return yield* new ServerNotFoundError({ server: input.server });
      }
      yield* stopServer(manager, input.server);
    });

    const definitionOf = (input: Rpc.Payload<typeof Add>): StdioTransport => ({
      kind: "stdio",
      command: input.command,
      args: input.args ?? [],
      env: input.env ?? {},
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    });

    const add = Effect.fn("Mcp.add")(function* (input: Rpc.Payload<typeof Add>) {
      const manager = yield* managerFor(input.workspaceId);
      if (manager.definitions.has(input.server)) {
        return yield* new ServerExistsError({ server: input.server });
      }
      yield* persistOverrides(manager, (current) => ({
        ...current,
        [input.server]: { definition: definitionOf(input) },
      }));
    });

    const update = Effect.fn("Mcp.update")(function* (input: Rpc.Payload<typeof Update>) {
      const manager = yield* managerFor(input.workspaceId);
      if (!manager.definitions.has(input.server)) {
        return yield* new ServerNotFoundError({ server: input.server });
      }
      yield* persistOverrides(manager, (current) => {
        const previous = current[input.server];
        const definition =
          input.command === undefined
            ? previous?.definition
            : definitionOf({ ...input, command: input.command });
        const disabled = input.disabled ?? previous?.disabled;
        return {
          ...current,
          [input.server]: {
            ...(definition === undefined ? {} : { definition }),
            ...(disabled === undefined ? {} : { disabled }),
          },
        };
      });
      // Disabling wins immediately: a connected server never outlives its gate.
      if (input.disabled === true) yield* stopServer(manager, input.server);
    });

    const remove = Effect.fn("Mcp.remove")(function* (input: Rpc.Payload<typeof Remove>) {
      const manager = yield* managerFor(input.workspaceId);
      if (!manager.definitions.has(input.server)) {
        return yield* new ServerNotFoundError({ server: input.server });
      }
      yield* stopServer(manager, input.server);
      yield* persistOverrides(manager, (current) => {
        // A shared-file server is masked, never rewritten out of its file; an
        // override-only one simply leaves the patch record.
        const shared =
          manager.shared.global.has(input.server) || manager.shared.project.has(input.server);
        const next: Record<string, OverridePatch> = { ...current };
        if (shared) next[input.server] = { removed: true };
        else delete next[input.server];
        return next;
      });
    });

    const login = Effect.fn("Mcp.login")(function* (_input: Rpc.Payload<typeof Login>) {
      return yield* new OauthUnsupportedError({});
    });

    const logout = Effect.fn("Mcp.logout")(function* (_input: Rpc.Payload<typeof Logout>) {
      return yield* new OauthUnsupportedError({});
    });

    /**
     * Ensures every servable server has a valid cache entry, connecting only
     * the ones that lack one. The warm path — every entry valid — starts
     * nothing, which is what "search answered from cache" means; a server
     * that fails to start is reported in the answer, not thrown.
     */
    const ensureMetadata = Effect.fnUntraced(function* (manager: McpManager) {
      const missing = servable(manager).filter(
        (definition) =>
          manager.metadata.get(definition.name)?.config !== transportKey(definition.transport),
      );
      const failures: string[] = [];
      yield* Effect.forEach(
        missing,
        (definition) =>
          connectServer(manager, definition).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                failures.push(
                  `note: server "${definition.name}" failed to start — ${error.detail}`,
                );
              }),
            ),
          ),
        { concurrency: 4, discard: true },
      );
      if (missing.length > 0) yield* persistCache(manager);
      return failures;
    });

    const firstLine = (text: string): string => {
      const line = text.split("\n", 1)[0] ?? "";
      return line.length > 120 ? `${line.slice(0, 120)}…` : line;
    };

    const search = Effect.fnUntraced(function* (manager: McpManager, query: string) {
      const notes = yield* ensureMetadata(manager);
      const needle = query.toLowerCase();
      const matches: string[] = [];
      for (const definition of servable(manager)) {
        for (const tool of cachedTools(manager, definition)) {
          if (
            tool.name.toLowerCase().includes(needle) ||
            tool.description.toLowerCase().includes(needle)
          ) {
            matches.push(`${definition.name}/${tool.name} — ${firstLine(tool.description)}`);
          }
        }
      }
      const shown = matches.slice(0, MAX_SEARCH_RESULTS);
      const lines =
        matches.length === 0
          ? [`No MCP tools matching "${query}".`]
          : [
              `${matches.length} tool${matches.length === 1 ? "" : "s"} matching "${query}":`,
              ...shown,
              ...(matches.length > shown.length
                ? [`(${matches.length - shown.length} more; refine the search)`]
                : []),
            ];
      return [...lines, ...notes].join("\n");
    });

    /** Finds one tool by plain or `server/tool`-qualified name in the cache. */
    const resolveTool = (
      manager: McpManager,
      name: string,
    ):
      | { readonly definition: ServerDefinition; readonly tool: string }
      | { readonly answer: string } => {
      const slash = name.indexOf("/");
      if (slash > 0) {
        const definition = manager.definitions.get(name.slice(0, slash));
        if (definition === undefined)
          return { answer: `Unknown MCP server "${name.slice(0, slash)}".` };
        return { definition, tool: name.slice(slash + 1) };
      }
      const owners = servable(manager).filter((definition) =>
        cachedTools(manager, definition).some((tool) => tool.name === name),
      );
      if (owners.length === 1 && owners[0] !== undefined) {
        return { definition: owners[0], tool: name };
      }
      if (owners.length > 1) {
        const names = owners.map((owner) => `${owner.name}/${name}`).join(", ");
        return { answer: `Multiple servers provide "${name}"; qualify the call: ${names}.` };
      }
      return {
        answer: `Unknown MCP tool "${name}". Use mcp({ search: "..." }) to discover tools.`,
      };
    };

    const describe = (manager: McpManager, name: string): string => {
      const resolved = resolveTool(manager, name);
      if ("answer" in resolved) return resolved.answer;
      const tool = cachedTools(manager, resolved.definition).find(
        (candidate) => candidate.name === resolved.tool,
      );
      if (tool === undefined) {
        return `Server "${resolved.definition.name}" has no cached tool "${resolved.tool}". Use mcp({ search: "..." }) to discover tools.`;
      }
      return [
        `${resolved.definition.name}/${tool.name}`,
        tool.description,
        `Parameters: ${JSON.stringify(tool.inputSchema)}`,
      ].join("\n");
    };

    const clip = (text: string): string =>
      text.length <= MAX_RESULT_LENGTH
        ? text
        : `${text.slice(0, MAX_RESULT_LENGTH)}\n[output truncated at ${MAX_RESULT_LENGTH} characters]`;

    const call = Effect.fnUntraced(function* (
      manager: McpManager,
      name: string,
      args: Readonly<Record<string, unknown>>,
      signal: AbortSignal | undefined,
    ) {
      const resolved = resolveTool(manager, name);
      if ("answer" in resolved) return resolved.answer;
      const { definition, tool } = resolved;
      if (definition.disabled) return `MCP server "${definition.name}" is disabled.`;
      if (definition.transport.kind === "http") {
        return `MCP server "${definition.name}" uses an HTTP transport, which Honk does not support yet.`;
      }
      // Failures stay text in the error channel until the one catch at the
      // end; either channel answers the model.
      return yield* Effect.gen(function* () {
        const wasConnected = manager.connections.has(definition.name);
        const client = yield* connectServer(manager, definition).pipe(
          Effect.mapError(
            (error) => `MCP server "${definition.name}" failed to start — ${error.detail}`,
          ),
        );
        // Only a fresh connect listed tools; a warm one changed no metadata.
        if (!wasConnected) yield* persistCache(manager);
        const result = yield* Effect.tryPromise({
          try: () =>
            client.callTool(
              { name: tool, arguments: { ...args } },
              undefined,
              signal === undefined ? {} : { signal },
            ),
          catch: (cause) =>
            `MCP tool call failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
        const blocks = Array.isArray(result.content) ? result.content : [];
        const text = blocks
          .map((block) => (block.type === "text" ? block.text : `[${String(block.type)} content]`))
          .join("\n");
        const body = text.length === 0 ? "(empty result)" : clip(text);
        return result.isError === true ? `Error: ${body}` : body;
      }).pipe(Effect.catch((detail) => Effect.succeed(detail)));
    });

    const statusText = (manager: McpManager): string => {
      const definitions = [...manager.definitions.values()].sort(byName);
      if (definitions.length === 0) return "No MCP servers configured.";
      return definitions
        .map((definition) => {
          if (definition.disabled) return `- ${definition.name}: disabled`;
          if (definition.transport.kind === "http") {
            return `- ${definition.name}: http (unsupported)`;
          }
          const tools = cachedTools(manager, definition).length;
          if (manager.connections.has(definition.name)) {
            return `- ${definition.name}: connected, ${tools} tools`;
          }
          return tools > 0
            ? `- ${definition.name}: not connected, ${tools} tools cached`
            : `- ${definition.name}: not connected; mcp({ search: "..." }) discovers its tools`;
        })
        .join("\n");
    };

    const run = Effect.fn("Mcp.run")(function* (input: {
      readonly workspaceId: Workspace.WorkspaceId;
      readonly params: ProxyArgs;
      readonly signal?: AbortSignal;
    }) {
      return yield* Effect.gen(function* () {
        const manager = yield* managerFor(input.workspaceId);
        if (input.params.tool !== undefined) {
          return yield* call(manager, input.params.tool, input.params.args ?? {}, input.signal);
        }
        if (input.params.describe !== undefined) {
          return describe(manager, input.params.describe);
        }
        if (input.params.search !== undefined) {
          return yield* search(manager, input.params.search);
        }
        return statusText(manager);
      }).pipe(Effect.catch((error) => Effect.succeed(`honk: mcp failed — ${error.message}`)));
    });

    return {
      list,
      status,
      connect,
      disconnect,
      add,
      update,
      remove,
      login,
      logout,
      run,
    } satisfies Interface;
  });

/** Stops one server's process and forgets its connection entry. */
const stopServer = Effect.fnUntraced(function* (manager: McpManager, server: string) {
  const pending = manager.connections.get(server);
  if (pending === undefined) return;
  manager.connections.delete(server);
  yield* Effect.promise(() => pending.then((client) => client.close()).catch(() => undefined));
});

/** Closes every server this manager started. Best-effort by design. */
const closeManager = async (manager: McpManager): Promise<void> => {
  const pending = [...manager.connections.values()];
  manager.connections.clear();
  await Promise.all(
    pending.map((connection) => connection.then((client) => client.close()).catch(() => undefined)),
  );
};

/**
 * The service key and its construction, declared together: `Service.make`
 * is the one parameterized constructor of this service.
 *
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Mcp", { make }) {}

/**
 * Provides {@link Service} from its own `make`. One layer instance owns one
 * manager map; its scope owns every server process handed out.
 *
 * @category layers
 */
export const layer = (options: LayerOptions) => Layer.effect(Service, Service.make(options));

/**
 * {@link layer} with POSIX path rules, for tests and browser-adjacent hosts.
 * The `Workspace.Service` requirement stays open on purpose — one host builds
 * one workspace layer and shares it.
 *
 * @category layers
 */
export const defaultLayer = (options: LayerOptions) =>
  layer(options).pipe(Layer.provide(Path.layer));

/**
 * Binds the MCP RPCs to {@link Service}. Handlers stay thin: decoding already
 * happened at the RPC boundary, so they only bind payloads to service
 * methods.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const mcp = yield* Service;
    return {
      "mcp.list": (payload) => mcp.list(payload),
      "mcp.status": (payload) => mcp.status(payload),
      "mcp.connect": (payload) => mcp.connect(payload),
      "mcp.disconnect": (payload) => mcp.disconnect(payload),
      "mcp.add": (payload) => mcp.add(payload),
      "mcp.update": (payload) => mcp.update(payload),
      "mcp.remove": (payload) => mcp.remove(payload),
      "mcp.login": (payload) => mcp.login(payload),
      "mcp.logout": (payload) => mcp.logout(payload),
    };
  }),
);
