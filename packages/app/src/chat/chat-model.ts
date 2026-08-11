// Pure state fold for the chat surface. Every timing rule lives here so the
// strict tests need no DOM and no network: the controller only feeds events in
// and renders state out.
//
// The thread projection is native: Pi entries in, view rows out. No retired backend
// shapes, no fabricated authors — a Pi value the transcript cannot express
// honestly becomes a notice row, not an invented message. Git receipts come
// from `session.changes` and attach to the turn that earned them.

import type { Git } from "@honk/core";
import { Tools } from "@honk/core";
import { Session } from "@honk/core/session";
import type { ConversationDensity } from "@honk/shared/conversation-density";
import { Option, Schema } from "effect";

import type { ModelChoice } from "./chat-controller";
import type { ComposerMessage } from "./composer-store";
import {
  editPatchOf,
  measurePatch,
  taskChildIdOf,
  taskRoleOf,
  toolBody,
  toolDetail,
  toolVerb,
  writeContentOf,
  type StepState,
} from "./tool-presentation";
import { decodeThinkingLevel, type ModelSelection } from "./selection";

export type ChatStatus = "connecting" | "ready" | "running" | "disconnected" | "failed";
type MessageUpdateEvent = Extract<Session.AgentHarnessEvent, { readonly type: "message_update" }>;
export type StreamingAssistantMessage = Extract<
  MessageUpdateEvent["message"],
  { readonly role: "assistant" }
>;

/**
 * The harness's queue, replayed as Pi truth: every `queue_update` frame
 * carries the whole queue, so a frame replaces this value wholesale and
 * settlement empties it. No client-side ids — a row is its bucket and index.
 */
export interface QueueSnapshot {
  readonly steer: readonly ComposerMessage[];
  readonly followUp: readonly ComposerMessage[];
  readonly nextTurn: readonly ComposerMessage[];
}

export const EMPTY_QUEUE: QueueSnapshot = Object.freeze({
  steer: [],
  followUp: [],
  nextTurn: [],
});

export interface ChatState {
  readonly status: ChatStatus;
  readonly sessionId: Session.SessionId | null;
  readonly entries: readonly Session.SessionTreeEntry[];
  // What Pi holds for later delivery right now; the tray renders this.
  readonly queue: QueueSnapshot;
  // Per-turn git change receipts, from the watch's authoritative state.
  readonly turns: Session.ChangesOutput["turns"];
  // Pi's live assistant message while a run streams. Authoritative entries
  // arrive in state frames.
  readonly streamingMessage: StreamingAssistantMessage | null;
  // Pi's thinking level: the last `thinking_level_change` record wins.
  // Null means no valid record yet — Pi's own default (`off`) applies.
  readonly thinkingLevel: Session.ThinkingLevel | null;
  // The model, the same way: the last `model_change` record wins. Null means no usable
  // record yet — core's default policy decides what the session runs on.
  readonly model: ModelChoice | null;
  // The fusion stop, from the last `honk.fusion` marker. Null reads the same
  // for "never fusion" and "exited" — either way the seats are single-model.
  readonly fusionStop: Session.FusionStop | null;
  readonly error: string | null;
}

export type ChatEvent =
  | { readonly type: "attached"; readonly sessionId: Session.SessionId }
  // An advisory Pi event from the session watch: streaming and liveness.
  | { readonly type: "event"; readonly event: Session.AgentHarnessEvent }
  // An authoritative state frame from the session watch.
  | {
      readonly type: "state";
      readonly entries: readonly Session.SessionTreeEntry[];
      readonly phase: Session.Phase;
      readonly turns: Session.ChangesOutput["turns"];
    }
  | { readonly type: "stream_ended" }
  | { readonly type: "failed"; readonly message: string };

export const initialState: ChatState = {
  status: "connecting",
  sessionId: null,
  entries: [],
  queue: EMPTY_QUEUE,
  turns: [],
  streamingMessage: null,
  thinkingLevel: null,
  model: null,
  fusionStop: null,
  error: null,
};

/** The stop ladder, in effort order — the picker renders these. */
export const FUSION_STOPS: readonly Session.FusionStop[] = Session.FusionStop.literals;

