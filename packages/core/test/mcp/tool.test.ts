// The `mcp` proxy tool's behavior through Mcp.Service.run: discovery over
// the metadata cache, lazy per-server connection, the call round-trip, and
// the never-reject discipline. Process lifetime is lifecycle.test.ts.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Mcp } from "../../src/mcp";
import { Workspace } from "../../src/workspace";
import { makeMcpFixture, type McpFixture, openFixtureWorkspace } from "./fixture";

/** Runs one proxy call in a fixture world. */
const proxy = (fixture: McpFixture, params: Mcp.ProxyArgs) =>
  fixture.world(
    Effect.gen(function* () {
      const workspaceId = yield* openFixtureWorkspace(fixture);
      const mcp = yield* Mcp.Service;
      return yield* mcp.run({ workspaceId, params });
    }),
  );

const twoServers = () => {
  const fixture = makeMcpFixture();
  fixture.writeProjectConfig({
    alpha: fixture.fixtureServer("alpha"),
    beta: fixture.fixtureServer("beta"),
  });
  return fixture;
};

describe("the mcp proxy tool", () => {
  it.effect("search connects only cache-missing servers, then answers cold from disk", () =>
    Effect.gen(function* () {
      const fixture = twoServers();
      const first = yield* proxy(fixture, { search: "echo" });
      expect(first).toContain("alpha/echo");
      expect(first).toContain("beta/beta_echo");
      // The cold search had no cache, so both servers started once to build it.
      expect(fixture.bootsOf("alpha")).toHaveLength(1);
      expect(fixture.bootsOf("beta")).toHaveLength(1);

      // A fresh world over the same stores: the cache file answers and
      // nothing starts — the marker files gain no lines.
      const second = yield* proxy(fixture, { search: "offered only by the beta" });
      expect(second).toContain("beta/beta_echo");
      expect(second).not.toContain("alpha/echo");
      expect(fixture.bootsOf("alpha")).toHaveLength(1);
      expect(fixture.bootsOf("beta")).toHaveLength(1);

      const none = yield* proxy(fixture, { search: "no such capability anywhere" });
      expect(none).toContain("No MCP tools matching");
    }),
  );

  it.effect("a qualified call connects that server only and round-trips the result", () =>
    Effect.gen(function* () {
      const fixture = twoServers();
      const answer = yield* proxy(fixture, { tool: "alpha/echo", args: { text: "hi" } });
      expect(answer).toBe("alpha:hi");
      expect(fixture.bootsOf("alpha")).toHaveLength(1);
      expect(fixture.bootsOf("beta")).toEqual([]);
    }),
  );

  it.effect("plain names resolve when unique and ask to qualify when shared", () =>
    Effect.gen(function* () {
      const fixture = twoServers();
      yield* proxy(fixture, { search: "echo" });
      const unique = yield* proxy(fixture, { tool: "beta_echo", args: { text: "x" } });
      expect(unique).toBe("beta:x");
      const shared = yield* proxy(fixture, { tool: "echo", args: { text: "x" } });
      expect(shared).toContain("alpha/echo");
      expect(shared).toContain("beta/echo");
    }),
  );

  it.effect("describe and bare status answer from the cache without starting anything", () =>
    Effect.gen(function* () {
      const fixture = twoServers();
      yield* proxy(fixture, { search: "echo" });
      const bootsBefore = fixture.bootsOf("alpha").length;

      const described = yield* proxy(fixture, { describe: "alpha/alpha_echo" });
      expect(described).toContain("offered only by the alpha server");
      expect(described).toContain("Parameters:");
      expect(described).toContain('"type":"object"');

      const unknown = yield* proxy(fixture, { describe: "nonsense" });
      expect(unknown).toContain('Unknown MCP tool "nonsense"');

      const status = yield* proxy(fixture, {});
      expect(status).toContain("alpha: not connected, 2 tools cached");
      expect(status).toContain("beta: not connected, 2 tools cached");

      expect(fixture.bootsOf("alpha")).toHaveLength(bootsBefore);
    }),
  );

  it.effect("every failure comes back as text, never a rejection", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({
        alpha: fixture.fixtureServer("alpha"),
        web: { url: "https://example.com/mcp" },
        broken: { command: process.execPath, args: ["--eval", "process.exit(7)"] },
      });
      const missing = yield* proxy(fixture, { tool: "alpha/no_such_tool", args: {} });
      expect(missing).toContain("MCP tool call failed");
      const http = yield* proxy(fixture, { tool: "web/anything" });
      expect(http).toContain("does not support");
      const dead = yield* proxy(fixture, { tool: "broken/anything" });
      expect(dead).toContain("failed to start");
      const unknownServer = yield* proxy(fixture, { tool: "ghost/anything" });
      expect(unknownServer).toContain('Unknown MCP server "ghost"');
    }),
  );

  it.effect("an unknown workspace answers as text too", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      const answer = yield* fixture.world(
        Effect.gen(function* () {
          const mcp = yield* Mcp.Service;
          return yield* mcp.run({
            workspaceId: Workspace.WorkspaceId.make("never-trusted"),
            params: {},
          });
        }),
      );
      expect(answer).toContain("honk: mcp failed");
    }),
  );
});
