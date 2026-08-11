/**
 * Conversation content, run-control, reload, and event-stream RPC contracts.
 *
 * @module
 */

import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

import { Models } from "../models";

import {
  LookupError,
  Phase,
  PiEntry,
  PiEvent,
  PiMessage,
  SessionId,
  ThinkingLevel,
} from "./contract-foundation";
import { GitActionId } from "./git-actions";

/** Maximum attachments carried by one prompt verb. */
export const PROMPT_IMAGE_MAX_COUNT = 8;
/** Maximum decoded bytes carried by one prompt image. */
export const PROMPT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Maximum base64 characters representing one prompt image. */
export const PROMPT_IMAGE_MAX_BASE64_LENGTH = Math.ceil(PROMPT_IMAGE_MAX_BYTES / 3) * 4;

const promptImageData = Schema.makeFilter<string>((data) => {
  if (data.length > PROMPT_IMAGE_MAX_BASE64_LENGTH || data.length % 4 !== 0) return false;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const contentLength = data.length - padding;
  if (data.slice(0, contentLength).includes("=")) return false;
  if (Math.floor((data.length * 3) / 4) - padding > PROMPT_IMAGE_MAX_BYTES) return false;
  for (let index = 0; index < contentLength; index += 1) {
    const code = data.charCodeAt(index);
    if (
      !(code >= 48 && code <= 57) &&
      !(code >= 65 && code <= 90) &&
      !(code >= 97 && code <= 122) &&
      code !== 43 &&
      code !== 47
    ) {
      return false;
    }
  }
  return true;
});

/** One image riding a prompt verb. */
export const PromptImage = Schema.Struct({
  data: Schema.NonEmptyString.check(
    Schema.isMaxLength(PROMPT_IMAGE_MAX_BASE64_LENGTH),
    promptImageData,
  ),
  mimeType: Schema.NonEmptyString.check(
    Schema.isPattern(/^image\/[a-z0-9][a-z0-9.+-]*$/i),
    Schema.isMaxLength(100),
  ),
}).annotate({ identifier: "SessionPromptImage" });
export type PromptImage = typeof PromptImage.Type;

const PromptImages = Schema.Array(PromptImage).check(Schema.isMaxLength(PROMPT_IMAGE_MAX_COUNT));

/** A prompt verb carried neither text nor an image. */
export class EmptyMessageError extends Schema.TaggedErrorClass<EmptyMessageError>()(
  "SessionEmptyMessageError",
  {
    code: Schema.tag("session.empty_message"),
    message: Schema.tag("A message needs text or an image."),
  },
) {}

const MessageError = Schema.Union([LookupError, EmptyMessageError]);

/**
 * The revised user message committed, but work after that commit failed.
 *
 * A caller must keep the revised branch selected. `stage` says whether the
 * agent run itself failed or the final checkpoint settlement failed after a
 * successful run. `reason` preserves the readable message from the original
 * failure without exposing an unstructured cause on the wire.
 */
export class EditMessageCommittedError extends Schema.TaggedErrorClass<EditMessageCommittedError>()(
  "SessionEditMessageCommittedError",
  {
    code: Schema.tag("session.edit_message_committed"),
    message: Schema.tag("The edited message was saved before this failure."),
    stage: Schema.Literals(["run", "settlement"]),
    reason: Schema.NonEmptyString,
  },
) {
  static from(stage: "run" | "settlement", error: Error): EditMessageCommittedError {
    const detail = error.message || error.name;
    return new EditMessageCommittedError({
      stage,
      reason: detail.length > 0 ? detail : "Unknown failure",
    });
  }
}

/** Sends a prompt and settles at Pi's prompt settlement point. */
export const Prompt = Rpc.make("session.prompt", {
  payload: {
    sessionId: SessionId,
    text: Schema.String,
    images: Schema.optionalKey(PromptImages),
  },
  error: MessageError,
});

/** Replaces one committed user message by branching from its parent. */
export const EditMessage = Rpc.make("session.edit_message", {
  payload: {
    sessionId: SessionId,
    entryId: Schema.NonEmptyString,
    text: Schema.String,
    images: Schema.optionalKey(PromptImages),
    /** Optional overrides applied on the new sibling branch before its prompt. */
    model: Schema.optionalKey(Models.ModelRef),
    thinkingLevel: Schema.optionalKey(ThinkingLevel),
  },
  error: Schema.Union([MessageError, Models.AvailableError, EditMessageCommittedError]),
});

/** The queued messages cleared by {@link Abort}. */
export const AbortOutput = Schema.Struct({
  clearedSteer: Schema.Array(PiMessage),
  clearedFollowUp: Schema.Array(PiMessage),
}).annotate({ identifier: "SessionAbortOutput" });
export type AbortOutput = typeof AbortOutput.Type;

/** Ends the current run and returns the queued messages it cleared. */
export const Abort = Rpc.make("session.abort", {
  payload: { sessionId: SessionId },
  success: AbortOutput,
  error: LookupError,
});

/** Runs an agent-driven Git action. */
export const RunGitAction = Rpc.make("session.run_git_action", {
  payload: {
    sessionId: SessionId,
    action: GitActionId,
    files: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  },
  error: LookupError,
});

/** Runs one workspace skill using Pi's canonical invocation formatting. */
export const RunSkill = Rpc.make("session.run_skill", {
  payload: {
    sessionId: SessionId,
    name: Schema.NonEmptyString,
    instructions: Schema.optionalKey(Schema.String),
  },
  error: LookupError,
});

/** Runs one workspace command using Pi's canonical argument parsing. */
export const RunCommand = Rpc.make("session.run_command", {
  payload: {
    sessionId: SessionId,
    name: Schema.NonEmptyString,
    args: Schema.optionalKey(Schema.String),
  },
  error: LookupError,
});

/** Interjects into the run already in progress. */
export const Steer = Rpc.make("session.steer", {
  payload: {
    sessionId: SessionId,
    text: Schema.String,
    images: Schema.optionalKey(PromptImages),
  },
  error: MessageError,
});

/** Queues a message to send after the current run finishes. */
export const FollowUp = Rpc.make("session.follow_up", {
  payload: {
    sessionId: SessionId,
    text: Schema.String,
    images: Schema.optionalKey(PromptImages),
  },
  error: MessageError,
});

/** One authoritative committed read plus Pi's append-log cursor. */
export const ReloadOutput = Schema.Struct({
  entries: Schema.Array(PiEntry),
  phase: Phase,
  entrySeq: Schema.Natural,
}).annotate({ identifier: "ReloadOutput" });
export type ReloadOutput = typeof ReloadOutput.Type;

/** Reads the committed session authoritatively. */
export const Reload = Rpc.make("session.reload", {
  payload: {
    sessionId: SessionId,
    afterEntrySeq: Schema.optionalKey(Schema.Natural),
  },
  success: ReloadOutput,
  error: LookupError,
});

/** One frame of the live session event stream. */
export const EventsFrame = Schema.Union([
  Schema.Struct({ type: Schema.Literal("live") }),
  Schema.Struct({ type: Schema.Literal("event"), event: PiEvent }),
]).annotate({ identifier: "EventsFrame" });
export type EventsFrame = typeof EventsFrame.Type;

/** Subscribes to advisory live harness events for one session. */
export const Events = Rpc.make("session.events", {
  payload: { sessionId: SessionId },
  success: EventsFrame,
  error: LookupError,
  stream: true,
});
