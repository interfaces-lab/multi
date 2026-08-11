// Thinking level: Pi's reasoning-effort setting, modeled whole. Create records
// the chosen level, setThinkingLevel changes it at any moment of a run, and
// restoration replays the last record — through the harness, never a Honk
// copy of it.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Stream } from "effect";

import { createHonkCore } from "../../src/honk-core";
import { Session } from "../../src/session";
import { thinkingLevelOf } from "../../src/session/attribution";
import {
  createExecutionEnv,
  gatedResponse,
  makeFauxSessionLayer,
  messageEntries,
  openTrustedWorkspace,
} from "../../src/testing";

const levelRecords = (entries: readonly SessionTreeEntry[]) =>
  entries.filter((entry) => entry.type === "thinking_level_change");

describe("thinking level", () => {
  it.effect("create records the chosen level as Pi's own transcript entry", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({
          workspaceId: workspace.id,
          thinkingLevel: "high",
        });

        const state = yield* session.reload({ sessionId: id });
        expect(levelRecords(state.entries)).toMatchObject([{ thinkingLevel: "high" }]);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("omitted at create, no record is written and Pi's default applies", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        const state = yield* session.reload({ sessionId: id });
        expect(levelRecords(state.entries)).toHaveLength(0);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("setThinkingLevel while idle appends the record and emits Pi's update event", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({
          workspaceId: workspace.id,
          thinkingLevel: "low",
        });

        const update = yield* Deferred.make<{ level: string; previousLevel: string }>();
        const stream = yield* session.events({ sessionId: id });
        yield* stream.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type === "thinking_level_update") {
                yield* Deferred.succeed(update, {
                  level: event.level,
                  previousLevel: event.previousLevel,
                });
              }
            }),
          ),
          Effect.forkScoped,
        );

        yield* session.setThinkingLevel({ sessionId: id, thinkingLevel: "max" });
        expect(yield* Deferred.await(update)).toEqual({ level: "max", previousLevel: "low" });

        // Last record wins: this is exactly what restoration replays.
        const state = yield* session.reload({ sessionId: id });
        expect(thinkingLevelOf(state.entries)).toBe("max");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("mid-run set is not refused, and the record lands when the turn settles", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const { release, response } = gatedResponse("done thinking");
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

        const run = yield* session.prompt({ sessionId: id, text: "think" }).pipe(Effect.forkScoped);
        yield* Deferred.await(sawStart);

        // Changing effort mid-run is a supported Pi operation: no busy
        // refusal, and Pi buffers the durable record until settlement.
        yield* session.setThinkingLevel({ sessionId: id, thinkingLevel: "medium" });

        release();
        yield* Deferred.await(sawSettled);
        yield* Fiber.join(run);

        const state = yield* session.reload({ sessionId: id });
        expect(thinkingLevelOf(state.entries)).toBe("medium");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it("a restarted host replays the recorded level into the restored harness", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-thinking-data-"));
    const workspaceDirectory = await mkdtemp(join(tmpdir(), "honk-thinking-ws-"));

    const startCore = async () => {
      const faux = fauxProvider();
      const collection = createModels();
      collection.setProvider(faux.provider);
      const core = await createHonkCore({
        dataDirectory,
        createModels: () => collection,
        generateSessionTitle: Session.generatePromptSessionTitle,
        createExecutionEnv,
      });
      return { core, faux };
    };

    // First life: choose a level and converse once so the transcript is real.
    const first = await startCore();
    const sdk1 = first.core.client();
    await sdk1.workspace.trust({ directory: workspaceDirectory });
    const opened = await sdk1.workspace.open({ directory: workspaceDirectory });
    if (opened.type !== "ready") throw new Error("expected a ready workspace after trust");
    const session = await sdk1.session.create({
      workspaceId: opened.id,
      thinkingLevel: "xhigh",
    });
    first.faux.setResponses([fauxAssistantMessage("ok")]);
    await sdk1.session.prompt({ sessionId: session.id, text: "hello" });
    await first.core.close();

    // Second life: the restored harness must hold the recorded level — the
    // update event's previousLevel is the harness's own state, not a reread
    // of the transcript, so this proves restoration passed it through.
    const second = await startCore();
    const sdk2 = second.core.client();
    const events = sdk2.session.events({ sessionId: session.id });
    const sawPrevious = (async () => {
      for await (const frame of events) {
        if (frame.type === "event" && frame.event.type === "thinking_level_update") {
          return frame.event.previousLevel;
        }
      }
      return undefined;
    })();
    await sdk2.session.setThinkingLevel({ sessionId: session.id, thinkingLevel: "off" });
    expect(await sawPrevious).toBe("xhigh");
    await second.core.close();
  });

  it("a restarted host ignores a level record on the abandoned edit branch", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-branch-level-data-"));
    const workspaceDirectory = await mkdtemp(join(tmpdir(), "honk-branch-level-ws-"));

    const startCore = async () => {
      const faux = fauxProvider();
      const collection = createModels();
      collection.setProvider(faux.provider);
      const core = await createHonkCore({
        dataDirectory,
        createModels: () => collection,
        generateSessionTitle: Session.generatePromptSessionTitle,
        createExecutionEnv,
      });
      return { core, faux };
    };

    const first = await startCore();
    const sdk1 = first.core.client();
    await sdk1.workspace.trust({ directory: workspaceDirectory });
    const opened = await sdk1.workspace.open({ directory: workspaceDirectory });
    if (opened.type !== "ready") throw new Error("expected a ready workspace after trust");
    const session = await sdk1.session.create({ workspaceId: opened.id });
    first.faux.setResponses([fauxAssistantMessage("original"), fauxAssistantMessage("revised")]);
    await sdk1.session.prompt({ sessionId: session.id, text: "original question" });
    const original = messageEntries(
      (await sdk1.session.reload({ sessionId: session.id })).entries,
    )[0];
    if (original === undefined) throw new Error("missing original message");

    // This record belongs only to the soon-to-be-abandoned branch.
    await sdk1.session.setThinkingLevel({ sessionId: session.id, thinkingLevel: "high" });
    await sdk1.session.editMessage({
      sessionId: session.id,
      entryId: original.id,
      text: "revised question",
    });
    // Rebinding through Pi's public setter makes the inherited default
    // explicit on the revised branch; the abandoned `high` record is gone.
    expect(thinkingLevelOf((await sdk1.session.reload({ sessionId: session.id })).entries)).toBe(
      "off",
    );
    await first.core.close();

    const second = await startCore();
    const sdk2 = second.core.client();
    const events = sdk2.session.events({ sessionId: session.id });
    const sawPrevious = (async () => {
      for await (const frame of events) {
        if (frame.type === "event" && frame.event.type === "thinking_level_update") {
          return frame.event.previousLevel;
        }
      }
      return undefined;
    })();
    await sdk2.session.setThinkingLevel({ sessionId: session.id, thinkingLevel: "medium" });
    expect(await sawPrevious).toBe("off");
    await second.core.close();
  });

  it("an unrecognizable stored level is ignored rather than guessed at", () => {
    const record: SessionTreeEntry = {
      type: "thinking_level_change",
      id: "t1",
      parentId: null,
      timestamp: "2026-08-05T10:00:00.000Z",
      thinkingLevel: "galaxy-brain",
    };
    expect(thinkingLevelOf([record])).toBeUndefined();
  });
});
