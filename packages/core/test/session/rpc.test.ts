// The wire path: everything the desktop renderer needs must be reachable
// through the Rpc group alone, with no service access on the client side
// (experiment 4). In-process handler wiring and the full wire contract share
// this file because both prove the same boundary.

import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { Session } from "../../src/session";
import {
  gatedResponse,
  makeFauxSessionLayer,
  messageEntries,
  openTrustedWorkspace,
  textOf,
} from "../../src/testing";
import { Workspace } from "../../src/workspace";

describe("session rpc handlers", () => {
  it.effect("walks create and prompt through an in-process client", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("Hello over rpc")]);
      // provideMerge on purpose: the test needs the rpc handlers and the same
      // Session.Service instance (for the service-only reload) in one context.
      const handlers = Session.rpcLayer.pipe(Layer.provideMerge(appLayer));

      const program = Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Session.Rpcs);
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");

        const { id } = yield* client["session.create"]({ workspaceId: workspace.id });
        yield* client["session.prompt"]({ sessionId: id, text: "Say hello" });

        const state = yield* session.reload({ sessionId: id });
        const messages = messageEntries(state.entries);
        expect(textOf(messages[1])).toBe("Hello over rpc");
      });

      yield* program.pipe(Effect.provide(handlers));
    }),
  );

  it.effect("rejects an unknown session with the typed NotFoundError", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();
      const handlers = Session.rpcLayer.pipe(Layer.provideMerge(appLayer));

      const program = Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Session.Rpcs);
        const error = yield* client["session.prompt"]({
          sessionId: Session.SessionId.make("missing"),
          text: "hi",
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(Session.NotFoundError);
        expect(error.code).toBe("session.not_found");
      });

      yield* program.pipe(Effect.provide(handlers));
    }),
  );
});

describe("session wire contract: create, prompt, reload, live events", () => {
  it.effect("reload over the wire returns the committed transcript and run phase", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("Hello over the wire")]);
      const handlers = Session.rpcLayer.pipe(Layer.provideMerge(appLayer));

      const program = Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Session.Rpcs);
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-rpc-tests");

        const { id } = yield* client["session.create"]({ workspaceId: workspace.id });
        yield* client["session.prompt"]({ sessionId: id, text: "Say hello" });

        const state = yield* client["session.reload"]({ sessionId: id });
        expect(state.phase).toBe("idle");
        const messages = messageEntries(state.entries);
        expect(messages.map((entry) => entry.message.role)).toEqual(["user", "assistant"]);
        expect(textOf(messages[0])).toBe("Say hello");
        expect(textOf(messages[1])).toBe("Hello over the wire");
      });

      yield* program.pipe(Effect.provide(handlers));
    }),
  );

  it.effect("events over the wire: the live head frame makes listen-then-read deterministic", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const { release, response } = gatedResponse("Hello over the wire");
      faux.setResponses([response]);
      const handlers = Session.rpcLayer.pipe(Layer.provideMerge(appLayer));

      const program = Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Session.Rpcs);
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-rpc-tests");
        const { id } = yield* client["session.create"]({ workspaceId: workspace.id });

        const seen: string[] = [];
        const live = yield* Deferred.make<void>();
        const sawStart = yield* Deferred.make<void>();
        const sawSettled = yield* Deferred.make<void>();
        yield* client["session.events"]({ sessionId: id }).pipe(
          Stream.runForEach((frame) =>
            Effect.gen(function* () {
              seen.push(frame.type === "event" ? frame.event.type : frame.type);
              if (frame.type === "live") {
                yield* Deferred.succeed(live, undefined);
              } else if (frame.event.type === "agent_start") {
                yield* Deferred.succeed(sawStart, undefined);
              } else if (frame.event.type === "settled") {
                yield* Deferred.succeed(sawSettled, undefined);
              }
            }),
          ),
          Effect.forkScoped,
        );

        // The wire version of spec section 9 "start listening, then read":
        // once the head frame arrives, the server-side subscription is live,
        // so no event published after this point can be missed.
        yield* Deferred.await(live);

        const run = yield* client["session.prompt"]({ sessionId: id, text: "Say hello" }).pipe(
          Effect.forkScoped,
        );
        yield* Deferred.await(sawStart);

        // Reload mid-run: authoritative read while events keep flowing.
        const during = yield* client["session.reload"]({ sessionId: id });
        expect(during.phase).toBe("turn");

        release();
        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        const after = yield* client["session.reload"]({ sessionId: id });
        expect(after.phase).toBe("idle");

        expect(seen[0]).toBe("live");
        expect(seen).toContain("agent_start");
        expect(seen).toContain("message_end");
        expect(seen).toContain("agent_end");
        expect(seen).toContain("settled");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(handlers));
    }),
  );

  it.effect("create and run-control RPCs preserve their typed refusal errors", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();
      const handlers = Session.rpcLayer.pipe(Layer.provideMerge(appLayer));

      const program = Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(Session.Rpcs);
        const missing = Session.SessionId.make("missing");

        const workspaceError = yield* client["session.create"]({
          workspaceId: Workspace.WorkspaceId.make("never-trusted"),
        }).pipe(Effect.flip);
        expect(workspaceError).toBeInstanceOf(Workspace.NotFoundError);

        const reloadError = yield* client["session.reload"]({ sessionId: missing }).pipe(
          Effect.flip,
        );
        expect(reloadError).toBeInstanceOf(Session.NotFoundError);
        expect(reloadError.code).toBe("session.not_found");

        // Streaming rpc errors surface when the stream is pulled.
        const eventsError = yield* client["session.events"]({ sessionId: missing }).pipe(
          Stream.runDrain,
          Effect.flip,
        );
        expect(eventsError).toBeInstanceOf(Session.NotFoundError);

        const abortError = yield* client["session.abort"]({ sessionId: missing }).pipe(Effect.flip);
        expect(abortError).toBeInstanceOf(Session.NotFoundError);

        const steerError = yield* client["session.steer"]({
          sessionId: missing,
          text: "redirect",
        }).pipe(Effect.flip);
        expect(steerError).toBeInstanceOf(Session.NotFoundError);

        const followUpError = yield* client["session.follow_up"]({
          sessionId: missing,
          text: "next",
        }).pipe(Effect.flip);
        expect(followUpError).toBeInstanceOf(Session.NotFoundError);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(handlers));
    }),
  );
});
