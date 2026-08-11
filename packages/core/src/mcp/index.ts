/**
 * MCP: one proxy tool over standard config.
 *
 * MCP tools never join the harness tool registry. The built-in registers
 * exactly one static `mcp` tool and the dynamic world lives behind it: a
 * server's tool definitions are discovered through `mcp({ search })` on
 * demand instead of costing every model turn up front. The harness tool list
 * therefore never changes, and the tool is opaque to `Tools.writesOf`, so a
 * turn that used it claims its whole checkpoint diff.
 *
 * Honk reads the standard config files — the user-global
 * `~/.config/mcp/mcp.json`, then the project's `.mcp.json` — only after
 * workspace trust, and never writes them. Honk-owned state (disabled flags,
 * servers added through settings) lives in an override file per workspace
 * under the host data directory, next to the metadata cache that answers
 * `search` and `describe` without a live connection.
 *
 * The module splits along its concerns:
 *
 * - `./config` — pure parsing and merging of the config files.
 * - `./contract` — schemas, typed errors, and the command catalog.
 * - `./tool` — the static proxy tool's schema and factory.
 * - `./service` — the per-workspace manager, process lifetime, and layers.
 *
 * Stdio transports ship first. HTTP transports and the OAuth pair
 * `login`/`logout` reject with their catalog code until they stage in.
 *
 * @example
 * ```ts
 * const { servers } = await sdk.mcp.list({ workspaceId });
 * await sdk.mcp.connect({ workspaceId, server: "github" });
 * ```
 *
 * @see spec/honk-built-ins.md section 8 for the contract and its invariants.
 * @module
 */

export * from "./config";
export * from "./contract";
export * from "./service";
export * from "./tool";

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Mcp from ".";
