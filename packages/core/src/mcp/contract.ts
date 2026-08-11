/**
 * The MCP command catalog: schemas, typed errors, and the RPC group.
 *
 * The namespace manages server definitions and process lifetime; the tools
 * themselves stay behind the one `mcp` proxy tool and never appear here.
 * `connect` resolves only after the server is connected. `login` and `logout`
 * exist so the surface never guesses, and reject with their catalog code
 * until HTTP transports and OAuth stage in.
 *
 * @category commands
 * @module
 */

import type { Effect } from "effect";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { ServiceOf } from "../util/rpc";
import { Workspace } from "../workspace";
import type { ProxyToolArgs } from "./tool";

/**
 * One configured server as a settings surface lists it: where it came from
 * and whether Honk will start it, without any live state.
 *
 * @category schemas
 */
export const ServerInfo = Schema.Struct({
  name: Schema.NonEmptyString,
  transport: Schema.Literals(["stdio", "http"]),
  source: Schema.Literals(["global", "project", "override"]),
  disabled: Schema.Boolean,
}).annotate({ identifier: "McpServerInfo" });
export type ServerInfo = typeof ServerInfo.Type;

/**
 * @category schemas
 */
export const ListOutput = Schema.Struct({ servers: Schema.Array(ServerInfo) }).annotate({
  identifier: "McpListOutput",
});
export type ListOutput = typeof ListOutput.Type;

/**
 * One server's live state: whether a process is connected right now, and how
 * many tools the metadata cache knows — answered without starting anything.
 *
 * @category schemas
 */
export const ServerStatus = Schema.Struct({
  name: Schema.NonEmptyString,
  connected: Schema.Boolean,
  tools: Schema.Int,
}).annotate({ identifier: "McpServerStatus" });
export type ServerStatus = typeof ServerStatus.Type;

/**
 * @category schemas
 */
export const StatusOutput = Schema.Struct({ servers: Schema.Array(ServerStatus) }).annotate({
  identifier: "McpStatusOutput",
});
export type StatusOutput = typeof StatusOutput.Type;

/**
 * No configured server carries this name.
 *
 * @category errors
 */
export class ServerNotFoundError extends Schema.TaggedErrorClass<ServerNotFoundError>()(
  "McpServerNotFoundError",
  {
    code: Schema.tag("mcp.server_not_found"),
    message: Schema.tag("Honk has no MCP server with this name."),
    server: Schema.NonEmptyString,
  },
) {}

/**
 * `add` refuses to shadow an existing definition; `update` is the verb for
 * changing one.
 *
 * @category errors
 */
export class ServerExistsError extends Schema.TaggedErrorClass<ServerExistsError>()(
  "McpServerExistsError",
  {
    code: Schema.tag("mcp.server_exists"),
    message: Schema.tag("An MCP server with this name is already configured."),
    server: Schema.NonEmptyString,
  },
) {}

/**
 * The server is configured but the user disabled it here, so Honk will not
 * start it.
 *
 * @category errors
 */
export class ServerDisabledError extends Schema.TaggedErrorClass<ServerDisabledError>()(
  "McpServerDisabledError",
  {
    code: Schema.tag("mcp.server_disabled"),
    message: Schema.tag("This MCP server is disabled."),
    server: Schema.NonEmptyString,
  },
) {}

/**
 * The definition is an HTTP transport, which has not staged in yet
 * (spec/honk-built-ins.md section 8: stdio ships first).
 *
 * @category errors
 */
export class HttpUnsupportedError extends Schema.TaggedErrorClass<HttpUnsupportedError>()(
  "McpHttpUnsupportedError",
  {
    code: Schema.tag("mcp.http_unsupported"),
    message: Schema.tag("Honk does not support HTTP MCP servers yet."),
    server: Schema.NonEmptyString,
  },
) {}

/**
 * OAuth stages in with HTTP transports; until then the pair rejects rather
 * than vanishing from the SDK type.
 *
 * @category errors
 */
export class OauthUnsupportedError extends Schema.TaggedErrorClass<OauthUnsupportedError>()(
  "McpOauthUnsupportedError",
  {
    code: Schema.tag("mcp.oauth_unsupported"),
    message: Schema.tag("Honk does not support MCP OAuth yet."),
  },
) {}

/**
 * The server process could not be started or initialized. `detail` carries
 * the underlying failure's message verbatim.
 *
 * @category errors
 */
export class ConnectError extends Schema.TaggedErrorClass<ConnectError>()("McpConnectError", {
  code: Schema.tag("mcp.connect_failed"),
  message: Schema.tag("Honk could not connect to this MCP server."),
  server: Schema.NonEmptyString,
  detail: Schema.String,
}) {}

/**
 * The wire form of every expected failure this domain owns, shared by every
 * RPC in this module — one union, as git's contract argues, so a client's
 * error handling does not fragment per method.
 *
 * `Workspace.NotFoundError` is in the union because MCP is scoped to a
 * trusted workspace: an unknown id fails on the trust gate before any config
 * file is read.
 *
 * @category errors
 */
export const Failure = Schema.Union([
  ServerNotFoundError,
  ServerExistsError,
  ServerDisabledError,
  HttpUnsupportedError,
  OauthUnsupportedError,
  ConnectError,
  Workspace.NotFoundError,
]);

