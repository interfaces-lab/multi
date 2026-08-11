// Images on the three prompt verbs: an attachment rides prompt, steer, and
// follow-up alike, an attachment-only message is a real message, and a
// message carrying nothing at all is refused before it can restore a
// session.

import {
  AgentHarness,
  AgentHarnessError,
  InMemorySessionRepo,
  type MessageEntry,
  type SessionTreeEvent,
} from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Fiber,
  PubSub,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";

import { UnknownProviderError } from "../../src/models";
import { Session } from "../../src/session";
import { modelOf, thinkingLevelOf } from "../../src/session/attribution";
import { replaceMessage } from "../../src/session/message";
import { liveRuntimeOf, type LiveSession, readStableBranch } from "../../src/session/runtime";
import {
  gatedResponse,
  makeFauxSessionLayer,
  messageEntries,
  openTrustedWorkspace,
  textOf,
} from "../../src/testing";
import { Workspace } from "../../src/workspace";

// A one-pixel PNG: the smallest honest attachment.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const imagesOf = (entry: MessageEntry | undefined): readonly Session.PromptImage[] => {
  const message = entry?.message;
  if (message?.role !== "user" || !(message.content instanceof Array)) return [];
  return message.content.flatMap((block) =>
    block.type === "image" ? [{ data: block.data, mimeType: block.mimeType }] : [],
  );
};

it("round-trips committed edit failures through the RPC error schema", () => {
  const source = new Session.EditMessageCommittedError({
    stage: "settlement",
    reason: "checkpoint read failed",
  });
  const encoded = Schema.encodeUnknownSync(Session.EditMessage.errorSchema)(source);
  const decoded = Schema.decodeUnknownSync(Session.EditMessage.errorSchema)(encoded);

  expect(decoded).toBeInstanceOf(Session.EditMessageCommittedError);
  if (!(decoded instanceof Session.EditMessageCommittedError)) {
    throw new Error("expected the committed edit error to survive the wire codec");
  }
  expect(decoded.stage).toBe("settlement");
  expect(decoded.reason).toBe("checkpoint read failed");
});

it("bounds image media types and encoded size at the wire schema", () => {
  const decode = Schema.decodeUnknownSync(Session.PromptImage);
  const groups = Math.floor(Session.PROMPT_IMAGE_MAX_BYTES / 3);
  const exactLimit = `${"AAAA".repeat(groups)}AA==`;
  const overLimit = `${"AAAA".repeat(groups)}AAA=`;
  expect(decode({ data: PIXEL, mimeType: "image/png" })).toEqual({
    data: PIXEL,
    mimeType: "image/png",
  });
  expect(decode({ data: exactLimit, mimeType: "image/png" }).data).toHaveLength(
    Session.PROMPT_IMAGE_MAX_BASE64_LENGTH,
  );
  expect(() => decode({ data: overLimit, mimeType: "image/png" })).toThrow();
  expect(() => decode({ data: PIXEL, mimeType: "image/" })).toThrow();
  expect(() =>
    decode({
      data: "AAAA".repeat(Session.PROMPT_IMAGE_MAX_BASE64_LENGTH / 4 + 1),
      mimeType: "image/png",
    }),
  ).toThrow();
});

it("pairs a full branch with a cursor that cannot skip an overlapping append", async () => {
  const root: Session.SessionTreeEntry = {
    type: "custom",
    id: "root",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "test",
  };
  const revised = { ...root, id: "revised", parentId: root.id };
  let entryRead = 0;
  let branchRead = 0;

  const result = await readStableBranch({
    getLeafId: () => Promise.resolve("revised"),
    getEntries: () => {
      entryRead += 1;
      return Promise.resolve(entryRead === 1 ? [root] : [root, revised]);
    },
    getBranch: () => {
      branchRead += 1;
      return Promise.resolve(branchRead === 1 ? [root] : [root, revised]);
    },
  });

  expect(branchRead).toBe(2);
  expect(result).toEqual({ entries: [root, revised], entrySeq: 2 });
});

