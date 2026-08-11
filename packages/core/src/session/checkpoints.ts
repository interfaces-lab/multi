/**
 * Per-session workspace checkpoints and change attribution.
 *
 * The session service owns command routing. This module owns the checkpoint
 * ledger so creation, settlement, change reads, and reverts share one policy.
 */

import { Effect } from "effect";

import { Git } from "../git";
import { Workspace } from "../workspace";
import { gateTurnFiles, turnToolWrites } from "./attribution";
import { runAdmitted, runAdmittedPi, runPi } from "./delegation";
import { NotFoundError, type ChangesOutput, type SessionId, type TurnChanges } from "./contract";
import type { LiveSession } from "./runtime";

export const makeCheckpointLedger = (input: {
  readonly git: Git.Interface;
  readonly workspaces: Workspace.Interface;
}) => {
  /** Captures one checkpoint and records the repository that owns it. */
  const capture = Effect.fnUntraced(function* (
    sessionId: SessionId,
    live: LiveSession,
    entryId: string,
  ) {
    const workspaceId = live.binding.workspace.id;
    const captured = yield* input.git
      .captureCheckpoint({ workspaceId, checkpoint: `${sessionId}/${entryId}` })
      .pipe(
        Effect.map(() => true),
        Effect.orElseSucceed(() => false),
      );
    if (!captured) return;

    const previous = live.snapshots.at(-1);
    if (
      previous !== undefined &&
      previous.entryId === entryId &&
      previous.workspaceId === workspaceId
    ) {
      return;
    }
    live.snapshots.push({ entryId, workspaceId });
  });

  /** Captures the newly committed tail under its final entry id. */
  const settle = Effect.fnUntraced(function* (sessionId: SessionId, live: LiveSession) {
    yield* runAdmitted(
      live.lifecycle,
      () => new NotFoundError({ sessionId }),
      () =>
        Effect.gen(function* () {
          const afterEntrySeq = live.entrySeq;
          const entries = yield* runPi(() => live.session.getEntries({ afterEntrySeq }));
          const nextEntrySeq = afterEntrySeq + entries.length;
          const last = entries.at(-1);
          if (last === undefined || nextEntrySeq <= live.entrySeq) return;
          live.entrySeq = nextEntrySeq;
          yield* capture(sessionId, live, last.id);
        }),
    );
  });

  /** Diffs consecutive checkpoints and attributes the files to the turn. */
  const changes = Effect.fnUntraced(function* (sessionId: SessionId, live: LiveSession) {
    const entries = yield* runAdmittedPi(
      live.lifecycle,
      () => new NotFoundError({ sessionId }),
      () => live.session.getBranch(),
    );
    const order = new Map<string, number>();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry !== undefined) order.set(entry.id, index);
    }
    const snapshots = live.snapshots.filter(
      ({ entryId }) => entryId === "base" || order.has(entryId),
    );

    const turns: TurnChanges[] = [];
    for (let index = 1; index < snapshots.length; index += 1) {
      const from = snapshots[index - 1];
      const to = snapshots[index];
      if (from === undefined || to === undefined) continue;
      if (from.workspaceId !== to.workspaceId) continue;

      const files = yield* input.git
        .checkpointChanges({
          workspaceId: to.workspaceId,
          from: `${sessionId}/${from.entryId}`,
          to: `${sessionId}/${to.entryId}`,
        })
        .pipe(Effect.orElseSucceed((): readonly Git.FileChange[] => []));
      if (files.length === 0) continue;

      const located = yield* input.workspaces
        .find({ workspaceId: to.workspaceId })
        .pipe(Effect.orElseSucceed(() => undefined));
      if (located === undefined) continue;

      const gated = gateTurnFiles(
        files,
        turnToolWrites(entries, order.get(from.entryId), order.get(to.entryId), located.directory),
      );
      if (gated.length > 0) turns.push({ entryId: to.entryId, files: gated });
    }
    return { turns } satisfies ChangesOutput;
  });

  /** Restores a checkpoint after recording a revertible safety snapshot. */
  const revert = Effect.fnUntraced(function* (
    request: { readonly sessionId: SessionId; readonly entryId: string },
    live: LiveSession,
  ) {
    const target = live.snapshots.find((snapshot) => snapshot.entryId === request.entryId);
    if (target === undefined) {
      return yield* new Git.CheckpointNotFoundError({
        checkpoint: `${request.sessionId}/${request.entryId}`,
      });
    }

    yield* runAdmitted(
      live.lifecycle,
      () => new NotFoundError({ sessionId: request.sessionId }),
      () =>
        Effect.gen(function* () {
          const entryId = yield* runPi(() =>
            live.session.appendCustomEntry("honk.revert", { toEntryId: request.entryId }),
          );
          yield* capture(request.sessionId, live, entryId);
          yield* input.git.restoreCheckpoint({
            workspaceId: target.workspaceId,
            checkpoint: `${request.sessionId}/${target.entryId}`,
          });
        }),
    );
  });

  return { capture, settle, changes, revert };
};