/**
 * Every expected failure this domain owns, derived from {@link Failure} so the
 * type and the wire schema cannot list different members.
 *
 * Code branches on `error.code`, never on `error.message`.
 *
 * @category errors
 */
export type Error = typeof Failure.Type;

/** The stdio definition fields `add` and `update` accept. */
const definitionPayload = {
  workspaceId: Workspace.WorkspaceId,
  server: Schema.NonEmptyString,
  command: Schema.NonEmptyString,
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  cwd: Schema.optionalKey(Schema.NonEmptyString),
};

/**
 * Every configured server, merged across the shared files and the Honk
 * overrides. A pure config read: nothing starts.
 *
 * Rpc definitions are plain consts. Only the {@link Rpcs} group below uses
 * class-extends, so handlers and clients can reference one nominal group type.
 *
 * @category commands
 */
export const List = Rpc.make("mcp.list", {
  payload: { workspaceId: Workspace.WorkspaceId },
  success: ListOutput,
  error: Failure,
});

/**
 * Live connection state plus cached tool counts. Also a pure read: asking
 * what is running never starts anything.
 *
 * @category commands
 */
export const Status = Rpc.make("mcp.status", {
  payload: { workspaceId: Workspace.WorkspaceId },
  success: StatusOutput,
  error: Failure,
});

/**
 * Starts one server ahead of need, overriding laziness explicitly. Resolves
 * only after the server is connected and its tools are listed (core.md:
 * every method defines when success is true). Idempotent: connecting a
 * connected server is a no-op, never a second process.
 *
 * @category commands
 */
export const Connect = Rpc.make("mcp.connect", {
  payload: { workspaceId: Workspace.WorkspaceId, server: Schema.NonEmptyString },
  error: Failure,
});

/**
 * Stops one server's process. Not a removal: the definition stays, and a
 * later call that needs the server starts a fresh process.
 *
 * @category commands
 */
export const Disconnect = Rpc.make("mcp.disconnect", {
  payload: { workspaceId: Workspace.WorkspaceId, server: Schema.NonEmptyString },
  error: Failure,
});

/**
 * Defines a new server in this workspace's Honk override file. The shared
 * config files are never written.
 *
 * @category commands
 */
export const Add = Rpc.make("mcp.add", {
  payload: definitionPayload,
  error: Failure,
});

/**
 * Patches an existing server in the override file, leaving the shared file it
 * came from untouched. `command` (with `args`, `env`, `cwd`) replaces the
 * definition when present and preserves the current one when omitted, so a
 * `disabled` toggle alone never re-sends the definition. `disabled` omitted
 * preserves the current flag, `false` enables, `true` disables — and
 * disabling a connected server also disconnects it.
 *
 * @category commands
 */
export const Update = Rpc.make("mcp.update", {
  payload: {
    ...definitionPayload,
    command: Schema.optionalKey(Schema.NonEmptyString),
    disabled: Schema.optionalKey(Schema.Boolean),
  },
  error: Failure,
});

/**
 * Removes a server: an override-only definition is deleted, a shared-file one
 * is masked with a `removed` patch — either way its process stops first.
 *
 * @category commands
 */
export const Remove = Rpc.make("mcp.remove", {
  payload: { workspaceId: Workspace.WorkspaceId, server: Schema.NonEmptyString },
  error: Failure,
});

/**
 * @category commands
 */
export const Login = Rpc.make("mcp.login", {
  payload: { workspaceId: Workspace.WorkspaceId, server: Schema.NonEmptyString },
  error: Failure,
});

/**
 * @category commands
 */
export const Logout = Rpc.make("mcp.logout", {
  payload: { workspaceId: Workspace.WorkspaceId, server: Schema.NonEmptyString },
  error: Failure,
});

/**
 * The MCP command catalog, declared once. Everything else derives from this
 * record: the {@link Rpcs} group, the service {@link Interface}, and the
 * client namespace in `honk-core`.
 *
 * @category commands
 */
export const commands = {
  list: List,
  status: Status,
  connect: Connect,
  disconnect: Disconnect,
  add: Add,
  update: Update,
  remove: Remove,
  login: Login,
  logout: Logout,
};

/**
 * The MCP command group, derived from {@link commands}.
 *
 * @category commands
 */
export class Rpcs extends RpcGroup.make(...Object.values(commands)) {}

/**
 * The MCP service as in-process callers use it, derived from {@link commands}
 * so the service cannot drift from the wire contract. The proxy-tool runner
 * is a service-only addition with no RPC behind it.
 *
 * @category service
 */
export interface Interface extends ServiceOf<typeof commands> {
  /**
   * Runs one `mcp` proxy-tool call for a session bound to this workspace.
   *
   * Service-only: the session layer hands this to the harness as the one
   * static MCP tool. It never fails — a dead server, an unknown tool, an
   * unsupported transport all come back as text the model can act on.
   */
  readonly run: (input: {
    readonly workspaceId: Workspace.WorkspaceId;
    readonly params: ProxyArgs;
    readonly signal?: AbortSignal;
  }) => Effect.Effect<string>;
}

/** The proxy tool's arguments; the TypeBox schema in `./tool` is the source. */
export type ProxyArgs = ProxyToolArgs;

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Mcp from "./contract";
