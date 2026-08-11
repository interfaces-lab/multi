import { describe, expect, it } from "vitest";

import { Session } from "@honk/core/session";
import { Schema } from "effect";

import type { ChatEvent, ChatState, StreamingAssistantMessage, TurnStep } from "./chat-model";
import {
  FUSION_STOPS,
  THINKING_LEVELS,
  clearedMessageOf,
  conversationItems,
  effectiveLayer,
  initialState,
  modelSelectionOfEntries,
  reduce,
  segmentRows,
  tickerOf,
  turnViews,
} from "./chat-model";
import { decodeFusionStop, decodeThinkingLevel } from "./selection";

const fold = (events: readonly ChatEvent[], from: ChatState = initialState): ChatState =>
  events.reduce(reduce, from);

type MessageEntry = Extract<Session.SessionTreeEntry, { readonly type: "message" }>;
type PiMessage = MessageEntry["message"];
type PiUserMessage = Extract<PiMessage, { readonly role: "user" }>;
type PiToolResultMessage = Extract<PiMessage, { readonly role: "toolResult" }>;
type PiToolCall = Extract<
  StreamingAssistantMessage["content"][number],
  { readonly type: "toolCall" }
>;
type ModelUpdateEvent = Extract<Session.AgentHarnessEvent, { readonly type: "model_update" }>;

