/**
 * Pure parsing and merging of MCP server configuration, and the schemas of
 * the two files Honk persists per workspace — the override patch record and
 * the metadata cache. Each persisted shape is declared once, here; the
 * service derives its types from these schemas.
 *
 * Honk reads the standard files — the user-global `~/.config/mcp/mcp.json`,
 * then the project's `.mcp.json` — and never writes them. Honk-owned state
 * (a server disabled here, one added through settings) lives in an override
 * patch record persisted per workspace under the host data directory.
 *
 * The shared files are workspace- and user-controlled input, so parsing is
 * tolerant: a file that is not JSON, or an entry that is neither a command
 * nor a url, contributes no servers rather than failing the workspace.
 *
 * @module
 */

import { Option, Schema } from "effect";

/** A server Honk can start: a command spawned over stdio. */
export const StdioTransport = Schema.Struct({
  kind: Schema.tag("stdio"),
  command: Schema.NonEmptyString,
  args: Schema.Array(Schema.String),
  env: Schema.Record(Schema.String, Schema.String),
  cwd: Schema.optionalKey(Schema.NonEmptyString),
});
export type StdioTransport = typeof StdioTransport.Type;

/** A server behind a URL. Recognized so it can be listed, not yet connectable. */
export interface HttpTransport {
  readonly kind: "http";
  readonly url: string;
}

export type ServerTransport = StdioTransport | HttpTransport;

/** Which file a definition came from, after merging. */
export type ConfigSource = "global" | "project" | "override";

/** One server as the manager sees it: merged, attributed, and gated. */
export interface ServerDefinition {
  readonly name: string;
  readonly transport: ServerTransport;
  readonly source: ConfigSource;
  readonly disabled: boolean;
}

/**
 * One Honk-owned patch over the shared files: a definition added or replaced
 * here, a disabled flag, or a shared server hidden without touching its file.
 */
export const OverridePatch = Schema.Struct({
  definition: Schema.optionalKey(StdioTransport),
  disabled: Schema.optionalKey(Schema.Boolean),
  removed: Schema.optionalKey(Schema.Boolean),
});
export type OverridePatch = typeof OverridePatch.Type;

/** The Honk override file: a patch record, never a copy of the shared files. */
export const OverrideFile = Schema.Record(Schema.String, OverridePatch);
export type Overrides = typeof OverrideFile.Type;

/** One tool as the metadata cache knows it; `inputSchema` is the JSON Schema `listTools` returned. */
export const CachedTool = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.String,
  inputSchema: Schema.Unknown,
});
export type CachedTool = typeof CachedTool.Type;

/** One server's cached listing, valid only while `config` matches its definition. */
export const CacheEntry = Schema.Struct({
  config: Schema.String,
  tools: Schema.Array(CachedTool),
});
export type CacheEntry = typeof CacheEntry.Type;

/** The metadata cache file: one cached listing per server name. */
export const CacheFile = Schema.Record(Schema.String, CacheEntry);

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);
const StdioConfigEntry = Schema.Struct({
  command: Schema.NonEmptyString,
  args: Schema.optionalKey(Schema.Unknown),
  env: Schema.optionalKey(Schema.Unknown),
  cwd: Schema.optionalKey(Schema.Unknown),
});
const HttpConfigEntry = Schema.Struct({ url: Schema.NonEmptyString });
const ConfigFile = Schema.Struct({ mcpServers: UnknownRecord });

const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecord);
const decodeStdioConfigEntry = Schema.decodeUnknownOption(StdioConfigEntry);
const decodeHttpConfigEntry = Schema.decodeUnknownOption(HttpConfigEntry);
const decodeConfigFile = Schema.decodeUnknownOption(ConfigFile);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeNonEmptyString = Schema.decodeUnknownOption(Schema.NonEmptyString);
const decodeUnknownArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

const stringRecord = (value: unknown): Readonly<Record<string, string>> => {
  const decoded = decodeUnknownRecord(value);
  if (Option.isNone(decoded)) return {};
  const record: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(decoded.value)) {
    const entry = decodeString(candidate);
    if (Option.isSome(entry)) record[key] = entry.value;
  }
  return record;
};

const stringValues = (value: unknown): readonly string[] => {
  const decoded = decodeUnknownArray(value);
  if (Option.isNone(decoded)) return [];
  return decoded.value.flatMap((candidate) => {
    const entry = decodeString(candidate);
    return Option.isNone(entry) ? [] : [entry.value];
  });
};

/** One `mcpServers` entry, or nothing when it is neither form. */
const transportOf = (value: unknown): ServerTransport | undefined => {
  const stdio = decodeStdioConfigEntry(value);
  if (Option.isSome(stdio)) {
    const cwd = decodeNonEmptyString(stdio.value.cwd);
    return {
      kind: "stdio",
      command: stdio.value.command,
      args: stringValues(stdio.value.args),
      env: stringRecord(stdio.value.env),
      ...(Option.isNone(cwd) ? {} : { cwd: cwd.value }),
    };
  }
  return Option.match(decodeHttpConfigEntry(value), {
    onNone: () => undefined,
    onSome: ({ url }): HttpTransport => ({ kind: "http", url }),
  });
};

/**
 * Reads the standard `{ "mcpServers": { name: entry } }` shape out of one
 * file's text. Anything unreadable contributes nothing.
 */
export const parseConfigFile = (text: string): ReadonlyMap<string, ServerTransport> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Map();
  }
  const config = decodeConfigFile(parsed);
  if (Option.isNone(config)) return new Map();
  const servers = new Map<string, ServerTransport>();
  for (const [name, entry] of Object.entries(config.value.mcpServers)) {
    const transport = transportOf(entry);
    if (transport !== undefined) servers.set(name, transport);
  }
  return servers;
};

/**
 * Merges the two shared files and the Honk overrides into the definition map,
 * in the binding precedence: global, then project per server name, then the
 * override patches on top.
 */
export const mergeDefinitions = (input: {
  readonly global: ReadonlyMap<string, ServerTransport>;
  readonly project: ReadonlyMap<string, ServerTransport>;
  readonly overrides: Overrides;
}): ReadonlyMap<string, ServerDefinition> => {
  const merged = new Map<string, ServerDefinition>();
  for (const [name, transport] of input.global) {
    merged.set(name, { name, transport, source: "global", disabled: false });
  }
  for (const [name, transport] of input.project) {
    merged.set(name, { name, transport, source: "project", disabled: false });
  }
  for (const [name, patch] of Object.entries(input.overrides)) {
    const shared = merged.get(name);
    if (patch.removed === true) {
      merged.delete(name);
      continue;
    }
    const transport = patch.definition ?? shared?.transport;
    if (transport === undefined) continue;
    merged.set(name, {
      name,
      transport,
      source: patch.definition === undefined ? (shared?.source ?? "override") : "override",
      disabled: patch.disabled === true,
    });
  }
  return merged;
};

/**
 * The cache-validity key: a stdio transport serialized field by field. A
 * cached tool listing counts only while the definition that produced it is
 * byte-identical, so a changed command or env invalidates without a version
 * counter.
 */
export const transportKey = (transport: StdioTransport): string =>
  JSON.stringify([
    transport.command,
    transport.args,
    Object.entries(transport.env).sort(([a], [b]) => (a < b ? -1 : 1)),
    transport.cwd ?? null,
  ]);
