/** Session titles and the cross-session inventory projection. */

import type { JsonlSessionMetadata, JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import { Effect, FiberSet, PubSub, Ref, Stream, SubscriptionRef } from "effect";

import { Workspace } from "../workspace";
import {
  type ListOutput,
  NotFoundError,
  SessionId,
  type SessionSummary,
  type SessionTitle,
} from "./contract";
import { linkOf, runAdmitted, runPi } from "./delegation";
import type { LiveSession } from "./runtime";
import {
  type GenerateSessionTitle,
  type GenerateSessionTitleInput,
  normalizeSessionTitle,
  titleFromEntries,
  titleFromPrompt,
} from "./title";

interface PendingTitle {
  readonly fallback: SessionTitle;
  readonly request: Omit<GenerateSessionTitleInput, "signal">;
}

export const makeSessionInventory = (input: {
  readonly repo: JsonlSessionRepo;
  readonly storage: Workspace.ExecutionEnv;
  readonly workspaces: Workspace.Interface;
  readonly inventoryChanged: PubSub.PubSub<void>;
  readonly liveSnapshot: Effect.Effect<ReadonlyMap<SessionId, LiveSession>>;
  readonly generateTitle: GenerateSessionTitle;
}) =>
  Effect.gen(function* () {
    const jobs = yield* FiberSet.make<void, never>();
    const reservations = new Set<SessionId>();
    const cache = yield* Ref.make<ReadonlyMap<SessionId, SessionTitle | null>>(new Map());

    const cacheTitle = (sessionId: SessionId, title: SessionTitle | undefined) =>
      Ref.update(cache, (current) => new Map(current).set(sessionId, title ?? null));

    const titleOf = Effect.fnUntraced(function* (
      sessionId: SessionId,
      metadata: JsonlSessionMetadata,
      live: LiveSession | undefined,
    ) {
      const cached = yield* Ref.get(cache);
      if (cached.has(sessionId)) return cached.get(sessionId) ?? undefined;

      const loaded = yield* Effect.gen(function* () {
        const session = live?.session ?? (yield* runPi(() => input.repo.open(metadata)));
        const storedName = yield* runPi(() => session.getSessionName());
        const stored = normalizeSessionTitle(storedName ?? "");
        if (stored !== undefined) return stored;
        return titleFromEntries(yield* runPi(() => session.getEntries()));
      }).pipe(Effect.orElseSucceed(() => undefined));

      yield* Ref.update(cache, (current) =>
        current.has(sessionId) ? current : new Map(current).set(sessionId, loaded ?? null),
      );
      return (yield* Ref.get(cache)).get(sessionId) ?? undefined;
    });

    const installGeneratedTitle = (
      sessionId: SessionId,
      live: LiveSession,
      pending: PendingTitle,
    ) =>
      Effect.gen(function* () {
        const generated = yield* Effect.promise((signal) =>
          input.generateTitle({ ...pending.request, signal }),
        );
        if (generated === undefined || generated === pending.fallback) return;

        while (true) {
          yield* Effect.promise(() => live.harness.waitForIdle());
          const installed = yield* runAdmitted(
            live.lifecycle,
            () => new NotFoundError({ sessionId }),
            () =>
              Effect.gen(function* () {
                if (live.lifecycle.activeRuns > 0) return false;
                const storedName = yield* runPi(() => live.session.getSessionName());
                if (normalizeSessionTitle(storedName ?? "") !== pending.fallback) return true;
                yield* runPi(() => live.session.appendSessionName(generated));
                yield* cacheTitle(sessionId, generated);
                yield* PubSub.publish(input.inventoryChanged, undefined);
                return true;
              }),
          );
          if (installed) return;
          yield* Effect.yieldNow;
        }
      }).pipe(
        Effect.ignoreCause,
        Effect.ensuring(Effect.sync(() => reservations.delete(sessionId))),
      );

    /** Seeds the durable fallback and reserves at most one generated title. */
    const preparePrompt = Effect.fnUntraced(function* (request: {
      readonly sessionId: SessionId;
      readonly live: LiveSession;
      readonly text: string;
      readonly images: GenerateSessionTitleInput["images"];
    }) {
      const stored = normalizeSessionTitle(
        (yield* runPi(() => request.live.session.getSessionName())) ?? "",
      );
      const recovered =
        stored ?? titleFromEntries(yield* runPi(() => request.live.session.getEntries()));
      const fallback =
        recovered ?? titleFromPrompt({ text: request.text, hasImages: request.images.length > 0 });

      if (stored === undefined && fallback !== undefined) {
        yield* runPi(() => request.live.session.appendSessionName(fallback));
        yield* cacheTitle(request.sessionId, fallback);
        yield* PubSub.publish(input.inventoryChanged, undefined);
      } else if (fallback !== undefined) {
        yield* cacheTitle(request.sessionId, fallback);
      }

      const shouldGenerate =
        stored === undefined &&
        recovered === undefined &&
        fallback !== undefined &&
        !reservations.has(request.sessionId);
      if (!shouldGenerate || fallback === undefined) return undefined;

      reservations.add(request.sessionId);
      return {
        fallback,
        request: {
          model: request.live.harness.getModel(),
          text: request.text,
          images: request.images,
        },
      } satisfies PendingTitle;
    });

    const scheduleTitle = (
      sessionId: SessionId,
      live: LiveSession,
      pending: PendingTitle | undefined,
    ) =>
      pending === undefined
        ? Effect.void
        : FiberSet.run(jobs, installGeneratedTitle(sessionId, live, pending));

    const updatedAtOf = Effect.fnUntraced(function* (metadata: JsonlSessionMetadata) {
      const info = yield* Effect.promise(() => input.storage.fileInfo(metadata.path));
      return info.ok ? new Date(info.value.mtimeMs).toISOString() : metadata.createdAt;
    });

    const list = Effect.fn("Session.list")(function* () {
      const listed = yield* runPi(() => input.repo.list());
      const liveMap = yield* input.liveSnapshot;
      const projected = yield* Effect.forEach(
        listed,
        (metadata) =>
          Effect.gen(function* () {
            const located = yield* input.workspaces.locate({ directory: metadata.cwd });
            if (!located) return undefined;

            const id = SessionId.make(metadata.id);
            const live = liveMap.get(id);
            const link = linkOf(metadata.metadata);
            const title = yield* titleOf(id, metadata, live);
            return {
              id,
              workspaceId: located.id,
              directory: located.directory,
              ...(title === undefined ? {} : { title }),
              createdAt: metadata.createdAt,
              phase: live === undefined ? "idle" : yield* SubscriptionRef.get(live.phase),
              updatedAt: yield* updatedAtOf(metadata),
              ...(link === null ? {} : { delegation: link }),
            } satisfies SessionSummary;
          }),
        { concurrency: "unbounded" },
      );

      const sessions: SessionSummary[] = [];
      for (const summary of projected) {
        if (summary !== undefined) sessions.push(summary);
      }
      return { sessions } satisfies ListOutput;
    });

    const watch = Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(input.inventoryChanged);
      return Stream.concat(
        Stream.fromEffect(list()),
        Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list())),
      );
    }).pipe(Effect.withSpan("Session.watchInventory"));

    const forget = (sessionId: SessionId) =>
      Ref.update(cache, (current) => {
        const next = new Map(current);
        next.delete(sessionId);
        return next;
      });

    return { preparePrompt, scheduleTitle, list, watch, forget };
  });