const FusionMarker = Schema.Struct({ stop: Schema.NullOr(Session.FusionStop) });
const decodeFusionMarker = Schema.decodeUnknownOption(FusionMarker);

// The marker's stop is validated like every stored string: an unknown value
// reads as exited rather than a guess.
const fusionStopOf = (entries: readonly Session.SessionTreeEntry[]): Session.FusionStop | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "custom" && entry.customType === "honk.fusion") {
      return Option.getOrNull(Option.map(decodeFusionMarker(entry.data), (marker) => marker.stop));
    }
  }
  return null;
};

/** Pi's thinking vocabulary in effort order — the composer renders these. */
export const THINKING_LEVELS: readonly Session.ThinkingLevel[] = Session.ThinkingLevel.literals;

// Pi stores the entry value as a plain string, so the record is validated
// against the known vocabulary. A level this build does not know — a newer
// Pi's, say — yields null rather than a guess, and the default reads through.
const thinkingLevelOf = (
  entries: readonly Session.SessionTreeEntry[],
): Session.ThinkingLevel | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "thinking_level_change") return decodeThinkingLevel(entry.thinkingLevel);
  }
  return null;
};

// The model reads the same way: the last `model_change` record wins, and
// a record that names no model reads as none rather than a guess — the
// resolved default is then what the session runs on.
const decodeModelChange = Schema.decodeUnknownOption(
  Schema.Struct({ provider: Schema.NonEmptyString, modelId: Schema.NonEmptyString }),
);

const modelOf = (entries: readonly Session.SessionTreeEntry[]): ModelChoice | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "model_change") {
      return Option.getOrNull(
        Option.map(decodeModelChange(entry), (change) => ({
          providerId: change.provider,
          modelId: change.modelId,
        })),
      );
    }
  }
  return null;
};

/** The model intent inherited by a branch ending at these entries. */
export const modelSelectionOfEntries = (
  entries: readonly Session.SessionTreeEntry[],
): ModelSelection => {
  const fusionStop = fusionStopOf(entries);
  return fusionStop === null
    ? {
        kind: "model",
        model: modelOf(entries),
        thinkingLevel: thinkingLevelOf(entries),
      }
    : { kind: "fusion", stop: fusionStop };
};

type PiEntryMessage = Extract<Session.SessionTreeEntry, { readonly type: "message" }>["message"];
type PiUserMessage = Extract<PiEntryMessage, { readonly role: "user" }>;

const composerMessageOf = (message: PiUserMessage): ComposerMessage =>
  message.content instanceof Array
    ? {
        text: message.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n"),
        images: message.content.flatMap((part) =>
          part.type === "image" ? [{ data: part.data, mimeType: part.mimeType }] : [],
        ),
      }
    : { text: message.content, images: [] };

/**
 * The user's words from an abort's cleared queues (spec/conversation.md
 * section 7: stopping must never destroy something the user typed). The
 * composer puts this back in the editor.
 */
export const clearedMessageOf = (cleared: Session.AbortOutput): ComposerMessage => {
  const messages = [...cleared.clearedSteer, ...cleared.clearedFollowUp]
    .filter((message) => "role" in message && message.role === "user")
    .map(composerMessageOf);
  return {
    text: messages
      .map((message) => message.text)
      .filter((text) => text.length > 0)
      .join("\n\n"),
    images: messages.flatMap((message) => message.images),
  };
};

type QueueUpdate = Extract<Session.AgentHarnessEvent, { readonly type: "queue_update" }>;

// One queue projection for the same message shape the composer owns. A queued
// image is still visible before delivery; non-user harness traffic is not a
// message the user queued.
const queueMessagesOf = (messages: QueueUpdate["steer"]): readonly ComposerMessage[] =>
  messages.flatMap((message) => {
    if (!("role" in message) || message.role !== "user") return [];
    const queued = composerMessageOf(message);
    return queued.text.length === 0 && queued.images.length === 0 ? [] : [queued];
  });

