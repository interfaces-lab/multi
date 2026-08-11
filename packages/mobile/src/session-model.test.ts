import { describe, expect, it } from "vitest";

import type { Session } from "@honk/core/session";
import { SessionId } from "../../core/src/session/contract-foundation";

import type {
  ComposerMessage,
  SessionAssistantMessage,
  SessionModelEvent,
  SessionState,
  SessionUserMessage,
} from "./session-model";
import {
  EMPTY_QUEUE,
  clearedMessageOf,
  composerMessageOf,
  initialSessionState,
  mergeRecoveredDraft,
  queueSnapshotOf,
  reduceSession,
  sessionActionsEnabled,
  transcriptRows,
} from "./session-model";

type MessageEntry = Extract<Session.SessionTreeEntry, { readonly type: "message" }>;
type EntryMessage = MessageEntry["message"];

const sessionId = SessionId.make("session-1");
const otherSessionId = SessionId.make("session-2");
const ENTRY_TIMESTAMP = "2026-08-09T12:00:00.000Z";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const userMessage = (
  content: SessionUserMessage["content"],
  timestamp = 1,
): SessionUserMessage => ({
  role: "user",
  content,
  timestamp,
});

const assistantMessage = ({
  content,
  stopReason = "stop",
  timestamp = 2,
  errorMessage,
}: {
  readonly content: SessionAssistantMessage["content"];
  readonly stopReason?: SessionAssistantMessage["stopReason"];
  readonly timestamp?: number;
  readonly errorMessage?: string;
}): SessionAssistantMessage => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  usage,
  stopReason,
  timestamp,
  ...(errorMessage === undefined ? {} : { errorMessage }),
});

const messageEntry = (id: string, message: EntryMessage): Session.SessionTreeEntry => ({
  type: "message",
  id,
  parentId: null,
  timestamp: ENTRY_TIMESTAMP,
  message,
});

const stateFrame = (
  entries: readonly Session.SessionTreeEntry[],
  phase: Session.Phase = "idle",
  turns: Session.ChangesOutput["turns"] = [],
): SessionModelEvent => ({ type: "state", entries, phase, turns });

const piEvent = (event: Session.AgentHarnessEvent): SessionModelEvent => ({
  type: "event",
  event,
});

const assistantUpdate = (message: SessionAssistantMessage): SessionModelEvent =>
  piEvent({
    type: "message_update",
    message,
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "delta",
      partial: message,
    },
  });

const queueUpdate = ({
  steer = [],
  followUp = [],
  nextTurn = [],
}: {
  readonly steer?: EntryMessage[];
  readonly followUp?: EntryMessage[];
  readonly nextTurn?: EntryMessage[];
} = {}): Extract<Session.AgentHarnessEvent, { readonly type: "queue_update" }> => ({
  type: "queue_update",
  steer,
  followUp,
  nextTurn,
});

const fold = (
  events: readonly SessionModelEvent[],
  from: SessionState = initialSessionState,
): SessionState => events.reduce(reduceSession, from);

