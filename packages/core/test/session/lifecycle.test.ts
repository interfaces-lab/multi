// Experiment 1: one harness, one fake model, one prompt, one reload. Live
// events live in events.test.ts; run control in control.test.ts; the wire
// path in rpc.test.ts; per-turn changes in changes.test.ts.

import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, PubSub, Semaphore, Stream } from "effect";

// Through the SDK re-export on purpose: applications narrow Pi errors from
// @honk/core without their own Pi dependency.
import { AgentHarnessError } from "../../src/client";
import { Session } from "../../src/session";
import { runAdmittedPi } from "../../src/session/delegation";
import type { LiveSessionOwnership, SessionRegistryEntry } from "../../src/session/runtime";
import { closeLiveSession, makeSessionRegistry } from "../../src/session/runtime";
import {
  gatedResponse,
  makeFauxSessionLayer,
  messageEntries,
  openTrustedWorkspace,
  textOf,
} from "../../src/testing";

describe("session experiment 1: one harness, one fake model, one prompt, one reload", () => {
  it.effect("creates, prompts, and reloads the committed Pi transcript", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("Hello from faux")]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        yield* session.prompt({ sessionId: id, text: "Say hello" });

        const state = yield* session.reload({ sessionId: id });
        const messages = messageEntries(state.entries);
        const tail = yield* session.reload({
          sessionId: id,
          afterEntrySeq: state.entries.length - 1,
        });

        expect(messages.map((entry) => entry.message.role)).toEqual(["user", "assistant"]);
        expect(textOf(messages[0])).toBe("Say hello");
        expect(textOf(messages[1])).toBe("Hello from faux");
        expect(tail.entries).toHaveLength(1);
        expect(messageEntries(tail.entries).map((entry) => entry.message.role)).toEqual([
          "assistant",
        ]);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("reload is a read: it never executes work or changes the session", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("unused")]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        const before = yield* session.reload({ sessionId: id });
        const again = yield* session.reload({ sessionId: id });

        expect(messageEntries(before.entries)).toHaveLength(0);
        expect(again.entries).toEqual(before.entries);
        expect(faux.state.callCount).toBe(0);
        expect(faux.getPendingResponseCount()).toBe(1);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("reports running during a prompt and idle after Pi settles", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const { release, response } = gatedResponse("done");
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
          .prompt({ sessionId: id, text: "Say hello" })
          .pipe(Effect.forkScoped);

        yield* Deferred.await(sawStart);
        const during = yield* session.reload({ sessionId: id });
        expect(during.phase).toBe("turn");

        release();
        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        const after = yield* session.reload({ sessionId: id });
        expect(after.phase).toBe("idle");
        expect(messageEntries(after.entries).map((entry) => entry.message.role)).toEqual([
          "user",
          "assistant",
        ]);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("deleting a running session aborts it and closes its event stream", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer({
        // Resolve a different title while the harness is busy. Deletion must
        // close its lifecycle before that background write can land.
        generateTitle: () => Promise.resolve("Generated after deletion"),
      });
      const { response } = gatedResponse("never completes normally");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-delete-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });
        const sawStart = yield* Deferred.make<void>();
        const events = yield* session.events({ sessionId: id });
        const watching = yield* events.pipe(
          Stream.tap((event) =>
            event.type === "agent_start"
              ? Deferred.succeed(sawStart, undefined)
              : Effect.succeed(undefined),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        const prompting = yield* session
          .prompt({ sessionId: id, text: "keep running" })
          .pipe(Effect.forkScoped);

        yield* Deferred.await(sawStart);
        yield* session.delete({ sessionId: id });
        yield* Fiber.join(watching);
        yield* Fiber.await(prompting);

        expect((yield* session.list({})).sessions).toEqual([]);
        const error = yield* session.reload({ sessionId: id }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(Session.NotFoundError);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("prompt on an unknown session fails with the typed NotFoundError", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const error = yield* session
          .prompt({ sessionId: Session.SessionId.make("missing"), text: "hi" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Session.NotFoundError);
        if (error instanceof Session.NotFoundError) {
          expect(error.code).toBe("session.not_found");
          expect(error.sessionId).toBe("missing");
        }
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("a Pi refusal arrives as Pi's own error class, not a defect", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        // Steering an idle harness is Pi's own refusal: it must reach the
        // caller as the real AgentHarnessError instance with Pi's code, so
        // instanceof narrowing and Pi's code union keep working (invariant 9).
        const error = yield* session.steer({ sessionId: id, text: "turn left" }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(AgentHarnessError);
        if (error instanceof AgentHarnessError) expect(error.code).toBe("invalid_state");
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );
});

describe("live session ownership", () => {
  it.effect("concurrent registration keeps one runtime and closes every runtime once", () =>
    Effect.gen(function* () {
      const counts = [
        { abort: 0, unsubscribe: 0 },
        { abort: 0, unsubscribe: 0 },
      ];

      const run = Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeSessionRegistry<LiveSessionOwnership>(closeLiveSession);
          const opened = yield* Effect.forEach(counts, (count) =>
            Effect.gen(function* () {
              const events = yield* PubSub.unbounded<Session.AgentHarnessEvent>();
              return {
                events,
                lifecycle: { closed: false, activeRuns: 0, admission: Semaphore.makeUnsafe(1) },
                unsubscribe: () => {
                  count.unsubscribe += 1;
                },
                harness: {
                  abort: async () => {
                    count.abort += 1;
                  },
                },
              };
            }),
          );
          const sessionId = Session.SessionId.make("one-session");
          const winners = yield* Effect.all(
            opened.map((candidate) => registry.register(sessionId, candidate)),
            { concurrency: "unbounded" },
          );

          expect(winners[0]).toBe(winners[1]);
          expect(counts.reduce((sum, count) => sum + count.abort, 0)).toBe(1);
        }),
      );

      yield* run;
      expect(counts).toEqual([
        { abort: 1, unsubscribe: 1 },
        { abort: 1, unsubscribe: 1 },
      ]);
    }),
  );

  it.effect("deletion closes admission before a stale prompt can start", () =>
    Effect.gen(function* () {
      const registry = yield* makeSessionRegistry<SessionRegistryEntry>(() => Effect.void);
      const admission = Semaphore.makeUnsafe(1);
      const permitHeld = yield* Deferred.make<void>();
      const releasePermit = yield* Deferred.make<void>();
      const blocker = yield* admission
        .withPermit(
          Effect.gen(function* () {
            yield* Deferred.succeed(permitHeld, undefined);
            yield* Deferred.await(releasePermit);
          }),
        )
        .pipe(Effect.forkScoped);
      yield* Deferred.await(permitHeld);

      let started = false;
      const sessionId = Session.SessionId.make("closing-session");
      const opened: SessionRegistryEntry = {
        lifecycle: { closed: false, activeRuns: 0, admission },
      };
      yield* registry.register(sessionId, opened);
      const stalePrompt = yield* runAdmittedPi(
        opened.lifecycle,
        () => new Session.NotFoundError({ sessionId }),
        async () => {
          started = true;
        },
      ).pipe(Effect.forkScoped);

      expect(yield* registry.remove(sessionId)).toBe(opened);
      yield* Deferred.succeed(releasePermit, undefined);
      yield* Fiber.join(blocker);
      const error = yield* Fiber.join(stalePrompt).pipe(Effect.flip);

      expect(error).toBeInstanceOf(Session.NotFoundError);
      expect(started).toBe(false);
    }),
  );
});