const sessionId = Session.SessionId.make("session-1");
const decodePiEntry = Schema.decodeUnknownSync(Session.PiEntry);
const ENTRY_TIMESTAMP = "2026-08-05T10:00:00.000Z";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistantMessage = (
  content: StreamingAssistantMessage["content"],
  stopReason: StreamingAssistantMessage["stopReason"] = "stop",
  timestamp = 1,
  errorMessage?: string,
): StreamingAssistantMessage => ({
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

const userMessage = (content: PiUserMessage["content"], timestamp = 1): PiUserMessage => ({
  role: "user",
  content,
  timestamp,
});

const toolResultMessage = (
  toolCallId: string,
  text = "done",
  timestamp = 1,
  details?: unknown,
): PiToolResultMessage => ({
  role: "toolResult",
  toolCallId,
  toolName: "fixture-tool",
  isError: false,
  content: [{ type: "text", text }],
  timestamp,
  ...(details === undefined ? {} : { details }),
});

const messageEntry = (
  id: string,
  message: PiMessage,
  timestamp = ENTRY_TIMESTAMP,
): Session.SessionTreeEntry => ({
  type: "message",
  id,
  parentId: null,
  timestamp,
  message,
});

const piEvent = (event: Session.AgentHarnessEvent): ChatEvent => ({
  type: "event",
  event,
});

const assistantUpdate = (text: string): ChatEvent => {
  const message = assistantMessage([{ type: "text", text }]);
  return piEvent({
    type: "message_update",
    message,
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: text,
      partial: message,
    },
  });
};

const model = (provider: string, id: string): ModelUpdateEvent["model"] => ({
  id,
  name: id,
  api: "anthropic-messages",
  provider,
  baseUrl: "https://example.test",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 8_192,
});

const stateFrame = (
  entries: readonly Session.SessionTreeEntry[],
  phase: Session.Phase = "idle",
  turns: Session.ChangesOutput["turns"] = [],
): ChatEvent => ({ type: "state", entries, phase, turns });

const userEntry = (id: string, text: string): Session.SessionTreeEntry =>
  messageEntry(id, userMessage([{ type: "text", text }]));

const assistantBlocksEntry = (
  id: string,
  content: StreamingAssistantMessage["content"],
  timestamp = ENTRY_TIMESTAMP,
  stopReason: StreamingAssistantMessage["stopReason"] = "stop",
  errorMessage?: string,
): Session.SessionTreeEntry =>
  messageEntry(
    id,
    assistantMessage(content, stopReason, Date.parse(timestamp), errorMessage),
    timestamp,
  );

const assistantEntry = (id: string, text: string): Session.SessionTreeEntry =>
  assistantBlocksEntry(id, [{ type: "text", text }]);

const toolResultEntry = (
  id: string,
  toolCallId: string,
  text = "done",
  timestamp = ENTRY_TIMESTAMP,
  details?: unknown,
): Session.SessionTreeEntry =>
  messageEntry(id, toolResultMessage(toolCallId, text, Date.parse(timestamp), details), timestamp);

const customEntry = (id: string, customType: string, data?: unknown): Session.SessionTreeEntry => ({
  type: "custom",
  id,
  parentId: null,
  timestamp: ENTRY_TIMESTAMP,
  customType,
  ...(data === undefined ? {} : { data }),
});

// Pi stores the level as a plain string; the fold validates it.
const thinkingChange = (id: string, thinkingLevel: string): Session.SessionTreeEntry => ({
  type: "thinking_level_change",
  id,
  parentId: null,
  timestamp: ENTRY_TIMESTAMP,
  thinkingLevel,
});

const modelChange = (id: string, provider: string, modelId: string): Session.SessionTreeEntry => ({
  type: "model_change",
  id,
  parentId: null,
  timestamp: ENTRY_TIMESTAMP,
  provider,
  modelId,
});

const malformedModelChange = (
  id: string,
  provider: unknown,
  modelId: unknown,
): Session.SessionTreeEntry =>
  decodePiEntry({
    type: "model_change",
    id,
    parentId: null,
    timestamp: ENTRY_TIMESTAMP,
    provider,
    modelId,
  });

describe("chat model", () => {
  it("starts connecting with an empty transcript", () => {
    expect(initialState.status).toBe("connecting");
    expect(initialState.sessionId).toBeNull();
    expect(initialState.entries).toEqual([]);
    expect(initialState.turns).toEqual([]);
    expect(initialState.error).toBeNull();
    expect(initialState.streamingMessage).toBeNull();
    expect(initialState.thinkingLevel).toBeNull();
    expect(initialState.model).toBeNull();
  });

  it("attached records the session id but stays connecting until the first state frame", () => {
    const state = fold([{ type: "attached", sessionId }]);
    expect(state.sessionId).toBe(sessionId);
    expect(state.status).toBe("connecting");
  });

  it("the attach state frame makes the chat ready to prompt", () => {
    const state = fold([{ type: "attached", sessionId }, stateFrame([])]);
    expect(state.status).toBe("ready");
  });

  it("keeps the final assistant value through the live-to-commit seam", () => {
    const streaming = fold([
      { type: "attached", sessionId },
      stateFrame([userEntry("u1", "hi")]),
      piEvent({ type: "agent_start" }),
      assistantUpdate("Hel"),
      assistantUpdate("Hello"),
    ]);
    expect(streaming.status).toBe("running");
    expect(streaming.streamingMessage).not.toBeNull();

    const ended = fold(
      [
        piEvent({
          type: "message_end",
          message: assistantMessage([{ type: "text", text: "Hello" }]),
        }),
      ],
      streaming,
    );
    expect(ended.streamingMessage?.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(conversationItems(ended.entries, ended.streamingMessage)[0]).toMatchObject({
      kind: "turn",
      turn: { summary: "Hello" },
    });

    const committed = reduce(
      ended,
      stateFrame([userEntry("u1", "hi"), assistantEntry("a1", "Hello")], "turn"),
    );
    expect(committed.streamingMessage).not.toBeNull();
    expect(conversationItems(committed.entries, committed.streamingMessage)[0]).toMatchObject({
      kind: "turn",
      turn: { summary: "Hello" },
    });

    const settled = reduce(committed, piEvent({ type: "settled", nextTurnCount: 0 }));
    expect(settled.streamingMessage).toBeNull();
    expect(conversationItems(settled.entries, settled.streamingMessage)[0]).toMatchObject({
      kind: "turn",
      turn: { summary: "Hello" },
    });
  });

  it("authoritative state replaces entries, receipts, and run phase wholesale", () => {
    const turns: Session.ChangesOutput["turns"] = [{ entryId: "u1", files: [] }];
    const settled = fold([
      { type: "attached", sessionId },
      stateFrame([]),
      piEvent({ type: "agent_start" }),
      piEvent({ type: "settled", nextTurnCount: 0 }),
      stateFrame([userEntry("u1", "hi")], "idle", turns),
    ]);
    expect(settled.status).toBe("ready");
    expect(settled.entries).toHaveLength(1);
    expect(settled.turns).toBe(turns);
  });

  it("a state frame reporting a running harness wins over local guesses", () => {
    const state = fold([{ type: "attached", sessionId }, stateFrame([], "turn")]);
    expect(state.status).toBe("running");
  });

  it("derives the thinking level from the transcript's last record", () => {
    const state = fold([
      { type: "attached", sessionId },
      stateFrame([
        thinkingChange("t1", "low"),
        userEntry("u1", "hi"),
        thinkingChange("t2", "high"),
      ]),
    ]);
    expect(state.thinkingLevel).toBe("high");
  });

  it("a thinking_level_update event moves the level before the record commits", () => {
    const state = fold([
      { type: "attached", sessionId },
      stateFrame([]),
      piEvent({ type: "thinking_level_update", level: "max", previousLevel: "off" }),
    ]);
    expect(state.thinkingLevel).toBe("max");
  });

  it("an unknown stored level reads as no record, not a guess", () => {
    const state = fold([
      { type: "attached", sessionId },
      stateFrame([thinkingChange("t1", "ultra")]),
    ]);
    expect(state.thinkingLevel).toBeNull();
  });

  it("derives the model from the transcript's last record", () => {
    const state = fold([
      { type: "attached", sessionId },
      stateFrame([
        modelChange("m1", "anthropic", "claude-sonnet-4-6"),
        userEntry("u1", "hi"),
        modelChange("m2", "openai", "gpt-5-codex"),
      ]),
    ]);
    expect(state.model).toEqual({ providerId: "openai", modelId: "gpt-5-codex" });
  });

  it("derives the model intent inherited by an edited branch", () => {
    const entries = [
      modelChange("m1", "anthropic", "claude-sonnet-4-6"),
      thinkingChange("t1", "high"),
    ];
    expect(modelSelectionOfEntries(entries)).toEqual({
      kind: "model",
      model: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
      thinkingLevel: "high",
    });
    expect(
      modelSelectionOfEntries([...entries, customEntry("fusion", "honk.fusion", { stop: "claw" })]),
    ).toEqual({ kind: "fusion", stop: "claw" });
  });

  it("a model_update event moves the model before the record commits", () => {
    const state = fold([
      { type: "attached", sessionId },
      stateFrame([modelChange("m1", "anthropic", "claude-sonnet-4-6")]),
      piEvent({
        type: "model_update",
        model: model("openai", "gpt-5-codex"),
        previousModel: model("anthropic", "claude-sonnet-4-6"),
        source: "set",
      }),
    ]);
    expect(state.model).toEqual({ providerId: "openai", modelId: "gpt-5-codex" });
  });

  it("a transcript with no usable record reads as no model, not a guess", () => {
    expect(
      fold([{ type: "attached", sessionId }, stateFrame([userEntry("u1", "hi")])]).model,
    ).toBeNull();
    expect(fold([stateFrame([modelChange("m1", "anthropic", "")])]).model).toBeNull();
    expect(
      fold([stateFrame([malformedModelChange("m1", undefined, "gpt-5-codex")])]).model,
    ).toBeNull();
    // The last record wins even when it is the unusable one.
    expect(
      fold([
        stateFrame([
          modelChange("m1", "anthropic", "claude-sonnet-4-6"),
          malformedModelChange("m2", 7, 7),
        ]),
      ]).model,
    ).toBeNull();
  });

  it("the rendered vocabularies are core's schema literals, not copies", () => {
    expect(THINKING_LEVELS).toEqual(Session.ThinkingLevel.literals);
    expect(FUSION_STOPS).toEqual(Session.FusionStop.literals);
    expect(decodeThinkingLevel("xhigh")).toBe("xhigh");
    expect(decodeThinkingLevel("ultra")).toBeNull();
    expect(decodeFusionStop("claw")).toBe("claw");
    expect(decodeFusionStop("turbo")).toBeNull();
  });

  it("stream end disconnects; failures carry the message", () => {
    const ready = fold([{ type: "attached", sessionId }, stateFrame([])]);
    expect(reduce(ready, { type: "stream_ended" }).status).toBe("disconnected");

    const failed = reduce(ready, { type: "failed", message: "session.not_found" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("session.not_found");
  });
});

describe("cleared messages", () => {
  const abortOutput = (
    clearedSteer: PiMessage[],
    clearedFollowUp: PiMessage[] = [],
  ): Session.AbortOutput => ({ clearedSteer, clearedFollowUp });

  it("restores the user's queued content, steer before follow-up", () => {
    const cleared = abortOutput(
      [
        userMessage([
          { type: "text", text: "also check the tests" },
          { type: "image", data: "pixel", mimeType: "image/png" },
        ]),
      ],
      [userMessage([{ type: "text", text: "then push" }])],
    );
    expect(clearedMessageOf(cleared)).toEqual({
      text: "also check the tests\n\nthen push",
      images: [{ data: "pixel", mimeType: "image/png" }],
    });
  });

  it("preserves queued whitespace exactly", () => {
    const cleared = abortOutput([userMessage([{ type: "text", text: "  indented\n" }])]);
    expect(clearedMessageOf(cleared).text).toBe("  indented\n");
  });

  it("keeps nothing that is not the user's own content", () => {
    const assistant = assistantMessage([{ type: "text", text: "half a thought" }]);
    expect(clearedMessageOf(abortOutput([assistant, userMessage("")]))).toEqual({
      text: "",
      images: [],
    });
    expect(clearedMessageOf(abortOutput([]))).toEqual({ text: "", images: [] });
  });
});

describe("queue fold", () => {
  const queueUpdate = (
    steer: PiMessage[],
    followUp: PiMessage[] = [],
    nextTurn: PiMessage[] = [],
  ): ChatEvent => piEvent({ type: "queue_update", steer, followUp, nextTurn });

  it("attach without a frame yields an empty queue", () => {
    const state = fold([{ type: "attached", sessionId }, stateFrame([], "turn")]);
    expect(state.queue).toEqual({ steer: [], followUp: [], nextTurn: [] });
  });

  it("a frame replaces the queue wholesale, never merges", () => {
    const first = fold([
      { type: "attached", sessionId },
      queueUpdate([userMessage("nudge left")], [userMessage("then the tests")]),
    ]);
    expect(first.queue).toEqual({
      steer: [{ text: "nudge left", images: [] }],
      followUp: [{ text: "then the tests", images: [] }],
      nextTurn: [],
    });

    const second = reduce(first, queueUpdate([], [], [userMessage("tomorrow's turn")]));
    expect(second.queue).toEqual({
      steer: [],
      followUp: [],
      nextTurn: [{ text: "tomorrow's turn", images: [] }],
    });
  });

  it("keeps only the user's messages in a bucket, including image-only messages", () => {
    const state = fold([
      queueUpdate([
        userMessage("real words"),
        userMessage([{ type: "image", data: "pixel", mimeType: "image/png" }]),
        assistantMessage([{ type: "text", text: "not yours" }]),
        userMessage("   "),
      ]),
    ]);
    expect(state.queue.steer).toEqual([
      { text: "real words", images: [] },
      { text: "", images: [{ data: "pixel", mimeType: "image/png" }] },
      { text: "   ", images: [] },
    ]);
  });

  it("settlement clears the queue with the run it described", () => {
    const running = fold([queueUpdate([userMessage("queued while running")])]);
    expect(running.queue.steer).toHaveLength(1);
    const settled = reduce(running, piEvent({ type: "settled", nextTurnCount: 0 }));
    expect(settled.queue).toEqual({ steer: [], followUp: [], nextTurn: [] });
  });
});

describe("conversation items", () => {
  it("renders each turn at its user entry, with markers interleaved in order", () => {
    const changedModel = modelChange("m1", "anthropic", "claude-sonnet-4-6");
    const compaction: Session.SessionTreeEntry = {
      type: "compaction",
      id: "c1",
      parentId: null,
      timestamp: ENTRY_TIMESTAMP,
      summary: "Earlier discussion about auth",
      tokensBefore: 52_000,
    };
    const label: Session.SessionTreeEntry = {
      type: "label",
      id: "l1",
      parentId: null,
      timestamp: ENTRY_TIMESTAMP,
      targetId: "u2",
      label: undefined,
    };

    const items = conversationItems(
      [
        userEntry("u1", "Say hello"),
        assistantEntry("a1", "Hello from faux"),
        changedModel,
        compaction,
        userEntry("u2", "again"),
        label,
      ],
      null,
    );
    expect(
      items.map((item) => (item.kind === "turn" ? `turn:${item.turn.id}` : item.kind)),
    ).toEqual(["turn:u1", "notice", "compaction", "turn:u2"]);
    expect(items[1]).toEqual({
      kind: "notice",
      id: "m1",
      text: "Model: anthropic/claude-sonnet-4-6",
    });
  });

  it("birth records never render: initial state is not a change", () => {
    const changedModel = modelChange("m1", "anthropic", "claude-sonnet-4-6");
    const items = conversationItems(
      [changedModel, thinkingChange("t1", "high"), userEntry("u1", "hi")],
      null,
    );
    expect(items.map((item) => item.kind)).toEqual(["turn"]);
  });

  it("renders a mid-conversation thinking level record as a quiet notice", () => {
    const items = conversationItems([userEntry("u1", "hi"), thinkingChange("t1", "high")], null);
    expect(items.at(-1)).toEqual({ kind: "notice", id: "t1", text: "Thinking level: high" });
  });

  it("handles plain string content", () => {
    const entry = messageEntry("u1", userMessage("plain"));
    const items = conversationItems([entry], null);
    expect(items[0]?.kind === "turn" && items[0].turn.userText).toBe("plain");
  });

  it("pairs a git action marker with the turn that follows it", () => {
    const marker = customEntry("g1", "honk.git_action", { action: "commitAndPush" });

    const items = conversationItems(
      [marker, userEntry("u1", "canonical instructions"), assistantEntry("a1", "Committed.")],
      null,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind === "turn" && items[0].gitAction).toBe("commitAndPush");
    // A typed turn carries no action.
    const typed = conversationItems([userEntry("u2", "hello")], null);
    expect(typed[0]?.kind === "turn" && typed[0].gitAction).toBeNull();
  });

  it("a marker with no turn after it renders as a failed action", () => {
    const marker = customEntry("g1", "honk.git_action", { action: "commit" });

    const items = conversationItems([userEntry("u1", "before"), marker], null);
    expect(items.map((item) => item.kind)).toEqual(["turn", "git_action_failed"]);
    expect(items[1]?.kind === "git_action_failed" && items[1].action).toBe("commit");
  });
});

describe("turn grammar", () => {
  const toolCall = (
    id: string,
    callId: string,
    name: string,
    headline?: string,
  ): Session.SessionTreeEntry => {
    const blocks: StreamingAssistantMessage["content"] = [
      { type: "toolCall", id: callId, name, arguments: { path: "a.ts" } },
    ];
    if (headline !== undefined) blocks.unshift({ type: "text", text: headline });
    return assistantBlocksEntry(id, blocks);
  };
  const result = (id: string, callId: string, text = "done"): Session.SessionTreeEntry =>
    toolResultEntry(id, callId, text);

  it("folds headline → steps → summary into one turn", () => {
    const turns = turnViews([
      userEntry("u1", "fix the test"),
      toolCall("a1", "c1", "read", "Rerunning tests from package level"),
      result("t1", "c1"),
      assistantEntry("a2", "All four suites are green now."),
    ]);
    expect(turns).toHaveLength(1);
    const turn = turns[0];
    expect(turn?.id).toBe("u1");
    expect(turn?.segments).toHaveLength(1);
    expect(turn?.segments[0]?.headline).toBe("Rerunning tests from package level");
    expect(turn?.segments[0]?.steps[0]).toMatchObject({
      key: "c1",
      name: "read",
      verb: "Read",
      detail: "a.ts",
      state: "ok",
      readShaped: true,
    });
    expect(turn?.summary).toBe("All four suites are green now.");
  });

  it("a new text block closes the segment and opens the next", () => {
    const turns = turnViews([
      userEntry("u1", "go"),
      toolCall("a1", "c1", "read", "Looking at the config"),
      result("t1", "c1"),
      toolCall("a2", "c2", "edit", "Fixing the transform"),
      result("t2", "c2"),
    ]);
    const segments = turns[0]?.segments ?? [];
    expect(segments.map((segment) => segment.headline)).toEqual([
      "Looking at the config",
      "Fixing the transform",
    ]);
    // edits never read-shape: they stay visible at every density.
    expect(segments[1]?.steps[0]?.readShaped).toBe(false);
  });

  it("tools without a preceding text block get a headline-less segment", () => {
    const turns = turnViews([userEntry("u1", "go"), toolCall("a1", "c1", "bash")]);
    expect(turns[0]?.segments[0]?.headline).toBeNull();
    expect(turns[0]?.segments[0]?.steps[0]?.state).toBe("running");
    expect(turns[0]?.summary).toBeNull();
  });

  it("splits turns on user messages", () => {
    const turns = turnViews([
      userEntry("u1", "first"),
      assistantEntry("a1", "Answered."),
      userEntry("u2", "second"),
      toolCall("a2", "c1", "read"),
    ]);
    expect(turns.map((turn) => turn.id)).toEqual(["u1", "u2"]);
    expect(turns[0]?.summary).toBe("Answered.");
    expect(turns[0]?.segments).toEqual([]);
    expect(turns[1]?.segments[0]?.steps[0]?.readShaped).toBe(true);
  });

  it("unknown tools never group: opaque classifies as not read-shaped", () => {
    const turns = turnViews([userEntry("u1", "go"), toolCall("a1", "c1", "some-mcp-tool")]);
    expect(turns[0]?.segments[0]?.steps[0]?.readShaped).toBe(false);
  });

  it("folds the streaming message into the open turn", () => {
    const streaming = assistantMessage(
      [
        { type: "text", text: "Reading the config first" },
        { type: "toolCall", id: "c9", name: "read", arguments: { path: "conf.ts" } },
        { type: "text", text: "The port was wrong" },
      ],
      "stop",
      1234,
    );

    const turns = turnViews([userEntry("u1", "fix it")], streaming);
    expect(turns).toHaveLength(1);
    const turn = turns[0];
    expect(turn?.segments).toHaveLength(1);
    expect(turn?.segments[0]?.headline).toBe("Reading the config first");
    expect(turn?.segments[0]?.steps[0]).toMatchObject({ key: "c9", state: "running" });
    // The trailing text is the summary-so-far: it streams outside the preview
    // window and becomes the next headline if another tool call arrives.
    expect(turn?.summary).toBe("The port was wrong");
  });

  it("attaches the change receipt to the turn that earned it", () => {
    const changes: Session.ChangesOutput["turns"] = [
      {
        entryId: "a1",
        files: [
          {
            file: "src/index.ts",
            status: "modified",
            tracked: true,
            binary: false,
            additions: 3,
            deletions: 1,
          },
        ],
      },
      { entryId: "a2", files: [] },
    ];

    const turns = turnViews(
      [
        userEntry("u1", "change it"),
        assistantEntry("a1", "done"),
        userEntry("u2", "and this"),
        assistantEntry("a2", "nothing to do"),
      ],
      null,
      changes,
    );
    expect(turns[0]?.files.map((file) => file.file)).toEqual(["src/index.ts"]);
    // A turn that touched nothing shows no receipt.
    expect(turns[1]?.files).toEqual([]);
  });

  it("a failed turn carries the model's error message", () => {
    const failed = assistantBlocksEntry(
      "a1",
      [],
      "2026-08-06T10:00:01.000Z",
      "error",
      "overloaded_error",
    );
    const turns = turnViews([userEntry("u1", "go"), failed]);
    expect(turns[0]?.outcome).toBe("failed");
    expect(turns[0]?.error).toBe("overloaded_error");
  });

  it("a segment keeps its identity across the live-to-commit seam", () => {
    const call: StreamingAssistantMessage["content"][number] = {
      type: "toolCall",
      id: "c1",
      name: "read",
      arguments: { path: "a.ts" },
    };
    const streaming = assistantMessage([{ type: "text", text: "Looking" }, call], "stop", 1234);

    const live = turnViews([userEntry("u1", "go")], streaming);
    const committed = turnViews([
      userEntry("u1", "go"),
      assistantBlocksEntry("a1", [{ type: "text", text: "Looking" }, call]),
    ]);
    // The first call is the segment's name, so an open row survives commit.
    expect(live[0]?.segments[0]?.id).toBe("c1");
    expect(committed[0]?.segments[0]?.id).toBe("c1");
  });

  it("the commit seam renders the work once, not twice", () => {
    const blocks: StreamingAssistantMessage["content"] = [
      { type: "text", text: "Reading the config" },
      { type: "toolCall", id: "c1", name: "read", arguments: { path: "conf.ts" } },
      { type: "text", text: "The port was wrong." },
    ];
    const streaming = assistantMessage(blocks, "stop", 1234);
    // Pi's state frame commits the assistant entry before message_end retires
    // the live message: for that window both carry the same blocks.
    const turns = turnViews(
      [userEntry("u1", "fix it"), assistantBlocksEntry("a1", blocks)],
      streaming,
    );

    expect(turns[0]?.segments).toHaveLength(1);
    expect(turns[0]?.segments[0]?.steps.map((step) => step.key)).toEqual(["c1"]);
    expect(turns[0]?.summary).toBe("The port was wrong.");
  });

  it("the seam is a within-turn concern: a repeated answer still streams", () => {
    const streaming = assistantMessage([{ type: "text", text: "Done." }], "stop", 1234);

    const turns = turnViews(
      [userEntry("u1", "first"), assistantEntry("a1", "Done."), userEntry("u2", "again")],
      streaming,
    );
    expect(turns.map((turn) => turn.summary)).toEqual(["Done.", "Done."]);
  });

  it("an edit's patch and stats ride the tool result's details", () => {
    const patch = [
      "--- src/value.ts",
      "+++ src/value.ts",
      "@@ -1 +1 @@",
      "-export const value = 1;",
      "+export const value = 2;",
    ].join("\n");
    const turns = turnViews([
      userEntry("u1", "bump it"),
      assistantBlocksEntry("a1", [
        { type: "toolCall", id: "c1", name: "edit", arguments: { path: "src/value.ts" } },
      ]),
      toolResultEntry("t1", "c1", "Edit applied", ENTRY_TIMESTAMP, { patch, diff: "…" }),
    ]);

    expect(turns[0]?.segments[0]?.steps[0]).toMatchObject({
      verb: "Edited",
      detail: "src/value.ts",
      patch,
      added: 1,
      removed: 1,
      content: null,
    });
  });

  it("a write carries its own text and no invented stats", () => {
    const turns = turnViews([
      userEntry("u1", "make it"),
      assistantBlocksEntry("a1", [
        {
          type: "toolCall",
          id: "c1",
          name: "write",
          arguments: { path: "src/new.ts", content: "const one = 1;\nconst two = 2;\n" },
        },
      ]),
      result("t1", "c1", "Wrote src/new.ts"),
    ]);

    expect(turns[0]?.segments[0]?.steps[0]).toMatchObject({
      verb: "Wrote",
      detail: "src/new.ts",
      content: "const one = 1;\nconst two = 2;\n",
      patch: null,
      added: 0,
      removed: 0,
    });
  });

  it("segment rows group consecutive reads and never a write", () => {
    const step = (key: string, readShaped: boolean): TurnStep => ({
      key,
      name: "fixture",
      verb: "Fixture",
      detail: null,
      state: "ok",
      output: "",
      patch: null,
      content: null,
      added: 0,
      removed: 0,
      readShaped,
      taskRole: null,
      taskChildId: null,
    });
    const rows = segmentRows([
      step("r1", true),
      step("r2", true),
      step("w1", false),
      step("r3", true),
    ]);
    expect(
      rows.map((row) => (row.kind === "group" ? row.steps.map((s) => s.key) : row.step.key)),
    ).toEqual([["r1", "r2"], "w1", "r3"]);
  });
});

describe("ticker and turn timing", () => {
  const running = (content: StreamingAssistantMessage["content"]): ChatState => ({
    ...initialState,
    status: "running",
    streamingMessage: assistantMessage(content),
  });

  it("plans before any block streams, and while thinking streams", () => {
    expect(turnViews([]).length).toBe(0);
    expect(tickerOf({ ...initialState, status: "running", streamingMessage: null })).toEqual({
      kind: "planning",
      since: null,
    });
    expect(tickerOf(running([{ type: "thinking", thinking: "hmm" }]))).toEqual({
      kind: "planning",
      since: null,
    });
  });

  it("names the streaming tool call with its detail", () => {
    const state = running([
      { type: "text", text: "Fixing the test" },
      { type: "toolCall", id: "c1", name: "bash", arguments: { command: "pnpm vitest run" } },
    ]);
    expect(tickerOf(state)).toEqual({
      kind: "step",
      verb: "Running",
      detail: "pnpm vitest run",
    });
  });

  it("rolls up a trailing run of reads at the group minimum", () => {
    const read = (id: string, path: string): PiToolCall => ({
      type: "toolCall",
      id,
      name: "read",
      arguments: { path },
    });
    // One read is a step; the second crosses the minimum and rolls up.
    expect(tickerOf(running([read("c1", "a.ts")]))).toEqual({
      kind: "step",
      verb: "Reading",
      detail: "a.ts",
    });
    expect(tickerOf(running([read("c1", "a.ts"), read("c2", "b.ts")]))).toEqual({
      kind: "rollup",
      count: 2,
    });
    // A text block breaks the run: only the segment's trailing reads count.
    expect(
      tickerOf(running([read("c1", "a.ts"), { type: "text", text: "Now" }, read("c2", "b.ts")])),
    ).toEqual({ kind: "step", verb: "Reading", detail: "b.ts" });
    // A writing tool never disappears into a roll-up (spec §4).
    expect(
      tickerOf(
        running([
          read("c1", "a.ts"),
          { type: "toolCall", id: "c2", name: "edit", arguments: { path: "b.ts", edits: [] } },
        ]),
      ),
    ).toEqual({ kind: "step", verb: "Editing", detail: "b.ts" });
  });

  it("a finished trailing tool stops shimmering and the wait starts counting", () => {
    const call: PiToolCall = {
      type: "toolCall",
      id: "c1",
      name: "bash",
      arguments: { command: "pnpm test" },
    };
    const state = running([call]);
    // Nothing has come back yet: the row is the live label.
    expect(tickerOf(state)).toEqual({ kind: "step", verb: "Running", detail: "pnpm test" });

    const settled: ChatState = {
      ...state,
      entries: [toolResultEntry("t1", "c1", "", "2026-08-05T10:00:04.000Z")],
    };
    // Its result landed, so the window reads as planning again — which is
    // what stamps the ✓ on the label that just finished — and the wait is
    // measured from when that result arrived.
    expect(tickerOf(settled)).toEqual({
      kind: "planning",
      since: Date.parse("2026-08-05T10:00:04.000Z"),
    });
  });

  it("reports writing while prose streams, idle when not running", () => {
    expect(tickerOf(running([{ type: "text", text: "All done because" }]))).toEqual({
      kind: "writing",
    });
    expect(tickerOf(initialState)).toEqual({ kind: "idle" });
  });

  it("measures duration from the turn's entry timestamps", () => {
    const turns = turnViews([
      messageEntry("u1", userMessage([{ type: "text", text: "go" }]), "2026-08-05T10:00:00.000Z"),
      assistantBlocksEntry("a1", [{ type: "text", text: "Done." }], "2026-08-05T10:00:04.000Z"),
    ]);
    expect(turns[0]?.durationMs).toBe(4000);
    expect(turns[0]?.startedAt).toBe("2026-08-05T10:00:00.000Z");
    expect(turns[0]?.outcome).toBe("done");
  });

  it("labels an aborted turn stopped and an errored turn failed", () => {
    const withStop = (
      stopReason: Extract<StreamingAssistantMessage["stopReason"], "aborted" | "error">,
    ): Session.SessionTreeEntry =>
      assistantBlocksEntry(
        "a1",
        [{ type: "text", text: "…" }],
        "2026-08-05T10:00:01.000Z",
        stopReason,
      );
    const user = userEntry("u1", "go");
    expect(turnViews([user, withStop("aborted")])[0]?.outcome).toBe("stopped");
    expect(turnViews([user, withStop("error")])[0]?.outcome).toBe("failed");
  });
});

describe("effective layer", () => {
  it("maps each density to its phase defaults", () => {
    expect(effectiveLayer(null, "compact-all-grouped", "running")).toBe(1);
    expect(effectiveLayer(null, "compact-all-grouped", "settled")).toBe(0);
    expect(effectiveLayer(null, "compact-ungrouped", "running")).toBe(1);
    expect(effectiveLayer(null, "compact-ungrouped", "settled")).toBe(1);
    expect(effectiveLayer(null, "detailed", "running")).toBe(2);
    expect(effectiveLayer(null, "detailed", "settled")).toBe(2);
  });

  it("a per-turn override beats the setting in every phase", () => {
    expect(effectiveLayer(2, "compact-all-grouped", "settled")).toBe(2);
    expect(effectiveLayer(0, "detailed", "running")).toBe(0);
  });
});
