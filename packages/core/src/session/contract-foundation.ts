/**
 * Shared schemas and error codecs used by every session RPC group.
 *
 * This module is the bottom of the session-contract dependency graph. It has
 * no dependency on any of the command modules, so those modules can share one
 * exact set of identifiers, Pi codecs, and lookup failures without cycles.
 *
 * @module
 */

import type {
  AgentHarnessErrorCode,
  AgentHarnessEvent,
  AgentHarnessPhase,
  AgentMessage,
  SessionErrorCode as PiSessionErrorCode,
  SessionTreeEntry,
  ThinkingLevel as PiThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { Schema, SchemaGetter } from "effect";

import { Git } from "../git";
import { Models } from "../models";
import { AgentHarnessError, SessionError } from "../pi-errors";
import { Workspace } from "../workspace";

/** Identifies one persisted Pi session. */
export const SessionId = Schema.NonEmptyString.pipe(Schema.brand("SessionId")).annotate({
  identifier: "SessionId",
});
export type SessionId = typeof SessionId.Type;

/** Maximum rendered length of a generated session title. */
export const SESSION_TITLE_MAX_LENGTH = 50;

/** A compact, single-line name derived from the session's first prompt. */
export const SessionTitle = Schema.NonEmptyString.check(
  Schema.isTrimmed(),
  Schema.isPattern(/^[^\r\n]+$/u),
  Schema.isMaxLength(SESSION_TITLE_MAX_LENGTH),
).annotate({ identifier: "SessionTitle" });
export type SessionTitle = typeof SessionTitle.Type;

/** A session and the trusted workspace it is bound to. */
export const SessionInfo = Schema.Struct({
  id: SessionId,
  workspaceId: Workspace.WorkspaceId,
}).annotate({
  identifier: "SessionInfo",
});
export type SessionInfo = typeof SessionInfo.Type;

/** No session with this id exists in this host's store. */
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "SessionNotFoundError",
  {
    code: Schema.tag("session.not_found"),
    message: Schema.tag("Honk does not know this session."),
    sessionId: Schema.NonEmptyString,
  },
) {}

/** Pi's closed harness-error code vocabulary. */
const HarnessErrorCode = Schema.Literals([
  "busy",
  "invalid_state",
  "invalid_argument",
  "session",
  "hook",
  "auth",
  "compaction",
  "branch_summary",
  "unknown",
] satisfies readonly AgentHarnessErrorCode[]);

/** Pi's closed persisted-session error code vocabulary. */
const SessionErrorCode = Schema.Literals([
  "not_found",
  "invalid_session",
  "invalid_entry",
  "invalid_fork_target",
  "storage",
  "unknown",
] satisfies readonly PiSessionErrorCode[]);

/** The serialized form of Pi's two public error classes. */
const PiErrorWire = Schema.Union([
  Schema.Struct({
    kind: Schema.tag("harness"),
    code: HarnessErrorCode,
    message: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.tag("session"),
    code: SessionErrorCode,
    message: Schema.String,
  }),
]);

const PiErrorClass = Schema.Union([
  Schema.instanceOf(AgentHarnessError),
  Schema.instanceOf(SessionError),
]).annotate({ identifier: "PiError" });

/**
 * Pi's own error classes as they cross the session boundary.
 *
 * In process the instance passes through untouched. A serialized transport
 * carries only its stable class, code, and message and reconstructs the same
 * Pi class on decode; the host-side cause chain deliberately stays behind.
 */
export const PiError = PiErrorWire.pipe(
  Schema.decodeTo(PiErrorClass, {
    decode: SchemaGetter.transform((wire) =>
      wire.kind === "harness"
        ? new AgentHarnessError(wire.code, wire.message)
        : new SessionError(wire.code, wire.message),
    ),
    encode: SchemaGetter.transform((error) => {
      if (error instanceof AgentHarnessError) {
        return { kind: "harness", code: error.code, message: error.message };
      }
      return { kind: "session", code: error.code, message: error.message };
    }),
  }),
);
export type PiError = AgentHarnessError | SessionError;

/** Every expected failure reachable through the session domain. */
export type Error =
  | NotFoundError
  | Workspace.NotFoundError
  | Git.Error
  | PiError
  | Models.AvailableError;

/** Failures shared by commands that lazily restore a stored session. */
export const LookupError = Schema.Union([NotFoundError, PiError, Models.ResolveError]);

/** Pi's complete thinking-level vocabulary. */
export const ThinkingLevel = Schema.Literals([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] satisfies readonly PiThinkingLevel[]).annotate({ identifier: "ThinkingLevel" });
export type ThinkingLevel = PiThinkingLevel extends typeof ThinkingLevel.Type
  ? typeof ThinkingLevel.Type
  : never;

/** The Honk-owned fusion stop ladder. */
export const FusionStop = Schema.Literals(["low", "medium", "high", "ultra", "claw"]).annotate({
  identifier: "FusionStop",
});
export type FusionStop = typeof FusionStop.Type;

/** Fusion and direct model choices have no valid combined meaning. */
export class CreateChoiceError extends Schema.TaggedErrorClass<CreateChoiceError>()(
  "SessionCreateChoiceError",
  {
    code: Schema.tag("session.create_choice"),
    message: Schema.tag("Fusion and a model choice are mutually exclusive."),
  },
) {}

/** Pi's complete harness lifecycle vocabulary. */
export const Phase = Schema.Literals([
  "idle",
  "turn",
  "compaction",
  "branch_summary",
  "retry",
] satisfies readonly AgentHarnessPhase[]).annotate({ identifier: "SessionPhase" });
export type Phase = AgentHarnessPhase extends typeof Phase.Type ? typeof Phase.Type : never;

/**
 * Opaque Pi values carried unchanged by Honk's homogeneous protocol.
 *
 * `Schema.Opaque` changes only the static decoded type of `Schema.Unknown`;
 * its runtime codec still accepts and returns the value untouched. Honk does
 * not maintain a second structural mirror of Pi's message, entry, or event.
 */
export const PiMessage = Schema.Opaque<AgentMessage>()(Schema.Unknown);
export const PiEntry = Schema.Opaque<SessionTreeEntry>()(Schema.Unknown);
export const PiEvent = Schema.Opaque<AgentHarnessEvent>()(Schema.Unknown);