export const reduce = (state: ChatState, event: ChatEvent): ChatState => {
  switch (event.type) {
    case "attached":
      return { ...state, sessionId: event.sessionId };
    case "event": {
      const piEvent = event.event;
      switch (piEvent.type) {
        case "agent_start":
          return { ...state, status: "running", streamingMessage: null };
        case "message_update":
          if (piEvent.message.role !== "assistant") return state;
          return { ...state, streamingMessage: piEvent.message };
        case "message_end":
          // Keep the exact final assistant value through the repair read that
          // follows this event. The committed entry and this live value fold
          // together without duplication; clearing here would remove the
          // work for one frame before that authoritative entry arrives.
          return piEvent.message.role === "assistant"
            ? { ...state, streamingMessage: piEvent.message }
            : state;
        // Settlement is what drains the queue: the frames described a run
        // that no longer exists, so the tray empties with it.
        case "settled":
          return { ...state, status: "ready", streamingMessage: null, queue: EMPTY_QUEUE };
        // Pi announces the whole queue on every change; each frame replaces
        // the last, and nothing here ever merges or invents an id.
        case "queue_update":
          return {
            ...state,
            queue: {
              steer: queueMessagesOf(piEvent.steer),
              followUp: queueMessagesOf(piEvent.followUp),
              nextTurn: queueMessagesOf(piEvent.nextTurn),
            },
          };
        // The live move: Pi buffers the transcript record until settle, so
        // this event is what a mid-run change looks like before it commits.
        case "thinking_level_update":
          return { ...state, thinkingLevel: piEvent.level };
        // Pi names a model by provider and id; the app carries the same pair.
        case "model_update": {
          return {
            ...state,
            model: { providerId: piEvent.model.provider, modelId: piEvent.model.id },
          };
        }
        default:
          return state;
      }
    }
    case "state":
      return {
        ...state,
        entries: event.entries,
        turns: event.turns,
        thinkingLevel: thinkingLevelOf(event.entries),
        model: modelOf(event.entries),
        fusionStop: fusionStopOf(event.entries),
        // The authoritative read wins over local guesses about the run. Any
        // phase but idle means the harness is working (Pi's vocabulary).
        status: event.phase === "idle" ? "ready" : "running",
      };
    case "stream_ended":
      return { ...state, status: "disconnected" };
    case "failed":
      return { ...state, status: "failed", error: event.message };
  }
};

// ---------------------------------------------------------------------------
// Thread projection
// ---------------------------------------------------------------------------

type PiToolResult = Extract<PiEntryMessage, { readonly role: "toolResult" }>;

const toolResultText = (result: PiToolResult): string =>
  result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();

