// The pure config layer: parsing the standard mcp.json shape, the merge
// precedence (global, then project, then Honk overrides), and the cache
// validity key. Behavior over live servers is test/mcp/lifecycle.test.ts and
// tool.test.ts; the wire surface is rpc.test.ts.

import { describe, expect, it } from "vitest";

import {
  mergeDefinitions,
  parseConfigFile,
  transportKey,
  type StdioTransport,
} from "../../src/mcp";

const stdio = (command: string): StdioTransport => ({
  kind: "stdio",
  command,
  args: [],
  env: {},
});

describe("parseConfigFile", () => {
  it("reads command and url entries from the standard shape", () => {
    const servers = parseConfigFile(
      JSON.stringify({
        mcpServers: {
          files: { command: "mcp-files", args: ["--root", "."], env: { DEBUG: "1" }, cwd: "/x" },
          web: { url: "https://example.com/mcp" },
        },
      }),
    );
    expect(servers.get("files")).toEqual({
      kind: "stdio",
      command: "mcp-files",
      args: ["--root", "."],
      env: { DEBUG: "1" },
      cwd: "/x",
    });
    expect(servers.get("web")).toEqual({ kind: "http", url: "https://example.com/mcp" });
  });

  it("defaults args and env, and skips entries that are neither form", () => {
    const servers = parseConfigFile(
      JSON.stringify({
        mcpServers: {
          bare: { command: "srv" },
          broken: { commandeer: "nope" },
          alsoBroken: 42,
        },
      }),
    );
    expect(servers.get("bare")).toEqual({ kind: "stdio", command: "srv", args: [], env: {} });
    expect(servers.size).toBe(1);
  });

  it("treats unparseable or wrongly shaped files as empty", () => {
    expect(parseConfigFile("not json").size).toBe(0);
    expect(parseConfigFile(JSON.stringify({ servers: {} })).size).toBe(0);
    expect(parseConfigFile(JSON.stringify([1, 2])).size).toBe(0);
  });
});

describe("mergeDefinitions", () => {
  it("lets the project file win over the global file per server name", () => {
    const merged = mergeDefinitions({
      global: new Map([
        ["shared", stdio("global-version")],
        ["global-only", stdio("global-only")],
      ]),
      project: new Map([["shared", stdio("project-version")]]),
      overrides: {},
    });
    expect(merged.get("shared")?.transport).toEqual(stdio("project-version"));
    expect(merged.get("shared")?.source).toBe("project");
    expect(merged.get("global-only")?.source).toBe("global");
  });

  it("applies override patches: disable, add, replace, and mask", () => {
    const merged = mergeDefinitions({
      global: new Map([["masked", stdio("masked")]]),
      project: new Map([["shared", stdio("shared")]]),
      overrides: {
        shared: { disabled: true },
        added: { definition: stdio("added") },
        masked: { removed: true },
        replaced: { definition: stdio("wins") },
      },
    });
    expect(merged.get("shared")).toEqual({
      name: "shared",
      transport: stdio("shared"),
      source: "project",
      disabled: true,
    });
    expect(merged.get("added")).toEqual({
      name: "added",
      transport: stdio("added"),
      source: "override",
      disabled: false,
    });
    expect(merged.has("masked")).toBe(false);
    expect(merged.get("replaced")?.source).toBe("override");
  });

  it("ignores a patch that neither defines nor touches an existing server", () => {
    const merged = mergeDefinitions({
      global: new Map(),
      project: new Map(),
      overrides: { ghost: { disabled: true } },
    });
    expect(merged.size).toBe(0);
  });
});

describe("transportKey", () => {
  it("is stable under env key order and changes with any identity field", () => {
    const base: StdioTransport = {
      kind: "stdio",
      command: "srv",
      args: ["-v"],
      env: { A: "1", B: "2" },
    };
    expect(transportKey(base)).toBe(transportKey({ ...base, env: { B: "2", A: "1" } }));
    expect(transportKey(base)).not.toBe(transportKey({ ...base, command: "other" }));
    expect(transportKey(base)).not.toBe(transportKey({ ...base, args: [] }));
    expect(transportKey(base)).not.toBe(transportKey({ ...base, cwd: "/elsewhere" }));
  });
});
