import {
  AgentHarnessError,
  type SessionTreeEntry,
  type SessionTreeEvent,
} from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import { Effect, PubSub } from "effect";

import type { Models } from "../models";
import { runAdmitted, runPi, trackPiRun } from "./delegation";
import { fusionOf } from "./fusion";
import { applyLiveRuntime, type LiveRuntime, liveRuntimeOf, type LiveSession } from "./runtime";
import {
  EditMessageCommittedError,
  EmptyMessageError,
  NotFoundError,
  type PiError,
  type PromptImage,
  type SessionId,
} from "./contract";

/** Converts Honk's wire image shape to the one Pi's public prompt verbs own. */
export const messageOptions = (input: {
  readonly text: string;
  readonly images?: readonly PromptImage[];
}): Effect.Effect<{ images?: ImageContent[] }, EmptyMessageError> => {
  const images = input.images ?? [];
  if (input.text.length === 0 && images.length === 0) {
    return Effect.fail(new EmptyMessageError({}));
  }
  return Effect.succeed(
    images.length === 0
      ? {}
      : { images: images.map((image): ImageContent => ({ type: "image", ...image })) },
  );
};

/** Starts Pi's sibling-branch replacement and restores the old leaf on failure. */
export const replaceMessage = Effect.fnUntraced(function* (input: {
  readonly sessionId: SessionId;
  readonly entryId: string;
  readonly text: string;
  readonly options: { readonly images?: ImageContent[] };
  readonly model?: LiveRuntime["model"];
  readonly thinkingLevel?: LiveRuntime["thinkingLevel"];
  readonly live: LiveSession;
  readonly runtimeOf: (
    entries: readonly SessionTreeEntry[],
  ) => Effect.Effect<LiveRuntime, Models.ResolveError | NotFoundError | PiError>;
}) {
  const rollback = (leaf: string | null, runtime: LiveRuntime) =>
    Effect.gen(function* () {
      const abandonedLeaf = yield* runPi(() => input.live.session.getLeafId());
      // Pi's navigation helper treats a user target as its parent;
      // Session.moveTo is the public exact-leaf operation rollback requires.
      // Select the old branch before setters append runtime entries, then return
      // to its exact former leaf after those durable setter entries are written.
      const restoreLeaf = runPi(() => input.live.session.moveTo(leaf));
      const announceRestore =
        abandonedLeaf === leaf
          ? Effect.void
          : PubSub.publish(input.live.events, {
              type: "session_tree",
              oldLeafId: abandonedLeaf,
              newLeafId: leaf,
            } satisfies SessionTreeEvent).pipe(Effect.asVoid);
      const finishRestore = restoreLeaf.pipe(Effect.andThen(announceRestore));
      yield* restoreLeaf;
      yield* applyLiveRuntime(input.live, runtime).pipe(
        Effect.catch((runtimeError) =>
          finishRestore.pipe(
            Effect.mapError(
              (leafError) =>
                new AgentHarnessError(
                  "unknown",
                  "The previous branch was selected but its runtime and leaf could not be restored",
                  new AggregateError([runtimeError, leafError]),
                ),
            ),
            Effect.andThen(Effect.fail(runtimeError)),
          ),
        ),
      );
      yield* finishRestore;
    });
  const started = yield* runAdmitted(
    input.live.lifecycle,
    () => new NotFoundError({ sessionId: input.sessionId }),
    () =>
      Effect.gen(function* () {
        const previousLeaf = yield* runPi(() => input.live.session.getLeafId());
        const previousRuntime = liveRuntimeOf(input.live);
        const target = yield* runPi(() => input.live.session.getEntry(input.entryId));
        if (target?.type !== "message" || target.message.role !== "user") {
          return yield* Effect.fail(
            new AgentHarnessError("invalid_argument", "Only a user message can be edited"),
          );
        }
        return yield* Effect.gen(function* () {
          const navigation = yield* runPi(() =>
            input.live.harness.navigateTree(input.entryId, { summarize: false }),
          );
          if (navigation.cancelled) {
            return yield* Effect.fail(
              new AgentHarnessError("invalid_state", "Message edit navigation was cancelled"),
            );
          }
          const branch = yield* runPi(() => input.live.session.getBranch());
          const branchRuntime = yield* input.runtimeOf(branch);
          // First make the harness exactly match the selected parent. Applying
          // an edit override before this could compare against the old active
          // leaf and skip the transcript record the sibling branch needs.
          yield* applyLiveRuntime(input.live, branchRuntime);
          if (input.model !== undefined) {
            const model = input.model;
            // Choosing a model exits Fusion on this branch, as the ordinary
            // session model selector does. The marker must precede the model
            // record so restore and delegation read the same transition.
            if (fusionOf(branch) !== null) {
              yield* runPi(() =>
                input.live.session.appendCustomEntry("honk.fusion", { stop: null }),
              );
            }
            const currentModel = input.live.harness.getModel();
            if (currentModel.provider !== model.provider || currentModel.id !== model.id) {
              yield* runPi(() => input.live.harness.setModel(model));
            }
          }
          if (input.thinkingLevel !== undefined) {
            const thinkingLevel = input.thinkingLevel;
            if (input.live.harness.getThinkingLevel() !== thinkingLevel) {
              yield* runPi(() => input.live.harness.setThinkingLevel(thinkingLevel));
            }
          }
          // Keep branch mutation admitted until Pi has durably appended this
          // revised user message. Provider work continues without the permit.
          // This is a commit signal, not a leaf heuristic: /cd and other
          // transcript mutations cannot interleave before it.
          return yield* runPi(async () => {
            let committed = false;
            let markCommitted = (): void => undefined;
            const committedMessage = new Promise<void>((resolve) => {
              markCommitted = resolve;
            });
            const unsubscribe = input.live.harness.subscribe((event) => {
              if (event.type === "message_end" && event.message.role === "user") {
                committed = true;
                markCommitted();
              }
            });
            try {
              const pending = trackPiRun(input.live.lifecycle, () =>
                input.live.harness.prompt(input.text, input.options),
              );
              await Promise.race([committedMessage, pending]);
              if (!committed) {
                throw new AgentHarnessError(
                  "invalid_state",
                  "Message edit completed without committing its user message",
                );
              }
              // Nested so this async function does not await the provider turn.
              return { pending };
            } finally {
              unsubscribe();
            }
          });
        }).pipe(
          Effect.catch((error) =>
            rollback(previousLeaf, previousRuntime).pipe(
              Effect.mapError(
                (rollbackError) =>
                  new AgentHarnessError(
                    "unknown",
                    "Message edit failed and its previous branch could not be restored",
                    new AggregateError([error, rollbackError]),
                  ),
              ),
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );
      }),
  );
  yield* runPi(() => started.pending).pipe(
    Effect.mapError((error) => EditMessageCommittedError.from("run", error)),
  );
});