const noticeOf = (entry: Session.SessionTreeEntry): string | null => {
  switch (entry.type) {
    case "model_change":
      return `Model: ${entry.provider}/${entry.modelId}`;
    case "thinking_level_change":
      return `Thinking level: ${entry.thinkingLevel}`;
    case "custom":
      if (entry.customType === "honk.workspace_change") {
        const directory = Option.getOrUndefined(
          Schema.decodeUnknownOption(
            Schema.Struct({ directory: Schema.optionalKey(Schema.String) }),
          )(entry.data),
        )?.directory;
        return directory === undefined ? "Moved to another workspace" : `Moved to ${directory}`;
      }
      if (entry.customType === "honk.revert") return "Workspace reverted to an earlier turn";
      return null;
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// Turn grammar (spec/conversation.md §1): turns → segments → steps.
//
// A segment is a run of tool work opened by the assistant text block that
// preceded it; the turn's final text block is its summary. Nothing here is
// stored — the grammar is a pure read of Pi's block order.
// ---------------------------------------------------------------------------

/**
 * A step may group and roll up only when it just looks (spec §4). The split
 * is core's `Tools.writesOf` — the same classifier the checkpoint attribution
 * gate uses — so there is exactly one list. Unknown tools classify opaque and
 * therefore never group: erring toward visible.
 */
const readShaped = (name: string, args: unknown): boolean =>
  Tools.writesOf(name, args).kind === "none";

export interface TurnStep {
  /** Pi's tool call id: stable across streaming and commit. */
  readonly key: string;
  readonly name: string;
  /** The tensed verb this call reads as right now (`tool-presentation`). */
  readonly verb: string;
  /** The one human argument — a path, a command, a query, a mission. */
  readonly detail: string | null;
  readonly state: StepState;
  /** The clipped result text; empty when the row's card owns the content. */
  readonly output: string;
  /** Pi's unified patch, from an edit result's `details`. */
  readonly patch: string | null;
  /** A write's new file text, straight from its own arguments. */
  readonly content: string | null;
  readonly added: number;
  readonly removed: number;
  readonly readShaped: boolean;
  /** A task call's `subagent_type`; null for every other tool. */
  readonly taskRole: string | null;
  /** The child session a settled task ran in, from the result's `details`. */
  readonly taskChildId: string | null;
}

export interface TurnSegment {
  readonly id: string;
  /** The assistant text block that opened this segment, or null. */
  readonly headline: string | null;
  readonly steps: readonly TurnStep[];
}

export interface TurnView {
  /** The user entry id: the turn's identity for overrides and receipts. */
  readonly id: string;
  readonly userText: string;
  readonly userImages: readonly Session.PromptImage[];
  readonly segments: readonly TurnSegment[];
  /** The turn's final text block; survives collapse to L0. */
  readonly summary: string | null;
  /** The user entry's timestamp: the live turn ticks its clock from here. */
  readonly startedAt: string;
  /** First to last committed entry, or null while nothing has committed. */
  readonly durationMs: number | null;
  /** How the turn ended. A stopped or failed turn still collapses; only the label tells. */
  readonly outcome: "done" | "stopped" | "failed";
  /** What this turn edited — the change receipt shown when the turn settles. */
  readonly files: readonly Git.FileChange[];
  /** The failing model request's message, when outcome is failed. */
  readonly error: string | null;
}

type PiToolCall = Extract<
  StreamingAssistantMessage["content"][number],
  { readonly type: "toolCall" }
>;

/**
 * One tool call as a row: the presentation table names it, Pi's result says
 * how it ended, and an edit's `details` patch is what the diff card renders.
 * A write carries its own new text; nothing here counts a write's lines,
 * because the call never saw the file it replaced.
 */
const turnStep = (block: PiToolCall, result: PiToolResult | undefined): TurnStep => {
  const state: StepState = result === undefined ? "running" : result.isError ? "error" : "ok";
  const patch = result === undefined ? null : editPatchOf(result.details);
  const stats = patch === null ? { added: 0, removed: 0 } : measurePatch(patch);
  return {
    key: block.id,
    name: block.name,
    verb: toolVerb(block.name, block.arguments, state),
    detail: toolDetail(block.name, block.arguments),
    state,
    output: result === undefined ? "" : toolBody(block.name, state, toolResultText(result)),
    patch,
    content: block.name === "write" ? writeContentOf(block.arguments) : null,
    added: stats.added,
    removed: stats.removed,
    readShaped: readShaped(block.name, block.arguments),
    taskRole: block.name === "task" ? taskRoleOf(block.arguments) : null,
    taskChildId:
      block.name === "task" && result !== undefined ? taskChildIdOf(result.details) : null,
  };
};

/**
 * Folds committed entries — and, when a run streams, the live assistant
 * message — into the turn grammar. The streaming message is not an entry yet,
 * so its blocks fold into the open turn through the same per-block rules: its
 * trailing text is the turn's summary-so-far, streamed outside the preview
 * window until the next block decides what it was (spec §5).
 */
export const turnViews = (
  entries: readonly Session.SessionTreeEntry[],
  streamingMessage: StreamingAssistantMessage | null = null,
  changes: Session.ChangesOutput["turns"] = [],
): readonly TurnView[] => {
  const toolResults = new Map<string, PiToolResult>();
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "toolResult") {
      toolResults.set(entry.message.toolCallId, entry.message);
    }
  }
  // The receipt keys on the turn's settling entry — whatever kind it is.
  const receiptByEntry = new Map(
    changes.filter((turn) => turn.files.length > 0).map((turn) => [turn.entryId, turn.files]),
  );

  const turns: TurnView[] = [];
  let turn: {
    id: string;
    userText: string;
    userImages: readonly Session.PromptImage[];
    segments: TurnSegment[];
    startedAt: string;
    lastAt: string;
    outcome: TurnView["outcome"];
    files: readonly Git.FileChange[];
    error: string | null;
  } | null = null;
  let segment: { ordinal: number; headline: string | null; steps: TurnStep[] } | null = null;
  // Assistant text is pending until the next block decides what it was: a
  // tool call makes it a headline, the end of the turn makes it the summary.
  let pendingText: string | null = null;
  // What this turn has already folded. Pi's state frame can land the committed
  // assistant entry before `message_end` retires the live message, and folding
  // both would render the same work twice. A tool call id is Pi's identity for
  // a block; a text block is its own words.
  const foldedCalls = new Set<string>();
  const foldedTexts = new Set<string>();

  const closeSegment = () => {
    if (segment !== null && turn !== null) {
      // The segment's identity is its first call, so disclosure survives the
      // live-to-commit seam; the ordinal only covers a segment with no call.
      turn.segments.push({
        id: segment.steps[0]?.key ?? `segment:${String(segment.ordinal)}`,
        headline: segment.headline,
        steps: segment.steps,
      });
    }
    segment = null;
  };
  const closeTurn = () => {
    closeSegment();
    if (turn !== null) {
      const started = Date.parse(turn.startedAt);
      const ended = Date.parse(turn.lastAt);
      turns.push({
        id: turn.id,
        userText: turn.userText,
        userImages: turn.userImages,
        segments: turn.segments,
        summary: pendingText,
        startedAt: turn.startedAt,
        durationMs:
          Number.isFinite(started) && Number.isFinite(ended) && ended > started
            ? ended - started
            : null,
        outcome: turn.outcome,
        files: turn.files,
        error: turn.error,
      });
    }
    turn = null;
    pendingText = null;
    // The seam is a within-turn concern; an answer repeated in a later turn
    // is a different answer.
    foldedCalls.clear();
    foldedTexts.clear();
  };

  // One block walk shared by committed messages and the streaming one.
  // `skipFolded` is the commit seam: the live message replays blocks the
  // committed entry already contributed, and those are dropped rather than
  // rendered a second time.
  const foldAssistantBlocks = (
    blocks: StreamingAssistantMessage["content"],
    skipFolded: boolean,
  ) => {
    if (turn === null) return;
    for (const block of blocks) {
      if (block.type === "text") {
        if (skipFolded && foldedTexts.has(block.text)) continue;
        foldedTexts.add(block.text);
        closeSegment();
        pendingText = pendingText === null ? block.text : `${pendingText}\n\n${block.text}`;
      } else if (block.type === "toolCall") {
        if (skipFolded && foldedCalls.has(block.id)) continue;
        foldedCalls.add(block.id);
        if (pendingText !== null || segment === null) {
          closeSegment();
          segment = { ordinal: turn.segments.length, headline: pendingText, steps: [] };
          pendingText = null;
        }
        segment.steps.push(turnStep(block, toolResults.get(block.id)));
      }
      // thinking blocks are L3 detail; the grammar skips them.
    }
  };

  for (const entry of entries) {
    if (entry.type !== "message") {
      const files = receiptByEntry.get(entry.id);
      if (files !== undefined && turn !== null) turn.files = files;
      continue;
    }
    const { message } = entry;

    if (message.role === "user") {
      closeTurn();
      const user = composerMessageOf(message);
      turn = {
        id: entry.id,
        userText: user.text,
        userImages: user.images,
        segments: [],
        startedAt: entry.timestamp,
        lastAt: entry.timestamp,
        outcome: "done",
        files: [],
        error: null,
      };
      continue;
    }
    if (turn === null) continue;
    turn.lastAt = entry.timestamp;
    const files = receiptByEntry.get(entry.id);
    if (files !== undefined) turn.files = files;
    if (message.role !== "assistant") continue;

    // The last assistant verdict wins: a retried turn that finishes cleanly
    // is done, a turn whose final message aborted or errored says so.
    if (message.stopReason === "aborted") {
      turn.outcome = "stopped";
      turn.error = null;
    } else if (message.stopReason === "error") {
      turn.outcome = "failed";
      turn.error = message.errorMessage ?? "The model request failed.";
    } else {
      turn.outcome = "done";
      turn.error = null;
    }

    foldAssistantBlocks(message.content, false);
  }

  if (streamingMessage !== null && turn !== null) {
    foldAssistantBlocks(streamingMessage.content, true);
  }

  closeTurn();
  return turns;
};