describe("session reducer", () => {
  it("stays connecting until an authoritative frame reports the exact Pi phase", () => {
    const attached = reduceSession(initialSessionState, { type: "attached", sessionId });
    expect(attached.health).toEqual({ type: "connecting" });
    expect(sessionActionsEnabled(attached)).toBe(false);

    const live = reduceSession(attached, stateFrame([], "branch_summary"));
    expect(live.health).toEqual({ type: "live", phase: "branch_summary" });
    expect(sessionActionsEnabled(live)).toBe(true);
  });

  it("lets authoritative frames replace entries and retire stale live text", () => {
    const first = messageEntry("u1", userMessage("old"));
    const replacement = messageEntry("u2", userMessage("new"));
    const live = assistantMessage({ content: [{ type: "text", text: "draft answer" }] });
    const state = fold([
      { type: "attached", sessionId },
      stateFrame([first], "turn"),
      assistantUpdate(live),
      stateFrame([replacement], "compaction", [{ entryId: "u2", files: [] }]),
    ]);

    expect(state.entries).toEqual([replacement]);
    expect(state.turns).toEqual([{ entryId: "u2", files: [] }]);
    expect(state.liveAssistant).toBeNull();
    expect(state.health).toEqual({ type: "live", phase: "compaction" });
  });

  it("folds assistant updates and ends without mistaking user messages for live output", () => {
    const live = assistantMessage({ content: [{ type: "text", text: "Hello" }] });
    const streaming = fold([
      { type: "attached", sessionId },
      stateFrame([], "turn"),
      assistantUpdate(live),
    ]);
    expect(streaming.liveAssistant).toBe(live);

    const userEnd = reduceSession(
      streaming,
      piEvent({ type: "message_end", message: userMessage("prompt") }),
    );
    expect(userEnd.liveAssistant).toBe(live);

    const assistantEnd = reduceSession(userEnd, piEvent({ type: "message_end", message: live }));
    expect(assistantEnd.liveAssistant).toBeNull();
  });

  it("replaces queue snapshots wholesale and settlement clears the queue and live output", () => {
    const live = assistantMessage({ content: [{ type: "text", text: "Working" }] });
    const first = fold([
      { type: "attached", sessionId },
      stateFrame([], "turn"),
      assistantUpdate(live),
      piEvent(
        queueUpdate({
          steer: [userMessage("nudge")],
          followUp: [userMessage("then test")],
        }),
      ),
    ]);

    const replaced = reduceSession(
      first,
      piEvent(queueUpdate({ nextTurn: [userMessage("next turn")] })),
    );
    expect(replaced.queue).toEqual({
      steer: [],
      followUp: [],
      nextTurn: [{ text: "next turn", images: [] }],
    });

    const settled = reduceSession(replaced, piEvent({ type: "settled", nextTurnCount: 0 }));
    expect(settled.queue).toBe(EMPTY_QUEUE);
    expect(settled.liveAssistant).toBeNull();
    expect(settled.health).toEqual({ type: "live", phase: "idle" });
  });

  it("clears ephemeral state on attach while retaining only the matching session transcript", () => {
    const entry = messageEntry("u1", userMessage("committed"));
    const live = assistantMessage({ content: [{ type: "text", text: "partial" }] });
    const connected = fold([
      { type: "attached", sessionId },
      stateFrame([entry], "turn"),
      assistantUpdate(live),
      piEvent(queueUpdate({ steer: [userMessage("queued")] })),
    ]);

    const reconnecting = reduceSession(connected, { type: "attached", sessionId });
    expect(reconnecting.entries).toEqual([entry]);
    expect(reconnecting.liveAssistant).toBeNull();
    expect(reconnecting.queue).toBe(EMPTY_QUEUE);
    expect(reconnecting.health).toEqual({ type: "connecting" });

    const switched = reduceSession(connected, { type: "attached", sessionId: otherSessionId });
    expect(switched.entries).toEqual([]);
  });

  it("terminal stream states disable actions but keep committed entries", () => {
    const entry = messageEntry("u1", userMessage("committed"));
    const ready = fold([{ type: "attached", sessionId }, stateFrame([entry])]);

    const disconnected = reduceSession(ready, { type: "stream_ended" });
    expect(disconnected.health).toEqual({ type: "disconnected" });
    expect(disconnected.entries).toEqual([entry]);
    expect(sessionActionsEnabled(disconnected)).toBe(false);

    const failed = reduceSession(ready, { type: "failed", message: "session.not_found" });
    expect(failed.health).toEqual({ type: "failed", message: "session.not_found" });
    expect(failed.entries).toEqual([entry]);
    expect(sessionActionsEnabled(failed)).toBe(false);
  });

  it("ignores advisory frames that arrive after a terminal stream state", () => {
    const entry = messageEntry("u1", userMessage("committed"));
    const ended = fold([
      { type: "attached", sessionId },
      stateFrame([entry]),
      { type: "stream_ended" },
    ]);
    const late = reduceSession(
      ended,
      assistantUpdate(assistantMessage({ content: [{ type: "text", text: "late" }] })),
    );
    expect(late).toBe(ended);
  });
});

