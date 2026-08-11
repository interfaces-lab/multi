// The session inventory: list's phase and updatedAt columns, and the
// watchInventory stream. Phase must come from the one per-session fold —
// never from opening a harness — so a stored session a host never touched
// lists as idle, and a running one lists as turn.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Queue, Stream } from "effect";

import { createHonkCore } from "../../src/honk-core";
import { Session } from "../../src/session";
import {
  createExecutionEnv,
  gatedResponse,
  makeFauxSessionLayer,
  openTrustedWorkspace,
} from "../../src/testing";

const millis = (iso: string) => new Date(iso).getTime();

// Drains inventory frames until one satisfies the predicate. Frames the test
// does not care about are legal — every frame is the full inventory, so
// skipping one loses nothing.
const frameWhere = (
  frames: Queue.Queue<Session.ListOutput>,
  predicate: (frame: Session.ListOutput) => boolean,
) =>
  Effect.gen(function* () {
    while (true) {
      const frame = yield* Queue.take(frames);
      if (predicate(frame)) return frame;
    }
  });

describe("the session inventory", () => {
  it.effect("list reports idle for a fresh session, with updatedAt at or after createdAt", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-inventory-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        const { sessions } = yield* session.list({});
        const row = sessions.find((entry) => entry.id === id);
        expect(row?.phase).toBe("idle");
        expect(row?.title).toBeUndefined();
        if (row === undefined) return;
        // Create wrote the transcript after minting createdAt, so the file's
        // mtime cannot precede it.
        expect(millis(row.updatedAt)).toBeGreaterThanOrEqual(millis(row.createdAt));
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it("list reports idle for a stored session a later host never opened", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-inventory-data-"));
    const workspaceDirectory = await mkdtemp(join(tmpdir(), "honk-inventory-ws-"));
    const startCore = () => {
      const faux = fauxProvider();
      const collection = createModels();
      collection.setProvider(faux.provider);
      const core = createHonkCore({
        dataDirectory,
        createModels: () => collection,
        generateSessionTitle: Session.generatePromptSessionTitle,
        createExecutionEnv,
      });
      return { core, faux };
    };

    // First life: trust, create, prompt, shut down.
    const firstHost = startCore();
    const first = await firstHost.core;
    firstHost.faux.setResponses([fauxAssistantMessage("done")]);
    const sdk1 = first.client();
    await sdk1.workspace.trust({ directory: workspaceDirectory });
    const opened = await sdk1.workspace.open({ directory: workspaceDirectory });
    if (opened.type !== "ready") throw new Error("expected a ready workspace after trust");
    const session = await sdk1.session.create({ workspaceId: opened.id });
    await sdk1.session.prompt({ sessionId: session.id, text: "Restore persisted titles" });
    await first.close();

    // Second life: the session is stored but was never opened here, and
    // listing must not restore a harness — idle by construction is the proof.
    const second = await startCore().core;
    const sdk2 = second.client();
    const { sessions } = await sdk2.session.list({});
    expect(sessions.map((entry) => entry.id)).toEqual([session.id]);
    const [row] = sessions;
    expect(row?.phase).toBe("idle");
    expect(row?.title).toBe("Restore persisted titles");
    if (row !== undefined) {
      expect(millis(row.updatedAt)).toBeGreaterThanOrEqual(millis(row.createdAt));
    }
    await second.close();
  });

  it.effect("list reports turn during a run and idle after it settles", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const { response, release } = gatedResponse("done");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-inventory-tests");
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
          .prompt({ sessionId: id, text: "Keep going" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(sawStart);

        // The fold set the ref before publishing agent_start, so the list
        // read after the event sees the running phase.
        const during = yield* session.list({});
        expect(during.sessions.find((entry) => entry.id === id)?.phase).toBe("turn");
        expect(during.sessions.find((entry) => entry.id === id)?.title).toBe("Keep going");

        release();
        yield* Fiber.join(run);
        yield* Deferred.await(sawSettled);

        const after = yield* session.list({});
        expect(after.sessions.find((entry) => entry.id === id)?.phase).toBe("idle");
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );

  it.effect("updatedAt advances when a prompt commits new entries", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("done")]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-inventory-tests");
        const { id } = yield* session.create({ workspaceId: workspace.id });

        const before = yield* session.list({});
        const updatedBefore = before.sessions.find((entry) => entry.id === id)?.updatedAt;
        expect(updatedBefore).toBeDefined();

        // Real time, not the test clock: the transcript mtime is a
        // filesystem timestamp, and the gap keeps it strictly ordered.
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)));
        yield* session.prompt({ sessionId: id, text: "Touch the transcript" });

        const after = yield* session.list({});
        const updatedAfter = after.sessions.find((entry) => entry.id === id)?.updatedAt;
        expect(updatedAfter).toBeDefined();
        if (updatedAfter === undefined || updatedBefore === undefined) return;
        expect(millis(updatedAfter)).toBeGreaterThan(millis(updatedBefore));
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("publishes and persists a generated title after the first turn settles", () => {
    let resolveTitle!: (title: Session.SessionTitle | undefined) => void;
    const generatedTitle = new Promise<Session.SessionTitle | undefined>((resolve) => {
      resolveTitle = resolve;
    });
    const { faux, appLayer } = makeFauxSessionLayer({
      generateTitle: () => generatedTitle,
    });
    const { response, release } = gatedResponse("done");
    faux.setResponses([response]);

    const program = Effect.gen(function* () {
      const session = yield* Session.Service;
      const workspace = yield* openTrustedWorkspace("/tmp/honk-inventory-tests");
      const { id } = yield* session.create({ workspaceId: workspace.id });
      const stream = yield* session.watchInventory;
      const frames = yield* Queue.unbounded<Session.ListOutput>();
      yield* stream.pipe(
        Stream.runForEach((frame) => Queue.offer(frames, frame)),
        Effect.forkScoped,
      );

      const run = yield* session
        .prompt({ sessionId: id, text: "Why does the tab show a project route?" })
        .pipe(Effect.forkScoped);
      const fallback = yield* frameWhere(
        frames,
        (frame) => frame.sessions.find((entry) => entry.id === id)?.title !== undefined,
      );
      expect(fallback.sessions.find((entry) => entry.id === id)?.title).toBe(
        "Why does the tab show a project route?",
      );

      resolveTitle("Generate useful tab titles");
      release();
      yield* Fiber.join(run);
      const generated = yield* frameWhere(
        frames,
        (frame) =>
          frame.sessions.find((entry) => entry.id === id)?.title === "Generate useful tab titles",
      );
      expect(generated.sessions.find((entry) => entry.id === id)?.title).toBe(
        "Generate useful tab titles",
      );

      const reloaded = yield* session.reload({ sessionId: id });
      expect(reloaded.entries.filter((entry) => entry.type === "session_info").at(-1)?.name).toBe(
        "Generate useful tab titles",
      );
    });

    return program.pipe(Effect.scoped, Effect.provide(appLayer));
  });

  it.effect("watchInventory streams the current inventory, then a frame per change", () =>
    Effect.gen(function* () {
      const { faux, appLayer } = makeFauxSessionLayer();
      const { response, release } = gatedResponse("done");
      faux.setResponses([response]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-inventory-tests");
        const first = yield* session.create({ workspaceId: workspace.id });

        const stream = yield* session.watchInventory;
        const frames = yield* Queue.unbounded<Session.ListOutput>();
        yield* stream.pipe(
          Stream.runForEach((frame) => Queue.offer(frames, frame)),
          Effect.forkScoped,
        );

        // The first frame is the inventory as it stands, unprompted.
        const initial = yield* Queue.take(frames);
        expect(initial.sessions.map((entry) => entry.id)).toEqual([first.id]);
        expect(initial.sessions[0]?.phase).toBe("idle");

        // A create shows up as a later frame with the new row.
        const second = yield* session.create({ workspaceId: workspace.id });
        const withSecond = yield* frameWhere(frames, (frame) => frame.sessions.length === 2);
        expect(withSecond.sessions.map((entry) => entry.id).sort()).toEqual(
          [first.id, second.id].sort(),
        );

        // A run start and its settlement each produce a frame; the row's
        // phase comes from the same fold list reads.
        const run = yield* session
          .prompt({ sessionId: first.id, text: "Keep going" })
          .pipe(Effect.forkScoped);
        const running = yield* frameWhere(
          frames,
          (frame) => frame.sessions.find((entry) => entry.id === first.id)?.phase === "turn",
        );
        expect(running.sessions.find((entry) => entry.id === first.id)?.title).toBe("Keep going");
        expect(running.sessions.find((entry) => entry.id === second.id)?.phase).toBe("idle");

        release();
        yield* Fiber.join(run);
        yield* frameWhere(
          frames,
          (frame) => frame.sessions.find((entry) => entry.id === first.id)?.phase === "idle",
        );

        // A delete removes the row.
        yield* session.delete({ sessionId: second.id });
        const afterDelete = yield* frameWhere(frames, (frame) => frame.sessions.length === 1);
        expect(afterDelete.sessions.map((entry) => entry.id)).toEqual([first.id]);
      });

      yield* program.pipe(Effect.scoped, Effect.provide(appLayer));
    }),
  );
});
