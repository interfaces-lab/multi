// Process lifetime against real stdio servers: the three spec section 8
// invariants — an unused server never starts, a reconnect or reopen never
// duplicates a process, killing the workspace kills its servers — plus the
// definition mutations and the staged-out transports. The proxy tool's
// behavior is tool.test.ts; the pure merge is config.test.ts.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Mcp } from "../../src/mcp";
import { makeMcpFixture, openFixtureWorkspace, processLives, waitForExit } from "./fixture";

describe("mcp lifecycle", () => {
  it.effect("starts nothing for a workspace that only lists and reads status", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({
        alpha: fixture.fixtureServer("alpha"),
        beta: fixture.fixtureServer("beta"),
      });
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          const listed = yield* mcp.list({ workspaceId });
          expect(listed.servers.map((server) => server.name)).toEqual(["alpha", "beta"]);
          const status = yield* mcp.status({ workspaceId });
          expect(status.servers).toEqual([
            { name: "alpha", connected: false, tools: 0 },
            { name: "beta", connected: false, tools: 0 },
          ]);
        }),
      );
      expect(fixture.bootsOf("alpha")).toEqual([]);
      expect(fixture.bootsOf("beta")).toEqual([]);
    }),
  );

  it.effect("shares one process across concurrent and repeated connects", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({
        alpha: fixture.fixtureServer("alpha"),
        beta: fixture.fixtureServer("beta"),
      });
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          yield* Effect.all(
            [
              mcp.connect({ workspaceId, server: "alpha" }),
              mcp.connect({ workspaceId, server: "alpha" }),
              mcp.connect({ workspaceId, server: "alpha" }),
            ],
            { concurrency: "unbounded" },
          );
          yield* mcp.connect({ workspaceId, server: "alpha" });
          const status = yield* mcp.status({ workspaceId });
          expect(status.servers).toEqual([
            { name: "alpha", connected: true, tools: 2 },
            { name: "beta", connected: false, tools: 0 },
          ]);
          expect(fixture.bootsOf("alpha")).toHaveLength(1);
          // Connecting alpha must not wake beta: laziness is per server.
          expect(fixture.bootsOf("beta")).toEqual([]);
        }),
      );
    }),
  );

  it.effect("disconnect stops the process and a later connect starts fresh", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({ alpha: fixture.fixtureServer("alpha") });
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          yield* mcp.connect({ workspaceId, server: "alpha" });
          const first = fixture.bootsOf("alpha")[0];
          expect(first).toBeDefined();
          yield* mcp.disconnect({ workspaceId, server: "alpha" });
          expect(yield* Effect.promise(() => waitForExit(first ?? -1))).toBe(true);
          const stopped = yield* mcp.status({ workspaceId });
          expect(stopped.servers[0]?.connected).toBe(false);
          yield* mcp.connect({ workspaceId, server: "alpha" });
          const boots = fixture.bootsOf("alpha");
          expect(boots).toHaveLength(2);
          expect(boots[1]).not.toBe(boots[0]);
        }),
      );
    }),
  );

  it.effect("closing the service scope kills every server it started", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({
        alpha: fixture.fixtureServer("alpha"),
        beta: fixture.fixtureServer("beta"),
      });
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          yield* mcp.connect({ workspaceId, server: "alpha" });
          yield* mcp.connect({ workspaceId, server: "beta" });
          expect(fixture.bootsOf("alpha").every(processLives)).toBe(true);
          expect(fixture.bootsOf("beta").every(processLives)).toBe(true);
        }),
      );
      // The world's scope closed with the servers still connected; the layer
      // finalizer is what ended them.
      for (const pid of [...fixture.bootsOf("alpha"), ...fixture.bootsOf("beta")]) {
        expect(yield* Effect.promise(() => waitForExit(pid))).toBe(true);
      }
    }),
  );

  it.effect("rejects http transports, oauth, unknown and disabled servers with catalog codes", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({
        alpha: fixture.fixtureServer("alpha"),
        web: { url: "https://example.com/mcp" },
      });
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          fixture.writeOverrides(workspaceId, { alpha: { disabled: true } });
          const mcp = yield* Mcp.Service;

          const http = yield* mcp.connect({ workspaceId, server: "web" }).pipe(Effect.flip);
          expect(http).toBeInstanceOf(Mcp.HttpUnsupportedError);
          if (http instanceof Mcp.HttpUnsupportedError)
            expect(http.code).toBe("mcp.http_unsupported");

          const login = yield* mcp.login({ workspaceId, server: "web" }).pipe(Effect.flip);
          expect(login).toBeInstanceOf(Mcp.OauthUnsupportedError);
          const logout = yield* mcp.logout({ workspaceId, server: "web" }).pipe(Effect.flip);
          expect(logout).toBeInstanceOf(Mcp.OauthUnsupportedError);

          const unknown = yield* mcp.connect({ workspaceId, server: "ghost" }).pipe(Effect.flip);
          expect(unknown).toBeInstanceOf(Mcp.ServerNotFoundError);

          const disabled = yield* mcp.connect({ workspaceId, server: "alpha" }).pipe(Effect.flip);
          expect(disabled).toBeInstanceOf(Mcp.ServerDisabledError);
          const listed = yield* mcp.list({ workspaceId });
          expect(listed.servers.find((server) => server.name === "alpha")?.disabled).toBe(true);
        }),
      );
      expect(fixture.bootsOf("alpha")).toEqual([]);
    }),
  );

  it.effect("fails a connect to a server that cannot start, typed", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({
        broken: { command: process.execPath, args: ["--eval", "process.exit(7)"] },
      });
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          const error = yield* mcp.connect({ workspaceId, server: "broken" }).pipe(Effect.flip);
          expect(error).toBeInstanceOf(Mcp.ConnectError);
          if (error instanceof Mcp.ConnectError) expect(error.code).toBe("mcp.connect_failed");
          // The failed start left no connection behind: a retry is allowed to
          // start fresh rather than joining a dead promise.
          const status = yield* mcp.status({ workspaceId });
          expect(status.servers[0]?.connected).toBe(false);
        }),
      );
    }),
  );

  it.effect("add, update, and remove write the override file and never the shared one", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({ alpha: fixture.fixtureServer("alpha") });
      const projectConfigBefore = JSON.stringify({
        mcpServers: { alpha: fixture.fixtureServer("alpha") },
      });
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;

          const gamma = fixture.fixtureServer("gamma");
          yield* mcp.add({
            workspaceId,
            server: "gamma",
            command: gamma.command,
            args: gamma.args,
          });
          const added = yield* mcp.list({ workspaceId });
          expect(added.servers.map((server) => [server.name, server.source])).toEqual([
            ["alpha", "project"],
            ["gamma", "override"],
          ]);

          const again = yield* mcp
            .add({ workspaceId, server: "gamma", command: gamma.command })
            .pipe(Effect.flip);
          expect(again).toBeInstanceOf(Mcp.ServerExistsError);

          const ghost = yield* mcp
            .update({ workspaceId, server: "ghost", command: "nope" })
            .pipe(Effect.flip);
          expect(ghost).toBeInstanceOf(Mcp.ServerNotFoundError);

          // Updating a shared server moves its definition into the override
          // layer; the project file stays untouched below.
          yield* mcp.update({
            workspaceId,
            server: "alpha",
            command: gamma.command,
            args: gamma.args,
          });
          const updated = yield* mcp.list({ workspaceId });
          expect(updated.servers.find((server) => server.name === "alpha")?.source).toBe(
            "override",
          );

          yield* mcp.remove({ workspaceId, server: "gamma" });
          yield* mcp.remove({ workspaceId, server: "alpha" });
          const removed = yield* mcp.list({ workspaceId });
          expect(removed.servers).toEqual([]);
        }),
      );
      // The shared project file was never rewritten; alpha's removal is a
      // mask in the override file, so a fresh world still sees it gone.
      const { readFileSync } = yield* Effect.promise(() => import("node:fs"));
      const { join } = yield* Effect.promise(() => import("node:path"));
      expect(readFileSync(join(fixture.workspaceDirectory, ".mcp.json"), "utf8")).toBe(
        projectConfigBefore,
      );
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          const listed = yield* mcp.list({ workspaceId });
          expect(listed.servers).toEqual([]);
        }),
      );
    }),
  );

  it.effect("concurrent adds for different servers both survive in the override file", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          yield* Effect.all(
            [
              mcp.add({ workspaceId, server: "one", command: "srv-one" }),
              mcp.add({ workspaceId, server: "two", command: "srv-two" }),
            ],
            { concurrency: "unbounded" },
          );
        }),
      );
      // A fresh world reads only the file: neither patch overwrote the other.
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          const listed = yield* mcp.list({ workspaceId });
          expect(listed.servers.map((server) => server.name)).toEqual(["one", "two"]);
        }),
      );
    }),
  );

  it.effect("update toggles disabled: it persists, gates connect, and re-enables", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({ alpha: fixture.fixtureServer("alpha") });
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          yield* mcp.connect({ workspaceId, server: "alpha" });
          // Disabling a connected server also disconnects it.
          yield* mcp.update({ workspaceId, server: "alpha", disabled: true });
          const status = yield* mcp.status({ workspaceId });
          expect(status.servers[0]?.connected).toBe(false);
        }),
      );
      const first = fixture.bootsOf("alpha")[0];
      expect(yield* Effect.promise(() => waitForExit(first ?? -1))).toBe(true);
      // A fresh manager reads the flag from the file and blocks the start.
      yield* fixture.world(
        Effect.gen(function* () {
          const workspaceId = yield* openFixtureWorkspace(fixture);
          const mcp = yield* Mcp.Service;
          const listed = yield* mcp.list({ workspaceId });
          expect(listed.servers[0]?.disabled).toBe(true);
          const blocked = yield* mcp.connect({ workspaceId, server: "alpha" }).pipe(Effect.flip);
          expect(blocked).toBeInstanceOf(Mcp.ServerDisabledError);
          if (blocked instanceof Mcp.ServerDisabledError) {
            expect(blocked.code).toBe("mcp.server_disabled");
          }
          // Re-enabling never re-sends the definition; the shared one serves.
          yield* mcp.update({ workspaceId, server: "alpha", disabled: false });
          yield* mcp.connect({ workspaceId, server: "alpha" });
          const status = yield* mcp.status({ workspaceId });
          expect(status.servers[0]?.connected).toBe(true);
        }),
      );
      // One boot before the disable, none while disabled, one after re-enable.
      expect(fixture.bootsOf("alpha")).toHaveLength(2);
    }),
  );
});
