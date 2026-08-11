/**
 * Session RPCs that inspect or change workspace- and model-bound state.
 *
 * @module
 */

import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

import { Git } from "../git";
import { Models } from "../models";
import { Workspace } from "../workspace";

import { LookupError, SessionId, ThinkingLevel } from "./contract-foundation";

/** One settled turn's attributed workspace changes. */
export const TurnChanges = Schema.Struct({
  entryId: Schema.NonEmptyString,
  files: Schema.Array(Git.FileChange),
}).annotate({ identifier: "SessionTurnChanges" });
export type TurnChanges = typeof TurnChanges.Type;

/** Every settled turn with an attributed workspace change. */
export const ChangesOutput = Schema.Struct({
  turns: Schema.Array(TurnChanges),
}).annotate({ identifier: "SessionChangesOutput" });
export type ChangesOutput = typeof ChangesOutput.Type;

/** Computes this conversation's attributed workspace changes by turn. */
export const Changes = Rpc.make("session.changes", {
  payload: { sessionId: SessionId },
  success: ChangesOutput,
  error: LookupError,
});

/** Moves the session to another trusted workspace for its next turn. */
export const SetWorkspace = Rpc.make("session.set_workspace", {
  payload: { sessionId: SessionId, workspaceId: Workspace.WorkspaceId },
  error: Schema.Union([LookupError, Workspace.NotFoundError]),
});

/** Sets Pi's persisted thinking level for this session. */
export const SetThinkingLevel = Rpc.make("session.set_thinking_level", {
  payload: { sessionId: SessionId, thinkingLevel: ThinkingLevel },
  error: LookupError,
});

/** Resolves and sets the session's persisted model. */
export const SetModel = Rpc.make("session.set_model", {
  payload: { sessionId: SessionId, model: Models.ModelRef },
  error: Schema.Union([LookupError, Models.AvailableError]),
});

/** Rewrites the workspace to a turn checkpoint without rewriting history. */
export const Revert = Rpc.make("session.revert", {
  payload: { sessionId: SessionId, entryId: Schema.NonEmptyString },
  error: Schema.Union([LookupError, Git.Failure]),
});