// ---------------------------------------------------------------------------
// Segment rows (spec §4): how a segment's steps read at L1.
// ---------------------------------------------------------------------------

export type SegmentRow =
  | { readonly kind: "step"; readonly step: TurnStep }
  // A run of consecutive read-shaped steps at the group minimum. Edits and
  // shell commands never disappear into a group.
  | { readonly kind: "group"; readonly steps: readonly TurnStep[] };

export const segmentRows = (steps: readonly TurnStep[]): readonly SegmentRow[] => {
  const rows: SegmentRow[] = [];
  let reads: TurnStep[] = [];
  const flush = () => {
    if (reads.length >= GROUP_MIN) rows.push({ kind: "group", steps: reads });
    else for (const step of reads) rows.push({ kind: "step", step });
    reads = [];
  };
  for (const step of steps) {
    if (step.readShaped) {
      reads.push(step);
    } else {
      flush();
      rows.push({ kind: "step", step });
    }
  }
  flush();
  return rows;
};

// ---------------------------------------------------------------------------
// Disclosure (spec §2–§3): which layer a turn renders at.
// ---------------------------------------------------------------------------

/**
 * L0 collapsed ("Worked for…" + summary) · L1 work groups + preview window ·
 * L2 full transcript. L3 (tool arguments and output) is per-row open state,
 * not a turn layer — no density auto-opens it.
 */
