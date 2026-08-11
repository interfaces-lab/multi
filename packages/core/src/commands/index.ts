/**
 * Commands: the workspace's prompt templates, listed for a client and armed on
 * the harness.
 *
 * A command is a named markdown template the workspace author wrote, invoked
 * as `/name` with optional arguments. Pi holds them as harness resources and
 * runs one through `harness.promptFromTemplate(name, args)`; Honk lists them
 * so a composer's `/` menu can offer them, and runs one through
 * `sdk.session.runCommand`.
 *
 * Naming, once: the *Honk* command catalog is the RPC group every namespace
 * contributes to, and a *workspace* command is one of these templates. They
 * are different things that share a word. This namespace only ever means the
 * second.
 *
 * The module splits along its two concerns:
 *
 * - `./contract` — the summary schema and the command catalog.
 * - `./service` — the projection over `Resources.Service`, which owns the scan.
 *
 * @example
 * ```ts
 * const commands = await sdk.commands.list({ workspaceId });
 * await sdk.session.runCommand({ sessionId, name: "review", args: ["--staged"] });
 * ```
 *
 * @see spec/honk-built-ins.md section 6.
 * @module
 */

export * from "./contract";
export * from "./service";

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Commands from ".";
