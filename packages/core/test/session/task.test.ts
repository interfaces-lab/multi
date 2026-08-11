// Delegation end to end on the faux provider: a primary's task tool opens a
// linked session, runs the preset arm to settlement, and returns the child's
// answer as the tool result. Refusals teach, the budget clips, and the link
// is durable data any surface can read.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Schema } from "effect";

import { createHonkCore } from "../../src/honk-core";
import { Session } from "../../src/session";
import { RESULT_BUDGET } from "../../src/session/delegation";
import { fusionOf } from "../../src/session/fusion";
import {
  createExecutionEnv,
  gatedResponse,
  makeFauxSessionLayer,
  openTrustedWorkspace,
} from "../../src/testing";

/** The child session each task result names in its `details`, in order. */
const TaskResultDetails = Schema.Struct({ sessionId: Schema.String });
const decodeTaskResultDetails = Schema.decodeUnknownOption(TaskResultDetails);

const taskResultSessionIds = (entries: readonly Session.SessionTreeEntry[]): readonly string[] =>
  entries.flatMap((entry) => {
    if (entry.type !== "message" || entry.message.role !== "toolResult") return [];
    if (entry.message.toolName !== "task") return [];
    return Option.match(decodeTaskResultDetails(entry.message.details), {
      onNone: () => [],
      onSome: ({ sessionId }) => [sessionId],
    });
  });

const toolResultTexts = (entries: readonly Session.SessionTreeEntry[]): readonly string[] =>
  entries.flatMap((entry) => {
    if (entry.type !== "message" || entry.message.role !== "toolResult") return [];
    return entry.message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
  });

