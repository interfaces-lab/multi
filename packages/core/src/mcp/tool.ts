/**
 * The one static `mcp` tool: the whole dynamic MCP world behind a proxy that
 * costs a few hundred tokens, so a server's ten thousand tokens of tool
 * definitions are never paid up front (spec/honk-built-ins.md section 8).
 *
 * Static on purpose, like the task tool: the description never enumerates
 * servers or tools — `mcp({ search })` is the discovery channel — so the
 * harness tool list never changes and the setTools recompute never fires.
 *
 * The tool is opaque to `Tools.writesOf` by construction: an unknown name
 * classifies opaque, so a turn that used it claims its whole checkpoint diff.
 *
 * @module
 */

import { type Static, Type } from "typebox";

import type { Workspace } from "../workspace";

const proxySchema = Type.Object({
  search: Type.Optional(
    Type.String({
      description: "Find tools across the configured MCP servers matching this text.",
    }),
  ),
  describe: Type.Optional(
    Type.String({ description: "Show one tool's full description and parameter schema." }),
  ),
  tool: Type.Optional(
    Type.String({
      description: 'Call this tool. Use "server/tool" to qualify when two servers share a name.',
    }),
  ),
  args: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Arguments for the tool call, matching its described schema.",
    }),
  ),
});
export type ProxyToolArgs = Static<typeof proxySchema>;

interface ProxyToolResult {
  readonly content: [{ readonly type: "text"; readonly text: string }];
  readonly details: undefined;
}

/**
 * Builds the proxy tool over a runner the session layer binds to its
 * workspace. The runner never rejects: every outcome — a dead server, an
 * unknown tool, an unsupported transport — is text the model can act on.
 */
export const makeProxyTool = (
  run: (args: ProxyToolArgs, signal: AbortSignal | undefined) => Promise<string>,
) => ({
  name: "mcp",
  label: "MCP",
  description:
    "Gateway to the workspace's MCP servers. mcp({ search }) finds tools, " +
    "mcp({ describe }) shows one tool's parameters, mcp({ tool, args }) calls it, " +
    "and mcp({}) reports server status.",
  parameters: proxySchema,
  execute: async (
    _toolCallId: string,
    params: ProxyToolArgs,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _context: { readonly env: Workspace.ExecutionEnv },
  ): Promise<ProxyToolResult> => ({
    content: [{ type: "text", text: await run(params, signal) }],
    details: undefined,
  }),
});
export type ProxyTool = ReturnType<typeof makeProxyTool>;
