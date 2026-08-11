// Workspace binding and run control: create's trust gate, abort, followUp,
// and steer. The prompt/reload basics live in lifecycle.test.ts.

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentHarnessError } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Stream } from "effect";

import { Session } from "../../src/session";
import {
  gatedResponse,
  makeFauxSessionLayer,
  messageEntries,
  openTrustedWorkspace,
  textOf,
} from "../../src/testing";
import { Workspace } from "../../src/workspace";

describe("workspace-bound sessions and run control", () => {
  it.effect("create refuses unknown workspaces with the typed workspace NotFoundError", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        // Untrusted directories never get an id, so an unknown id and an
        // untrusted directory are one and the same refusal.
        const error = yield* session
          .create({ workspaceId: Workspace.WorkspaceId.make("never-trusted") })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(Workspace.NotFoundError);
        expect(error.code).toBe("workspace.not_found");
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("create binds the session to the trusted workspace it was given", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const info = yield* session.create({ workspaceId: workspace.id });
        expect(info.workspaceId).toBe(workspace.id);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("abort ends a running prompt and the session settles back to idle", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      // The gate is never released: only abort can end this run.
      const { response } = gatedResponse("never delivered");
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

        // Text queued behind the run must come back when the run is stopped:
        // stopping never destroys something the user typed (conversation §7).
        yield* session.followUp({ sessionId: id, text: "and after that, lint" });
        const cleared = yield* session.abort({ sessionId: id });
        const restored = cleared.clearedFollowUp.flatMap((message) => {
          if (!("role" in message) || message.role !== "user") return [];
          if (!(message.content instanceof Array)) return [message.content];
          return [
            message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
          ];
        });
        expect(restored).toEqual(["and after that, lint"]);

        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        const after = yield* session.reload({ sessionId: id });
        expect(after.phase).toBe("idle");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("prompt and abort settling the same turn never overwrite the base checkpoint", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "honk-abort-base-")));
      execFileSync("git", ["init", "."], { cwd: directory });
      const file = join(directory, "state.txt");
      yield* Effect.promise(() => writeFile(file, "base\n"));

      const { faux, appLayer } = makeFauxSessionLayer();
      const { response } = gatedResponse("never delivered");
      faux.setResponses([
        response,
        fauxAssistantMessage([
          fauxToolCall("write", { path: "state.txt", content: "second turn\n" }),
        ]),
        fauxAssistantMessage("done"),
      ]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace(directory);
        const { id } = yield* session.create({ workspaceId: workspace.id });
        yield* Effect.promise(() => writeFile(file, "during turn\n"));

        const sawStart = yield* Deferred.make<void>();
        const stream = yield* session.events({ sessionId: id });
        yield* stream.pipe(
          Stream.runForEach((event) =>
            event.type === "agent_start" ? Deferred.succeed(sawStart, undefined) : Effect.void,
          ),
          Effect.forkScoped,
        );

        const run = yield* session.prompt({ sessionId: id, text: "Wait" }).pipe(Effect.forkScoped);
        yield* Deferred.await(sawStart);
        yield* session.abort({ sessionId: id });
        yield* Fiber.join(run);

        yield* session.revert({ sessionId: id, entryId: "base" });
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("base\n");

        // Duplicate settlement did not skip the cursor forward: the next
        // turn gets its own immutable checkpoint.
        yield* session.prompt({ sessionId: id, text: "Write the next state" });
        const after = yield* session.reload({ sessionId: id });
        const nextTurn = after.entries.at(-1)?.id;
        if (nextTurn === undefined) return yield* Effect.die(new Error("missing next turn"));
        yield* Effect.promise(() => writeFile(file, "after checkpoint\n"));
        yield* session.revert({ sessionId: id, entryId: nextTurn });
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("second turn\n");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("followUp queues a turn that runs after the current one settles", () =>
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

        yield* session.followUp({ sessionId: id, text: "Second" });
        first.release();
        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        const after = yield* session.reload({ sessionId: id });
        const messages = messageEntries(after.entries);
        expect(messages.map((entry) => entry.message.role)).toEqual([
          "user",
          "assistant",
          "user",
          "assistant",
        ]);
        expect(textOf(messages[3])).toBe("Second answer");
        expect(after.phase).toBe("idle");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("runGitAction lands as marker → canonical instructions → turn", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("Committed.")]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        yield* session.runGitAction({
          sessionId: id,
          action: "commitAndPush",
          files: ["src/a.ts"],
        });

        const after = yield* session.reload({ sessionId: id });
        // The marker precedes the prompt's user message (spec/conversation §8):
        // the surface pairs the two into one chip.
        const marker = after.entries.find((entry) => entry.type === "custom");
        expect(marker).toMatchObject({
          customType: "honk.git_action",
          data: { action: "commitAndPush", files: ["src/a.ts"] },
        });
        const messages = messageEntries(after.entries);
        expect(messages.map((entry) => entry.message.role)).toEqual(["user", "assistant"]);
        // The instructions are the turn's real user message — what the model
        // saw is what the transcript stores.
        expect(textOf(messages[0])).toBe(Session.instructionsFor("commitAndPush", ["src/a.ts"]));
        expect(textOf(messages[0])).toContain("Push the current branch");
        expect(after.phase).toBe("idle");
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("a busy session refuses runGitAction before appending anything", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const { response, release } = gatedResponse("still working");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-session-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        const sawStart = yield* Deferred.make<void>();
        const stream = yield* session.events({ sessionId: id });
        yield* stream.pipe(
          Stream.runForEach((event) =>
            event.type === "agent_start" ? Deferred.succeed(sawStart, undefined) : Effect.void,
          ),
          Effect.forkScoped,
        );
        const run = yield* session
          .prompt({ sessionId: id, text: "Keep going" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(sawStart);

        const error = yield* session
          .runGitAction({ sessionId: id, action: "commit" })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(AgentHarnessError);
        expect((error as AgentHarnessError).code).toBe("busy");

        release();
        yield* Fiber.join(run);

        // Nothing was appended: Pi buffers a running turn's user message
        // until settlement, so a mid-run marker would land before it and
        // pair with the wrong turn. The refusal must come first.
        const after = yield* session.reload({ sessionId: id });
        expect(after.entries.some((entry) => entry.type === "custom")).toBe(false);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  // Pi semantics pinned by observation: with a plain text completion the
  // steer text is committed into the running turn's transcript, and the loop
  // settles without another model call - the next turn answers it.
  it.effect("steer lands in the running turn; the next turn answers it", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const first = gatedResponse("First answer");
      faux.setResponses([first.response, fauxAssistantMessage("Steered answer")]);

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

        yield* session.steer({ sessionId: id, text: "Actually, do this instead" });
        first.release();
        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        const after = yield* session.reload({ sessionId: id });
        const texts = messageEntries(after.entries).map((entry) => textOf(entry));
        expect(texts).toContain("Actually, do this instead");
        expect(after.phase).toBe("idle");
        // The second faux response stays queued for the next turn.
        expect(faux.getPendingResponseCount()).toBe(1);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );
});