it("retries when navigation changes the leaf without changing append-log length", async () => {
  const root: Session.SessionTreeEntry = {
    type: "custom",
    id: "root",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "test",
  };
  const left = { ...root, id: "left", parentId: root.id };
  const right = { ...root, id: "right", parentId: root.id };
  let leafRead = 0;
  let branchRead = 0;

  const result = await readStableBranch({
    getLeafId: () => {
      leafRead += 1;
      return Promise.resolve(leafRead === 1 ? left.id : right.id);
    },
    getEntries: () => Promise.resolve([root, left, right]),
    getBranch: (leaf) => {
      branchRead += 1;
      return Promise.resolve(leaf === left.id ? [root, left] : [root, right]);
    },
  });

  expect(branchRead).toBe(2);
  expect(result).toEqual({ entries: [root, right], entrySeq: 3 });
});

describe("images on the prompt verbs", () => {
  it.effect("an attachment-only prompt is a real message: empty text, image stored", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("I see a pixel")]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        yield* session.prompt({
          sessionId: id,
          text: "",
          images: [{ data: PIXEL, mimeType: "image/png" }],
        });

        const after = yield* session.reload({ sessionId: id });
        const messages = messageEntries(after.entries);
        expect(imagesOf(messages[0])).toEqual([{ data: PIXEL, mimeType: "image/png" }]);
        expect(messages.map((entry) => entry.message.role)).toEqual(["user", "assistant"]);
        expect(after.phase).toBe("idle");
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("steer and follow-up carry images the same way prompt does", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const first = gatedResponse("First answer");
      faux.setResponses([first.response, fauxAssistantMessage("Second answer")]);

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

        const run = yield* session.prompt({ sessionId: id, text: "First" }).pipe(Effect.forkScoped);
        yield* Deferred.await(sawStart);

        yield* session.steer({
          sessionId: id,
          text: "look at this",
          images: [{ data: PIXEL, mimeType: "image/png" }],
        });
        yield* session.followUp({
          sessionId: id,
          text: "",
          images: [{ data: PIXEL, mimeType: "image/jpeg" }],
        });
        first.release();
        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        const after = yield* session.reload({ sessionId: id });
        const attached = messageEntries(after.entries).flatMap((entry) => [...imagesOf(entry)]);
        expect(attached).toEqual([
          { data: PIXEL, mimeType: "image/png" },
          { data: PIXEL, mimeType: "image/jpeg" },
        ]);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("a message with neither text nor an image is refused before any lookup", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        for (const empty of [
          session.prompt({ sessionId: id, text: "" }),
          session.steer({ sessionId: id, text: "", images: [] }),
          session.followUp({ sessionId: id, text: "" }),
        ]) {
          const error = yield* empty.pipe(Effect.flip);
          if (!(error instanceof Session.EmptyMessageError)) {
            throw new Error("expected the empty-message refusal");
          }
          expect(error.code).toBe("session.empty_message");
        }

        // Nothing ran, and nothing was appended — the steer above would
        // otherwise have failed with Pi's idle refusal instead.
        const after = yield* session.reload({ sessionId: id });
        expect(messageEntries(after.entries)).toHaveLength(0);

        // The refusal comes before the session lookup, so an empty message
        // never restores a session just to be turned away by it.
        const unknown = yield* session
          .prompt({ sessionId: Session.SessionId.make("never-created"), text: "" })
          .pipe(Effect.flip);
        expect(unknown).toBeInstanceOf(Session.EmptyMessageError);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );
});

describe("editing a user message", () => {
  it.effect("restores the exact leaf and live runtime when branch resolution fails", () =>
    Effect.gen(function* () {
      const { faux, collection, appLayer } = makeFauxSessionLayer({
        models: [
          { id: "faux-first", reasoning: true },
          { id: "faux-second", reasoning: true },
        ],
      });
      faux.setResponses([
        fauxAssistantMessage("Original answer"),
        fauxAssistantMessage("Later answer"),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const origin = yield* openTrustedWorkspace("/tmp/honk-session-edit-rollback-origin");
        const moved = yield* openTrustedWorkspace("/tmp/honk-session-edit-rollback-moved");
        const first = faux.models[0];
        const second = faux.models[1];
        if (second === undefined) return yield* Effect.die(new Error("missing second faux model"));
        const { id } = yield* session.create({
          workspaceId: origin.id,
          model: { providerId: first.provider, modelId: first.id },
        });
        yield* session.prompt({ sessionId: id, text: "Original question" });
        const original = messageEntries((yield* session.reload({ sessionId: id })).entries)[0];
        if (original === undefined) return yield* Effect.die(new Error("missing original message"));

        yield* session.setModel({
          sessionId: id,
          model: { providerId: second.provider, modelId: second.id },
        });
        yield* session.setThinkingLevel({ sessionId: id, thinkingLevel: "high" });
        yield* session.setWorkspace({ sessionId: id, workspaceId: moved.id });
        yield* session.prompt({ sessionId: id, text: "Later question" });
        const before = yield* session.reload({ sessionId: id });
        const previousLeaf = before.entries.at(-1)?.id;
        if (previousLeaf === undefined)
          return yield* Effect.die(new Error("missing previous leaf"));
        const restoredTree = yield* Deferred.make<SessionTreeEvent>();
        const events = yield* session.events({ sessionId: id });
        yield* events.pipe(
          Stream.runForEach((event) =>
            event.type === "session_tree" && event.newLeafId === previousLeaf
              ? Deferred.succeed(restoredTree, event)
              : Effect.void,
          ),
          Effect.forkScoped,
        );

        collection.deleteProvider(faux.provider.id);
        const error = yield* session
          .editMessage({ sessionId: id, entryId: original.id, text: "Revised question" })
          .pipe(Effect.flip);
        collection.setProvider(faux.provider);

        expect(error).toBeInstanceOf(UnknownProviderError);
        expect(error).not.toBeInstanceOf(Session.EditMessageCommittedError);
        expect((yield* Deferred.await(restoredTree)).oldLeafId).toBe(original.parentId);
        const after = yield* session.reload({ sessionId: id });
        expect(after.entries.map((entry) => entry.id)).toEqual(
          before.entries.map((entry) => entry.id),
        );
        expect(modelOf(after.entries)).toEqual({
          providerId: second.provider,
          modelId: second.id,
        });
        expect(thinkingLevelOf(after.entries)).toBe("high");
        expect((yield* session.get({ sessionId: id })).workspaceId).toBe(moved.id);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("rebinds model, thinking level, and workspace to the edited branch", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer({
        models: [
          { id: "faux-first", reasoning: true },
          { id: "faux-second", reasoning: true },
        ],
      });
      let requestedModel: string | undefined;
      let requestedReasoning: unknown;
      faux.setResponses([
        fauxAssistantMessage("Original answer"),
        fauxAssistantMessage("Later answer"),
        (_context, options, _state, model) => {
          requestedModel = model.id;
          requestedReasoning =
            options !== undefined && "reasoning" in options ? options.reasoning : undefined;
          return fauxAssistantMessage("Revised answer");
        },
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const origin = yield* openTrustedWorkspace("/tmp/honk-session-edit-runtime-origin");
        const moved = yield* openTrustedWorkspace("/tmp/honk-session-edit-runtime-moved");
        const first = faux.models[0];
        const second = faux.models[1];
        if (second === undefined) return yield* Effect.die(new Error("missing second faux model"));
        const { id } = yield* session.create({
          workspaceId: origin.id,
          model: { providerId: first.provider, modelId: first.id },
        });
        yield* session.prompt({ sessionId: id, text: "Original question" });
        const original = messageEntries((yield* session.reload({ sessionId: id })).entries)[0];
        if (original === undefined) return yield* Effect.die(new Error("missing original message"));

        yield* session.setModel({
          sessionId: id,
          model: { providerId: second.provider, modelId: second.id },
        });
        yield* session.setThinkingLevel({ sessionId: id, thinkingLevel: "high" });
        yield* session.setWorkspace({ sessionId: id, workspaceId: moved.id });
        yield* session.prompt({ sessionId: id, text: "Later question" });

        yield* session.editMessage({
          sessionId: id,
          entryId: original.id,
          text: "Revised question",
        });

        const revised = yield* session.reload({ sessionId: id });
        expect(requestedModel).toBe(first.id);
        expect(requestedReasoning).toBeUndefined();
        expect(modelOf(revised.entries)).toEqual({
          providerId: first.provider,
          modelId: first.id,
        });
        expect(thinkingLevelOf(revised.entries)).toBe("off");
        expect((yield* session.get({ sessionId: id })).workspaceId).toBe(origin.id);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("applies a selected model and thinking level on the new sibling branch", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer({
        models: [
          { id: "faux-first", reasoning: true },
          { id: "faux-second", reasoning: true },
        ],
      });
      let requestedModel: string | undefined;
      faux.setResponses([
        fauxAssistantMessage("Original answer"),
        (_context, _options, _state, model) => {
          requestedModel = model.id;
          return fauxAssistantMessage("Revised answer");
        },
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-edit-selected-model");
        const first = faux.models[0];
        const second = faux.models[1];
        if (second === undefined) return yield* Effect.die(new Error("missing second faux model"));
        const { id } = yield* session.create({
          workspaceId: workspace.id,
          model: { providerId: first.provider, modelId: first.id },
        });
        yield* session.prompt({ sessionId: id, text: "Original question" });
        const original = messageEntries((yield* session.reload({ sessionId: id })).entries)[0];
        if (original === undefined) return yield* Effect.die(new Error("missing original message"));

        yield* session.editMessage({
          sessionId: id,
          entryId: original.id,
          text: "Revised question",
          model: { providerId: second.provider, modelId: second.id },
          thinkingLevel: "high",
        });

        const revised = yield* session.reload({ sessionId: id });
        expect(requestedModel).toBe(second.id);
        expect(modelOf(revised.entries)).toEqual({
          providerId: second.provider,
          modelId: second.id,
        });
        expect(thinkingLevelOf(revised.entries)).toBe("high");
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("creates a sibling branch with revised text and images", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([
        fauxAssistantMessage("Original answer"),
        fauxAssistantMessage("Revised answer"),
        fauxAssistantMessage("Image-only answer"),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-edit-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });
        yield* session.prompt({ sessionId: id, text: "Original question" });
        const original = messageEntries((yield* session.reload({ sessionId: id })).entries)[0];
        if (original === undefined) return yield* Effect.die(new Error("missing original message"));

        yield* session.editMessage({
          sessionId: id,
          entryId: original.id,
          text: "Revised question",
          images: [{ data: PIXEL, mimeType: "image/png" }],
        });
        const revised = messageEntries((yield* session.reload({ sessionId: id })).entries);
        expect(revised.map(textOf)).toEqual(["Revised question", "Revised answer"]);
        expect(revised[0]?.parentId).toBe(original.parentId);
        expect(imagesOf(revised[0])).toEqual([{ data: PIXEL, mimeType: "image/png" }]);

        // The original branch remains addressable in Pi's tree.
        yield* session.editMessage({
          sessionId: id,
          entryId: original.id,
          text: "",
          images: [{ data: PIXEL, mimeType: "image/jpeg" }],
        });
        const imageOnly = messageEntries((yield* session.reload({ sessionId: id })).entries);
        expect(imageOnly.map((entry) => entry.message.role)).toEqual(["user", "assistant"]);
        expect(imagesOf(imageOnly[0])).toEqual([{ data: PIXEL, mimeType: "image/jpeg" }]);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("keeps the revised branch active when the provider answer fails", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([
        fauxAssistantMessage("Original answer"),
        () => Promise.reject(new Error("provider unavailable")),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-edit-failure");
        const { id } = yield* session.create({ workspaceId: workspace.id });
        yield* session.prompt({ sessionId: id, text: "Original question" });
        const original = messageEntries((yield* session.reload({ sessionId: id })).entries)[0];
        if (original === undefined) return yield* Effect.die(new Error("missing original message"));

        // Faux turns the rejected provider call into Pi's committed error
        // assistant message. The edit may report that model outcome however
        // Pi chooses, but it must not mistake it for a pre-commit prompt
        // failure and navigate back to the old branch.
        yield* session
          .editMessage({ sessionId: id, entryId: original.id, text: "Revised question" })
          .pipe(Effect.result);

        const revised = messageEntries((yield* session.reload({ sessionId: id })).entries);
        expect(textOf(revised[0])).toBe("Revised question");
        expect(revised.map((entry) => entry.message.role)).toEqual(["user", "assistant"]);
        if (revised[1]?.message.role === "assistant") {
          expect(revised[1].message.stopReason).toBe("error");
        }
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("tags a run failure after the revised user message commits", () =>
    Effect.gen(function* () {
      const { faux, collection, model, appLayer } = makeFauxSessionLayer();
      faux.setResponses([
        fauxAssistantMessage("Original answer"),
        fauxAssistantMessage("Revised answer"),
      ]);

      const program = Effect.gen(function* () {
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-edit-committed-error");
        const workspaces = yield* Workspace.Service;
        const env = yield* workspaces.env({ workspaceId: workspace.id });
        const sessionId = Session.SessionId.make("session-edit-committed-error");
        const piSession = yield* Effect.promise(() =>
          new InMemorySessionRepo().create({ id: sessionId }),
        );
        yield* Effect.promise(() => piSession.appendModelChange(model.provider, model.id));
        const harness = new AgentHarness<{ readonly env: Workspace.ExecutionEnv }>({
          session: piSession,
          models: collection,
          model,
          toolContext: { env },
        });
        yield* Effect.promise(() => harness.prompt("Original question"));
        const original = messageEntries(yield* Effect.promise(() => piSession.getBranch()))[0];
        if (original === undefined) return yield* Effect.die(new Error("missing original message"));

        const events = yield* PubSub.unbounded<Session.AgentHarnessEvent>();
        const unsubscribe = harness.subscribe((event) => {
          PubSub.publishUnsafe(events, event);
        });
        const live = {
          session: piSession,
          harness,
          unsubscribe,
          events,
          origin: {
            workspace: { id: workspace.id, directory: workspace.directory },
            env,
          },
          binding: {
            workspace: { id: workspace.id, directory: workspace.directory },
            env,
          },
          snapshots: [],
          entrySeq: (yield* Effect.promise(() => piSession.getEntries())).length,
          phase: yield* SubscriptionRef.make<Session.Phase>("idle"),
          queue: { last: undefined },
          delegation: { active: false, sidekick: null },
          lifecycle: { closed: false, activeRuns: 0, admission: Semaphore.makeUnsafe(1) },
        } satisfies LiveSession;
        const stopFailing = harness.subscribe((event) => {
          if (event.type === "message_start" && event.message.role === "assistant") {
            throw new Error("assistant event failed after commit");
          }
        });

        const error = yield* replaceMessage({
          sessionId,
          entryId: original.id,
          text: "Revised question",
          options: {},
          live,
          runtimeOf: () => Effect.succeed(liveRuntimeOf(live)),
        }).pipe(Effect.flip);
        stopFailing();
        unsubscribe();

        expect(error).toBeInstanceOf(Session.EditMessageCommittedError);
        if (!(error instanceof Session.EditMessageCommittedError)) {
          return yield* Effect.die(new Error("expected a committed edit error"));
        }
        expect(error.code).toBe("session.edit_message_committed");
        expect(error.stage).toBe("run");
        expect(error.message).toBe("The edited message was saved before this failure.");
        expect(error.reason).toContain("Agent run failed and failure reporting failed");
        const revised = messageEntries(yield* Effect.promise(() => piSession.getBranch()));
        expect(textOf(revised[0])).toBe("Revised question");
        expect(revised[0]?.parentId).toBe(original.parentId);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("refuses to move the tree while a turn is running", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const gated = gatedResponse("Later answer");
      faux.setResponses([fauxAssistantMessage("First answer"), gated.response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-edit-busy");
        const { id } = yield* session.create({ workspaceId: workspace.id });
        yield* session.prompt({ sessionId: id, text: "First question" });
        const original = messageEntries((yield* session.reload({ sessionId: id })).entries)[0];
        if (original === undefined) return yield* Effect.die(new Error("missing original message"));

        const sawStart = yield* Deferred.make<void>();
        const stream = yield* session.events({ sessionId: id });
        yield* stream.pipe(
          Stream.runForEach((event) =>
            event.type === "agent_start" ? Deferred.succeed(sawStart, undefined) : Effect.void,
          ),
          Effect.forkScoped,
        );
        const run = yield* session
          .prompt({ sessionId: id, text: "Keep running" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(sawStart);

        const error = yield* session
          .editMessage({ sessionId: id, entryId: original.id, text: "Too soon" })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(AgentHarnessError);
        if (!(error instanceof AgentHarnessError)) {
          return yield* Effect.die(new Error("expected an AgentHarnessError"));
        }
        expect(error.code).toBe("busy");

        gated.release();
        yield* Fiber.join(run);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );
});