export type DisclosureLayer = 0 | 1 | 2;

/**
 * The whole density reconciliation: a click override wins for its turn, the
 * setting supplies the default per phase. Densities are the three app-wide
 * values from `@honk/shared/conversation-density` — Compact collapses settled
 * turns, Balanced keeps groups visible, Detailed shows every row.
 */
export const effectiveLayer = (
  override: DisclosureLayer | null,
  density: ConversationDensity,
  phase: "running" | "settled",
): DisclosureLayer => {
  if (override !== null) return override;
  switch (density) {
    case "detailed":
      return 2;
    case "compact-ungrouped":
      return 1;
    case "compact-all-grouped":
      return phase === "running" ? 1 : 0;
  }
};

// ---------------------------------------------------------------------------
// The ticker (spec §5): what the preview window shows right now.
// ---------------------------------------------------------------------------

export type TickerState =
  | { readonly kind: "idle" }
  /** `since` is when the wait began: the last result to land, or nothing. */
  | { readonly kind: "planning"; readonly since: number | null }
  | { readonly kind: "writing" }
  | { readonly kind: "step"; readonly verb: string; readonly detail: string | null }
  | { readonly kind: "rollup"; readonly count: number };

/** Minimum consecutive read-shaped calls before work rolls up (spec §4). */
export const GROUP_MIN = 2;

/** When the newest tool result landed — the epoch a wait is measured from. */
const lastResultAt = (entries: readonly Session.SessionTreeEntry[]): number | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "message" && entry.message.role === "toolResult") {
      const at = Date.parse(entry.timestamp);
      return Number.isFinite(at) ? at : null;
    }
  }
  return null;
};

/**
 * Derives the live label from the streaming message's newest block. Before
 * any block streams — and while thinking streams — the agent is planning; a
 * streaming text block means prose is being written, which the surface
 * streams outside the window as ordinary markdown while the window holds its
 * last label (spec §5); a running tool names itself.
 *
 * A trailing call whose result has already landed is no longer work in
 * flight: the window stops shimmering it and reads as planning again, which
 * is what stamps the ✓ on the label that just finished (spec §6).
 */
