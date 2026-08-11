import type { Session } from "@honk/core/session";

type MessageEntry = Extract<Session.SessionTreeEntry, { readonly type: "message" }>;
type EntryMessage = MessageEntry["message"];

export type SessionUserMessage = Extract<EntryMessage, { readonly role: "user" }>;
export type SessionAssistantMessage = Extract<EntryMessage, { readonly role: "assistant" }>;

type QueueUpdateEvent = Extract<Session.AgentHarnessEvent, { readonly type: "queue_update" }>;

export type SessionHealth =
  | { readonly type: "connecting" }
  | { readonly type: "live"; readonly phase: Session.Phase }
  | { readonly type: "disconnected" }
  | { readonly type: "failed"; readonly message: string };

export interface ComposerMessage {
  readonly text: string;
  readonly images: readonly Session.PromptImage[];
}

export interface QueueSnapshot {
  readonly steer: readonly ComposerMessage[];
  readonly followUp: readonly ComposerMessage[];
  readonly nextTurn: readonly ComposerMessage[];
}

const NO_MESSAGES: readonly ComposerMessage[] = Object.freeze([]);

export const EMPTY_COMPOSER_MESSAGE: ComposerMessage = Object.freeze({
  text: "",
  images: Object.freeze([]),
});

export const EMPTY_QUEUE: QueueSnapshot = Object.freeze({
  steer: NO_MESSAGES,
  followUp: NO_MESSAGES,
  nextTurn: NO_MESSAGES,
});

export interface SessionState {
  readonly sessionId: Session.SessionId | null;
  readonly health: SessionHealth;
  readonly entries: readonly Session.SessionTreeEntry[];
  readonly turns: Session.ChangesOutput["turns"];
  readonly liveAssistant: SessionAssistantMessage | null;
  readonly queue: QueueSnapshot;
}

export type SessionModelEvent =
  | { readonly type: "attached"; readonly sessionId: Session.SessionId }
  | {
      readonly type: "state";
      readonly entries: readonly Session.SessionTreeEntry[];
      readonly phase: Session.Phase;
      readonly turns: Session.ChangesOutput["turns"];
    }
  | { readonly type: "event"; readonly event: Session.AgentHarnessEvent }
  | { readonly type: "stream_ended" }
  | { readonly type: "failed"; readonly message: string };

export const initialSessionState: SessionState = {
  sessionId: null,
  health: { type: "connecting" },
  entries: [],
  turns: [],
  liveAssistant: null,
  queue: EMPTY_QUEUE,
};

export function composerMessageOf(message: SessionUserMessage): ComposerMessage {
  return message.content instanceof Array
    ? {
        text: message.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n"),
        images: message.content.flatMap((part) =>
          part.type === "image" ? [{ data: part.data, mimeType: part.mimeType }] : [],
        ),
      }
    : { text: message.content, images: [] };
}

function queueMessagesOf(messages: QueueUpdateEvent["steer"]): readonly ComposerMessage[] {
  return messages.flatMap((message) => {
    if (!("role" in message) || message.role !== "user") return [];
    const projected = composerMessageOf(message);
    return projected.text.length === 0 && projected.images.length === 0 ? [] : [projected];
  });
}

/** Pi sends every queue bucket in each update, so this projection never merges snapshots. */
export function queueSnapshotOf(event: QueueUpdateEvent): QueueSnapshot {
  return {
    steer: queueMessagesOf(event.steer),
    followUp: queueMessagesOf(event.followUp),
    nextTurn: queueMessagesOf(event.nextTurn),
  };
}

/** Restores the user's queued work after abort clears Pi's steer and follow-up buckets. */
export function clearedMessageOf(cleared: Session.AbortOutput): ComposerMessage {
  const messages = [...cleared.clearedSteer, ...cleared.clearedFollowUp].flatMap((message) => {
    if (!("role" in message) || message.role !== "user") return [];
    const projected = composerMessageOf(message);
    return projected.text.length === 0 && projected.images.length === 0 ? [] : [projected];
  });

  return {
    text: messages
      .map((message) => message.text)
      .filter((text) => text.length > 0)
      .join("\n\n"),
    images: messages.flatMap((message) => message.images),
  };
}

/** Puts recovered abort content before anything the user typed while abort was in flight. */
export function mergeRecoveredDraft({
  recovered,
  newer,
}: {
  readonly recovered: ComposerMessage;
  readonly newer: ComposerMessage;
}): ComposerMessage {
  const text =
    recovered.text.length === 0
      ? newer.text
      : newer.text.length === 0
        ? recovered.text
        : `${recovered.text}\n\n${newer.text}`;

  return { text, images: [...recovered.images, ...newer.images] };
}

