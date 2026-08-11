// session.setModel: the mid-session half of the model contract. The
// reference resolves against the live catalog before the harness moves, the
// change is Pi's own model_change record, and restoration replays it.

import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Stream } from "effect";

import { Models } from "../../src/models";
import { Session } from "../../src/session";
import { modelOf } from "../../src/session/attribution";
import { gatedResponse, makeFauxSessionLayer, openTrustedWorkspace } from "../../src/testing";

describe("set model", () => {
  it.effect("an unknown reference fails typed and moves nothing", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        const error = yield* session
          .setModel({ sessionId: id, model: { providerId: "faux", modelId: "not-a-model" } })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(Models.UnknownModelError);

        // The transcript still records only the model create resolved.
        const state = yield* session.reload({ sessionId: id });
        expect(state.entries.filter((entry) => entry.type === "model_change")).toHaveLength(1);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("setting while idle records the change and emits Pi's update event", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const target = faux.getModel();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        const update = yield* Deferred.make<{ id: string; source: string }>();
        const stream = yield* session.events({ sessionId: id });
        yield* stream.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type === "model_update") {
                yield* Deferred.succeed(update, { id: event.model.id, source: event.source });
              }
            }),
          ),
          Effect.forkScoped,
        );

        yield* session.setModel({
          sessionId: id,
          model: { providerId: target.provider, modelId: target.id },
        });
        expect(yield* Deferred.await(update)).toEqual({ id: target.id, source: "set" });

        // Last record wins: this is what restoration replays.
        const state = yield* session.reload({ sessionId: id });
        expect(modelOf(state.entries)).toEqual({
          providerId: target.provider,
          modelId: target.id,
        });
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("mid-run set is not refused, and the record lands when the turn settles", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const target = faux.getModel();
      const { release, response } = gatedResponse("switched");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        const sawStart = yield* Deferred.make<void>();
        const sawSettled = yield* Deferred.make<void>();
        const stream = yield* session.events({ sessionId: id });
        yield* stream.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type === "agent_start") yield* Deferred.succeed(sawStart, undefined);
              if (event.type === "settled") yield* Deferred.succeed(sawSettled, undefined);
            }),
          ),
          Effect.forkScoped,
        );

        const run = yield* session
          .prompt({ sessionId: id, text: "switch" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(sawStart);

        yield* session.setModel({
          sessionId: id,
          model: { providerId: target.provider, modelId: target.id },
        });

        release();
        yield* Deferred.await(sawSettled);
        yield* Fiber.join(run);

        const state = yield* session.reload({ sessionId: id });
        const records = state.entries.filter((entry) => entry.type === "model_change");
        expect(records.length).toBeGreaterThanOrEqual(2);
        expect(modelOf(state.entries)).toEqual({
          providerId: target.provider,
          modelId: target.id,
        });
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );
});