describe("transcript rows", () => {
  it("projects only user messages as bubble rows and keeps image-only prompts visible", () => {
    const state = fold([
      stateFrame([
        messageEntry(
          "u1",
          userMessage([
            { type: "text", text: "  exact prompt\n" },
            { type: "image", data: "pixel-1", mimeType: "image/png" },
          ]),
        ),
        messageEntry(
          "u2",
          userMessage([{ type: "image", data: "pixel-2", mimeType: "image/jpeg" }]),
        ),
        messageEntry("u3", userMessage("   ")),
        messageEntry(
          "a1",
          assistantMessage({
            content: [
              { type: "text", text: "First" },
              { type: "thinking", thinking: "private" },
              { type: "text", text: "Second" },
            ],
          }),
        ),
      ]),
    ]);

    expect(transcriptRows(state)).toEqual([
      { kind: "user", id: "u1", text: "  exact prompt\n", imageCount: 1 },
      { kind: "user", id: "u2", text: "", imageCount: 1 },
      { kind: "user", id: "u3", text: "   ", imageCount: 0 },
      {
        kind: "assistant",
        source: "committed",
        id: "a1",
        text: "First\n\nSecond",
        outcome: { type: "complete" },
      },
    ]);
  });

  it("shows working status for every non-idle phase until live assistant text exists", () => {
    const phases: readonly Exclude<Session.Phase, "idle">[] = [
      "turn",
      "compaction",
      "branch_summary",
      "retry",
    ];
    for (const phase of phases) {
      const working = fold([stateFrame([], phase)]);
      expect(transcriptRows(working)).toEqual([{ kind: "working", id: "session-working", phase }]);
    }

    const live = assistantMessage({ content: [{ type: "text", text: "Now writing" }] });
    const writing = fold([stateFrame([], "turn"), assistantUpdate(live)]);
    expect(transcriptRows(writing)).toEqual([
      {
        kind: "assistant",
        source: "live",
        id: "live-assistant:2",
        text: "Now writing",
      },
    ]);
  });

  it("suppresses committed blocks replayed by the live message at the commit seam", () => {
    const committed = assistantMessage({
      content: [{ type: "text", text: "Already committed" }],
      timestamp: 10,
    });
    const replay = assistantMessage({
      content: [
        { type: "text", text: "Already committed" },
        { type: "text", text: "Still streaming" },
      ],
      timestamp: 10,
    });
    const state = fold([
      stateFrame([messageEntry("u1", userMessage("go")), messageEntry("a1", committed)], "turn"),
      assistantUpdate(replay),
    ]);

    expect(transcriptRows(state)).toEqual([
      { kind: "user", id: "u1", text: "go", imageCount: 0 },
      {
        kind: "assistant",
        source: "committed",
        id: "a1",
        text: "Already committed",
        outcome: { type: "complete" },
      },
      {
        kind: "assistant",
        source: "live",
        id: "live-assistant:10",
        text: "Still streaming",
      },
    ]);
  });

  it("does not suppress the same assistant words after a new user turn", () => {
    const repeated = assistantMessage({ content: [{ type: "text", text: "Done" }] });
    const state = fold([
      stateFrame(
        [
          messageEntry("u1", userMessage("first")),
          messageEntry("a1", repeated),
          messageEntry("u2", userMessage("again")),
        ],
        "turn",
      ),
      assistantUpdate(repeated),
    ]);

    expect(transcriptRows(state).at(-1)).toEqual({
      kind: "assistant",
      source: "live",
      id: "live-assistant:2",
      text: "Done",
    });
  });

  it("keeps persisted stopped and failed outcomes visible even without text", () => {
    const state = fold([
      stateFrame([
        messageEntry(
          "stopped",
          assistantMessage({ content: [], stopReason: "aborted", timestamp: 3 }),
        ),
        messageEntry(
          "failed",
          assistantMessage({
            content: [],
            stopReason: "error",
            timestamp: 4,
            errorMessage: "Provider unavailable",
          }),
        ),
      ]),
    ]);

    expect(transcriptRows(state)).toEqual([
      {
        kind: "assistant",
        source: "committed",
        id: "stopped",
        text: "",
        outcome: { type: "stopped" },
      },
      {
        kind: "assistant",
        source: "committed",
        id: "failed",
        text: "",
        outcome: { type: "failed", message: "Provider unavailable" },
      },
    ]);
  });
});

describe("composer and queue projection", () => {
  const firstImage = { data: "pixel-1", mimeType: "image/png" };
  const secondImage = { data: "pixel-2", mimeType: "image/jpeg" };

  it("extracts exact user whitespace and images", () => {
    expect(
      composerMessageOf(
        userMessage([
          { type: "text", text: "  first\n" },
          { type: "image", ...firstImage },
          { type: "text", text: "\tsecond  " },
        ]),
      ),
    ).toEqual({ text: "  first\n\n\tsecond  ", images: [firstImage] });
    expect(composerMessageOf(userMessage("  string content\n"))).toEqual({
      text: "  string content\n",
      images: [],
    });
  });

  it("projects queue buckets independently, preserving whitespace and image-only messages", () => {
    const assistant = assistantMessage({ content: [{ type: "text", text: "not queued by user" }] });
    const snapshot = queueSnapshotOf(
      queueUpdate({
        steer: [
          userMessage("   "),
          userMessage([{ type: "image", ...firstImage }]),
          userMessage(""),
          assistant,
        ],
        followUp: [userMessage("later")],
      }),
    );

    expect(snapshot).toEqual({
      steer: [
        { text: "   ", images: [] },
        { text: "", images: [firstImage] },
      ],
      followUp: [{ text: "later", images: [] }],
      nextTurn: [],
    });
  });

  it("recovers cleared user work in bucket order without trimming", () => {
    const cleared: Session.AbortOutput = {
      clearedSteer: [
        userMessage([
          { type: "text", text: "  steer\n" },
          { type: "image", ...firstImage },
        ]),
        assistantMessage({ content: [{ type: "text", text: "ignore" }] }),
      ],
      clearedFollowUp: [
        userMessage([{ type: "image", ...secondImage }]),
        userMessage("\tfollow-up  "),
      ],
    };

    expect(clearedMessageOf(cleared)).toEqual({
      text: "  steer\n\n\n\tfollow-up  ",
      images: [firstImage, secondImage],
    });
  });

  it("puts recovered content before a newer draft without using trim as a merge rule", () => {
    const recovered: ComposerMessage = { text: "  recovered\n", images: [firstImage] };
    const newer: ComposerMessage = { text: "\tnewer  ", images: [secondImage] };
    expect(mergeRecoveredDraft({ recovered, newer })).toEqual({
      text: "  recovered\n\n\n\tnewer  ",
      images: [firstImage, secondImage],
    });

    expect(
      mergeRecoveredDraft({
        recovered: { text: "   ", images: [] },
        newer: { text: "", images: [] },
      }).text,
    ).toBe("   ");
  });
});