export const tickerOf = (state: ChatState): TickerState => {
  if (state.status !== "running") return { kind: "idle" };
  const planning: TickerState = { kind: "planning", since: lastResultAt(state.entries) };
  const content = state.streamingMessage?.content ?? [];
  const last = content.at(-1);
  if (last === undefined) return planning;
  if (last.type === "toolCall") {
    const finished = new Set<string>();
    for (const entry of state.entries) {
      if (entry.type === "message" && entry.message.role === "toolResult") {
        finished.add(entry.message.toolCallId);
      }
    }
    if (finished.has(last.id)) return planning;
    // The trailing run of read-shaped calls rolls up once it crosses the
    // group minimum (spec §6) — a text block or a writing tool breaks it.
    let reads = 0;
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const block = content[index];
      if (block?.type !== "toolCall" || !readShaped(block.name, block.arguments)) break;
      reads += 1;
    }
    if (reads >= GROUP_MIN) return { kind: "rollup", count: reads };
    return {
      kind: "step",
      verb: toolVerb(last.name, last.arguments, "running"),
      detail: toolDetail(last.name, last.arguments),
    };
  }
  if (last.type === "text") return { kind: "writing" };
  return planning;
};

/**
 * The transcript's row sequence: turns in the grammar above, with the
 * non-message entries the grammar skips — compaction dividers and context
 * notices — interleaved in document order.
 *
 * A `honk.git_action` marker pairs with the user message that follows it
 * (spec/conversation.md §8): the turn renders as one action chip. A marker
 * with no turn after it means the action never started, and that failure
 * renders itself.
 */
export type ConversationItem =
  | {
      readonly kind: "turn";
      readonly turn: TurnView;
      /** The Git action this turn ran, when a marker precedes it. */
      readonly gitAction: string | null;
    }
  | { readonly kind: "git_action_failed"; readonly id: string; readonly action: string }
  | { readonly kind: "notice"; readonly id: string; readonly text: string }
  | {
      readonly kind: "compaction";
      readonly id: string;
      readonly summary: string;
      readonly tokensBefore: number;
    };

const gitActionOf = (entry: Session.SessionTreeEntry): string | null => {
  if (entry.type !== "custom" || entry.customType !== "honk.git_action") return null;
  return Option.getOrNull(
    Option.map(
      Schema.decodeUnknownOption(Schema.Struct({ action: Schema.String }))(entry.data),
      (marker) => marker.action,
    ),
  );
};

export const conversationItems = (
  entries: readonly Session.SessionTreeEntry[],
  streamingMessage: StreamingAssistantMessage | null,
  changes: Session.ChangesOutput["turns"] = [],
): readonly ConversationItem[] => {
  const turnById = new Map(
    turnViews(entries, streamingMessage, changes).map((turn) => [turn.id, turn]),
  );

  const items: ConversationItem[] = [];
  let pendingAction: { readonly id: string; readonly action: string } | null = null;
  // Records before the first turn are the session's birth configuration, not
  // events in a conversation: create writes the model and thinking level
  // durably, and announcing initial state as a change would be noise. Only
  // changes after talk starts earn a notice row.
  let conversationStarted = false;
  const flushUnstartedAction = () => {
    if (pendingAction !== null) {
      items.push({ kind: "git_action_failed", id: pendingAction.id, action: pendingAction.action });
      pendingAction = null;
    }
  };

  for (const entry of entries) {
    if (entry.type === "message") {
      // A turn renders at its user entry; the rest of its messages fold in.
      const turn = turnById.get(entry.id);
      if (turn !== undefined) {
        items.push({ kind: "turn", turn, gitAction: pendingAction?.action ?? null });
        pendingAction = null;
        conversationStarted = true;
      }
      continue;
    }
    if (
      !conversationStarted &&
      (entry.type === "model_change" || entry.type === "thinking_level_change")
    ) {
      continue;
    }
    const action = gitActionOf(entry);
    if (action !== null) {
      flushUnstartedAction();
      pendingAction = { id: entry.id, action };
    } else if (entry.type === "compaction") {
      items.push({
        kind: "compaction",
        id: entry.id,
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
      });
    } else {
      const notice = noticeOf(entry);
      if (notice !== null) items.push({ kind: "notice", id: entry.id, text: notice });
    }
  }
  flushUnstartedAction();
  return items;
};
