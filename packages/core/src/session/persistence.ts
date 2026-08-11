/** Persisted-session lookup and restoration into the live-session registry. */

import type { JsonlSessionRepo, SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { SessionError } from "@earendil-works/pi-agent-core";
import { Effect, PubSub } from "effect";

import { Git } from "../git";
import { Models } from "../models";
import { Resources } from "../resources";
import { Workspace } from "../workspace";
import { modelOf, thinkingLevelOf } from "./attribution";
import { type DelegationLink, type SessionId } from "./contract";
import { type HarnessShape, linkOf, runPi } from "./delegation";
import { type LiveSession, openLiveSession, readStableBranch, workspaceTrail } from "./runtime";
import { SIDEKICK_PROMPT, type Preset } from "./subagents";

export interface RestoreShapeRequest {
  readonly sessionId: SessionId;
  readonly entries: readonly SessionTreeEntry[];
  readonly link: DelegationLink | null;
}

const linkedShape = (role: string, presets: readonly Preset[]): HarnessShape => {
  if (role === "sidekick") return { systemPrompt: SIDEKICK_PROMPT };
  const preset = presets.find((candidate) => candidate.name === role);
  return preset === undefined
    ? { readOnly: true }
    : { readOnly: true, systemPrompt: preset.prompt };
};

export const makeSessionPersistence = (input: {
  readonly repo: JsonlSessionRepo;
  readonly workspaces: Workspace.Interface;
  readonly git: Git.Interface;
  readonly models: Models.Interface;
  readonly resources: Resources.Interface;
  readonly presets: readonly Preset[];
  readonly inventoryChanged: PubSub.PubSub<void>;
  readonly deleted: (sessionId: SessionId) => boolean;
  readonly register: (
    sessionId: SessionId,
    live: LiveSession,
  ) => Effect.Effect<LiveSession | undefined>;
}) => {
  const findMetadata = Effect.fnUntraced(function* (sessionId: SessionId) {
    const listed = yield* runPi(() => input.repo.list());
    return listed.find((metadata) => metadata.id === sessionId);
  });

  const restore = <E, R>(
    sessionId: SessionId,
    shapeFor: (request: RestoreShapeRequest) => Effect.Effect<HarnessShape | undefined, E, R>,
  ) =>
    Effect.gen(function* () {
      if (input.deleted(sessionId)) return undefined;
      const metadata = yield* findMetadata(sessionId);
      if (!metadata) return undefined;
      const origin = yield* input.workspaces.locate({ directory: metadata.cwd });
      if (!origin) return undefined;

      const session = yield* runPi(() => input.repo.open(metadata));
      const stable = yield* runPi(() => readStableBranch(session));
      const entries = stable.entries;
      const { attributed, workspace } = yield* workspaceTrail(input.workspaces, entries, origin);

      const recordedModel = modelOf(entries);
      if (recordedModel === undefined) {
        return yield* Effect.fail(
          new SessionError("invalid_session", "Honk session has no recorded model"),
        );
      }
      const model = yield* input.models.resolve(recordedModel);
      const thinkingLevel = thinkingLevelOf(entries);

      const captured = new Map<Workspace.WorkspaceId, ReadonlySet<string>>();
      for (const workspaceId of new Set(attributed.map((snapshot) => snapshot.workspaceId))) {
        const names = yield* input.git
          .checkpoints({ workspaceId, prefix: sessionId })
          .pipe(Effect.orElseSucceed((): Git.CheckpointsOutput => ({ checkpoints: [] })));
        captured.set(
          workspaceId,
          new Set(names.checkpoints.map((name) => name.slice(sessionId.length + 1))),
        );
      }
      const snapshots = attributed.filter(
        (snapshot) => captured.get(snapshot.workspaceId)?.has(snapshot.entryId) ?? false,
      );

      const originEnv = yield* input.workspaces.env({ workspaceId: origin.id }).pipe(Effect.orDie);
      const env =
        workspace.id === origin.id
          ? originEnv
          : yield* input.workspaces.env({ workspaceId: workspace.id }).pipe(Effect.orDie);
      const link = linkOf(metadata.metadata);
      const shape = yield* shapeFor({ sessionId, entries, link });
      if (shape === undefined) return undefined;

      const opened = yield* openLiveSession({
        session,
        origin: { workspace: origin, env: originEnv },
        binding: { workspace, env },
        snapshots,
        entrySeq: stable.entrySeq,
        model,
        thinkingLevel,
        shape,
        models: input.models,
        resources: input.resources,
        inventoryChanged: input.inventoryChanged,
      });

      const entered = yield* input.register(sessionId, opened);
      if (entered !== undefined) yield* PubSub.publish(input.inventoryChanged, undefined);
      return entered;
    });

  const restoreLinked = (sessionId: SessionId) =>
    restore(sessionId, (request) =>
      Effect.succeed(
        request.link === null ? undefined : linkedShape(request.link.role, input.presets),
      ),
    );

  return { findMetadata, restore, restoreLinked };
};