export function sessionActionsEnabled(state: SessionState): boolean {
  return state.health.type === "live";
}

export function reduceSession(state: SessionState, event: SessionModelEvent): SessionState {
  switch (event.type) {
    case "attached":
      return {
        sessionId: event.sessionId,
        health: { type: "connecting" },
        entries: state.sessionId === event.sessionId ? state.entries : [],
        turns: state.sessionId === event.sessionId ? state.turns : [],
        liveAssistant: null,
        queue: EMPTY_QUEUE,
      };

    case "state":
      return {
        ...state,
        health: { type: "live", phase: event.phase },
        entries: event.entries,
        turns: event.turns,
        liveAssistant: null,
      };

    case "event": {
      if (state.health.type === "disconnected" || state.health.type === "failed") return state;

      const piEvent = event.event;
      switch (piEvent.type) {
        case "message_update":
          return piEvent.message.role === "assistant"
            ? { ...state, liveAssistant: piEvent.message }
            : state;

        case "message_end":
          return piEvent.message.role === "assistant" ? { ...state, liveAssistant: null } : state;

        case "queue_update":
          return { ...state, queue: queueSnapshotOf(piEvent) };

        case "settled":
          return {
            ...state,
            health: state.health.type === "live" ? { type: "live", phase: "idle" } : state.health,
            liveAssistant: null,
            queue: EMPTY_QUEUE,
          };

        default:
          return state;
      }
    }

    case "stream_ended":
      return {
        ...state,
        health: { type: "disconnected" },
        liveAssistant: null,
        queue: EMPTY_QUEUE,
      };

    case "failed":
      return {
        ...state,
        health: { type: "failed", message: event.message },
        liveAssistant: null,
        queue: EMPTY_QUEUE,
      };
  }
}

export type AssistantOutcome =
  | { readonly type: "complete" }
  | { readonly type: "stopped" }
  | { readonly type: "failed"; readonly message: string };

type ActivePhase = Exclude<Session.Phase, "idle">;

export type TranscriptRow =
  | {
      readonly kind: "user";
      readonly id: string;
      readonly text: string;
      readonly imageCount: number;
    }
  | {
      readonly kind: "assistant";
      readonly source: "committed";
      readonly id: string;
      readonly text: string;
      readonly outcome: AssistantOutcome;
    }
  | {
      readonly kind: "assistant";
      readonly source: "live";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly kind: "working";
      readonly id: "session-working";
      readonly phase: ActivePhase;
    };

const assistantTextBlocksOf = (message: SessionAssistantMessage): readonly string[] =>
  message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));

const assistantOutcomeOf = (message: SessionAssistantMessage): AssistantOutcome => {
  if (message.stopReason === "aborted") return { type: "stopped" };
  if (message.stopReason === "error") {
    return { type: "failed", message: message.errorMessage ?? "The model request failed." };
  }
  return { type: "complete" };
};

const assistantRowIsVisible = (text: string, outcome: AssistantOutcome): boolean =>
  text.trim().length > 0 || outcome.type !== "complete";

/** Projects the committed transcript plus Pi's advisory live assistant into renderable rows. */
export function transcriptRows(state: SessionState): readonly TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const committedAssistantTexts = new Set<string>();

  for (const entry of state.entries) {
    if (entry.type !== "message") continue;

    if (entry.message.role === "user") {
      committedAssistantTexts.clear();
      const message = composerMessageOf(entry.message);
      if (message.text.length > 0 || message.images.length > 0) {
        rows.push({
          kind: "user",
          id: entry.id,
          text: message.text,
          imageCount: message.images.length,
        });
      }
      continue;
    }

    if (entry.message.role !== "assistant") continue;
    const blocks = assistantTextBlocksOf(entry.message);
    for (const block of blocks) committedAssistantTexts.add(block);
    const text = blocks.join("\n\n");
    const outcome = assistantOutcomeOf(entry.message);
    if (assistantRowIsVisible(text, outcome)) {
      rows.push({
        kind: "assistant",
        source: "committed",
        id: entry.id,
        text,
        outcome,
      });
    }
  }

  const liveText =
    state.liveAssistant === null
      ? ""
      : assistantTextBlocksOf(state.liveAssistant)
          .filter((text) => !committedAssistantTexts.has(text))
          .join("\n\n");

  if (state.liveAssistant !== null && liveText.trim().length > 0) {
    rows.push({
      kind: "assistant",
      source: "live",
      id: `live-assistant:${String(state.liveAssistant.timestamp)}`,
      text: liveText,
    });
  } else if (state.health.type === "live" && state.health.phase !== "idle") {
    rows.push({ kind: "working", id: "session-working", phase: state.health.phase });
  }

  return rows;
}