describe("task delegation", () => {
  it.effect("a preset delegation answers the parent and leaves a durable linked session", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer({ presets: "faux" });
      faux.setResponses([
        fauxAssistantMessage([
          fauxToolCall("task", { subagent_type: "review", prompt: "inspect the diff" }),
        ]),
        fauxAssistantMessage("child: the diff is fine"),
        fauxAssistantMessage("parent: done"),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        yield* session.prompt({ sessionId: id, text: "review this" });

        // The child's answer came back as the task tool's result.
        const state = yield* session.reload({ sessionId: id });
        const results = toolResultTexts(state.entries);
        expect(results.some((text) => text.includes("child: the diff is fine"))).toBe(true);

        // The linked session is real, stored, and marked at birth.
        const listed = yield* session.list({});
        expect(listed.sessions).toHaveLength(2);
        const linked = listed.sessions.find((summary) => summary.delegation !== undefined);
        if (linked === undefined) throw new Error("expected a delegation-owned session");
        expect(linked.delegation).toEqual({ delegationOf: id, role: "review" });

        // The settled tool result names that session in its details, so a
        // delegation row links to the child transcript by id rather than by
        // guessing from the role.
        expect(taskResultSessionIds(state.entries)).toEqual([linked.id]);

        // Its transcript holds the delegated prompt and the child's answer.
        const child = yield* session.reload({ sessionId: linked.id });
        const texts = child.entries.flatMap((entry) =>
          entry.type === "message" ? [JSON.stringify(entry.message)] : [],
        );
        expect(texts.some((text) => text.includes("inspect the diff"))).toBe(true);
        expect(texts.some((text) => text.includes("child: the diff is fine"))).toBe(true);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("an unknown target is refused with the valid list and opens nothing", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer({ presets: "faux" });
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task", { subagent_type: "nope", prompt: "anything" })]),
        fauxAssistantMessage("parent: understood"),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        yield* session.prompt({ sessionId: id, text: "delegate wrongly" });

        const state = yield* session.reload({ sessionId: id });
        const results = toolResultTexts(state.entries);
        const refusal = results.find((text) => text.includes("unknown subagent_type"));
        if (refusal === undefined) throw new Error("expected the teaching refusal");
        expect(refusal).toContain('"nope"');
        expect(refusal).toContain("review");
        expect(refusal).toContain("oracle");

        const listed = yield* session.list({});
        expect(listed.sessions).toHaveLength(1);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("an over-budget child answer returns clipped, pointing at the transcript", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer({ presets: "faux" });
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task", { subagent_type: "oracle", prompt: "think" })]),
        fauxAssistantMessage("y".repeat(RESULT_BUDGET + 500)),
        fauxAssistantMessage("parent: done"),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        yield* session.prompt({ sessionId: id, text: "think hard" });

        const state = yield* session.reload({ sessionId: id });
        const clipped = toolResultTexts(state.entries).find((text) =>
          text.includes("full transcript remains in its session"),
        );
        if (clipped === undefined) throw new Error("expected a clipped result");
        expect(clipped.length).toBeLessThan(RESULT_BUDGET + 300);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("fusion delegations reuse one persistent sidekick", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer({ presets: "faux" });
      faux.setResponses([
        fauxAssistantMessage([
          fauxToolCall("task", { subagent_type: "sidekick", prompt: "step one" }),
        ]),
        fauxAssistantMessage("sidekick: one done"),
        fauxAssistantMessage("parent: next"),
        fauxAssistantMessage([
          fauxToolCall("task", { subagent_type: "general", prompt: "step two" }),
        ]),
        fauxAssistantMessage("sidekick: two done"),
        fauxAssistantMessage("parent: done"),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id, fusion: "low" });

        // The marker is durable from birth.
        const created = yield* session.reload({ sessionId: id });
        expect(fusionOf(created.entries)).toBe("low");

        // Two delegations, one sidekick — the second one an invented name,
        // coerced loudly.
        yield* session.prompt({ sessionId: id, text: "delegate one" });
        yield* session.prompt({ sessionId: id, text: "delegate two" });

        const listed = yield* session.list({});
        const sidekicks = listed.sessions.filter(
          (summary) => summary.delegation?.role === "sidekick",
        );
        expect(sidekicks).toHaveLength(1);
        expect(listed.sessions).toHaveLength(2);

        // The persistent sidekick's transcript holds both delegated steps.
        const transcripts = yield* Effect.forEach(sidekicks, (summary) =>
          session
            .reload({ sessionId: summary.id })
            .pipe(Effect.map((state) => JSON.stringify(state.entries))),
        );
        const shared = transcripts.find(
          (text) => text.includes("step one") && text.includes("step two"),
        );
        expect(shared).toBeDefined();
        // The coercion was loud in the parent's transcript.
        const parent = yield* session.reload({ sessionId: id });
        const coerced = JSON.stringify(parent.entries).includes("delegated to the paired sidekick");
        expect(coerced).toBe(true);

        // Reuse is visible in the results themselves: both calls name the
        // same child, which is a session this host can open.
        const named = taskResultSessionIds(parent.entries);
        expect(named).toHaveLength(2);
        expect(named[0]).toBe(named[1]);
        expect(new Set(named)).toEqual(new Set(sidekicks.map((summary) => summary.id)));
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("choosing a single model exits fusion and closes the sidekick gate", () =>
    Effect.gen(function* () {
      const { faux, model, appLayer } = makeFauxSessionLayer({ presets: "faux" });
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task", { subagent_type: "sidekick", prompt: "late" })]),
        fauxAssistantMessage("parent: acknowledged"),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id, fusion: "medium" });

        yield* session.setModel({
          sessionId: id,
          model: { providerId: model.provider, modelId: model.id },
        });
        const state = yield* session.reload({ sessionId: id });
        expect(fusionOf(state.entries)).toBeNull();

        // The gate reads the transcript, so the sidekick refuses immediately.
        yield* session.prompt({ sessionId: id, text: "delegate after exit" });
        const after = yield* session.reload({ sessionId: id });
        expect(JSON.stringify(after.entries)).toContain("unknown subagent_type");
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("fusion excludes the single-model options, typed", () =>
    Effect.gen(function* () {
      const { model, appLayer } = makeFauxSessionLayer({ presets: "faux" });

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const error = yield* session
          .create({
            workspaceId: workspace.id,
            fusion: "low",
            model: { providerId: model.provider, modelId: model.id },
          })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(Session.CreateChoiceError);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("aborting the delegating turn aborts the child harness", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer({ presets: "faux" });
      const { response } = gatedResponse("child: never released");
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task", { subagent_type: "review", prompt: "hang" })]),
        response,
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        const run = yield* session
          .prompt({ sessionId: id, text: "delegate and hang" })
          .pipe(Effect.forkScoped);
        // "Mid-delegation" as a program point: the linked child exists and
        // its turn holds the gated response. Wall-clock waits, because
        // it.effect's TestClock would park Effect.sleep forever.
        let childRunning = false;
        while (!childRunning) {
          const listed = yield* session.list({});
          const child = listed.sessions.find((summary) => summary.delegation !== undefined);
          childRunning = child?.phase === "turn";
          if (!childRunning) {
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
          }
        }

        // Without the task tool's signal wiring this abort hangs: the parent
        // waits for its tools, and nobody has told the child to stop.
        yield* session.abort({ sessionId: id });
        yield* Fiber.join(run);

        const listed = yield* session.list({});
        for (const summary of listed.sessions) expect(summary.phase).toBe("idle");
        const state = yield* session.reload({ sessionId: id });
        expect(JSON.stringify(state.entries)).toContain("delegation failed");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it("a stop whose arms no longer resolve fails restoration typed", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-fusion-data-"));
    const workspaceDirectory = await mkdtemp(join(tmpdir(), "honk-fusion-ws-"));

    // Faux model ids are stable across provider instances, so an arm built
    // from one probe names the model every life's collection carries.
    const probe = fauxProvider().getModel();
    const fauxArm: Session.Arm = {
      model: { providerId: probe.provider, modelId: probe.id },
      thinkingLevel: "low",
    };
    const fauxPairings: readonly Session.Pairing[] = [
      { stop: "low", main: fauxArm, sidekick: { ...fauxArm, thinkingLevel: "medium" } },
    ];

    const startCore = async (pairings?: readonly Session.Pairing[]) => {
      const faux = fauxProvider();
      const collection = createModels();
      collection.setProvider(faux.provider);
      return createHonkCore({
        dataDirectory,
        createModels: () => collection,
        generateSessionTitle: Session.generatePromptSessionTitle,
        createExecutionEnv,
        ...(pairings === undefined ? {} : { pairings }),
      });
    };

    // First life: a fusion session on a stop this host's arms can seat.
    const first = await startCore(fauxPairings);
    const sdk1 = first.client();
    await sdk1.workspace.trust({ directory: workspaceDirectory });
    const opened = await sdk1.workspace.open({ directory: workspaceDirectory });
    if (opened.type !== "ready") throw new Error("expected a ready workspace after trust");
    const session = await sdk1.session.create({ workspaceId: opened.id, fusion: "low" });
    await first.close();

    // Second life: the shipped seating's low arms name providers this faux
    // host cannot resolve, so restoration fails typed instead of silently
    // seating a different machine.
    const second = await startCore();
    const sdk2 = second.client();
    await expect(sdk2.session.reload({ sessionId: session.id })).rejects.toThrow(
      /does not know this provider/,
    );
    await second.close();

    // Third life: matching arms again, and the same session restores.
    const third = await startCore(fauxPairings);
    const sdk3 = third.client();
    const state = await sdk3.session.reload({ sessionId: session.id });
    expect(fusionOf(state.entries)).toBe("low");
    await third.close();
  });

  it.effect("without resolvable presets a session gets no task tool", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("task", { subagent_type: "review", prompt: "x" })]),
        fauxAssistantMessage("parent: recovered"),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        // The shipped catalog's arms do not resolve on the faux host, so the
        // harness was built without `task` and Pi reports the unknown tool.
        yield* session.prompt({ sessionId: id, text: "try to delegate" });
        const state = yield* session.reload({ sessionId: id });
        expect(toolResultTexts(state.entries).length).toBeGreaterThan(0);
        const listed = yield* session.list({});
        expect(listed.sessions).toHaveLength(1);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );
});
