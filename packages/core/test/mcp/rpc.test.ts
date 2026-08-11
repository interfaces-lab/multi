// The wire path: the same operations traveling through the RPC handlers,
// with the owning error classes surviving the trip.

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { Mcp } from "../../src/mcp";
import { createExecutionEnv } from "../../src/testing";
import { Workspace } from "../../src/workspace";
import { makeMcpFixture, openFixtureWorkspace } from "./fixture";

describe("mcp rpc handlers", () => {
  it.effect("list, add, and the staged-out rejections travel the wire path intact", () =>
    Effect.gen(function* () {
      const fixture = makeMcpFixture();
      fixture.writeProjectConfig({ alpha: fixture.fixtureServer("alpha") });
      const handlers = Mcp.rpcLayer.pipe(
        Layer.provideMerge(
          Mcp.defaultLayer({
            storage: fixture.storage,
            globalConfigDirectory: fixture.globalConfigDirectory,
          }).pipe(
            Layer.provideMerge(
              Workspace.defaultLayer({ createExecutionEnv, storage: fixture.storage }),
            ),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const workspaceId = yield* openFixtureWorkspace(fixture);
        const client = yield* RpcTest.makeClient(Mcp.Rpcs);

        yield* client["mcp.add"]({ workspaceId, server: "extra", command: "srv" });
        const listed = yield* client["mcp.list"]({ workspaceId });
        expect(listed.servers.map((server) => server.name)).toEqual(["alpha", "extra"]);

        const status = yield* client["mcp.status"]({ workspaceId });
        expect(status.servers).toHaveLength(2);

        const unknown = yield* client["mcp.connect"]({ workspaceId, server: "ghost" }).pipe(
          Effect.flip,
        );
        expect(unknown).toBeInstanceOf(Mcp.ServerNotFoundError);
        if (unknown instanceof Mcp.ServerNotFoundError) {
          expect(unknown.code).toBe("mcp.server_not_found");
          expect(unknown.server).toBe("ghost");
        }

        const login = yield* client["mcp.login"]({ workspaceId, server: "alpha" }).pipe(
          Effect.flip,
        );
        expect(login).toBeInstanceOf(Mcp.OauthUnsupportedError);
        if (login instanceof Mcp.OauthUnsupportedError) {
          expect(login.code).toBe("mcp.oauth_unsupported");
        }
      }).pipe(Effect.provide(handlers));
    }),
  );
});
