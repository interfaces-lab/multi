// The transcript's row plane, as data. A virtual list can only mount and
// measure rows, so a turn is two of them: the user's message, which pins to
// the top of the scrollport while its work scrolls underneath, and the work
// itself. Everything else in the conversation is one row of its own.

import type { TimelineNavigatorItem } from "@honk/ui/timeline-navigator";

import type { ConversationItem } from "./chat-model";

type TurnItem = Extract<ConversationItem, { readonly kind: "turn" }>;
type AsideItem = Exclude<ConversationItem, TurnItem>;

export type TranscriptRow =
  | { readonly kind: "user"; readonly key: string; readonly item: TurnItem }
  | { readonly kind: "work"; readonly key: string; readonly item: TurnItem }
  | { readonly kind: "aside"; readonly key: string; readonly item: AsideItem };

// First-paint geometry only: every mounted row measures itself immediately, so
// these decide how tall unmeasured history reads while it is still off-screen.
const ROW_ESTIMATE_PX: Record<TranscriptRow["kind"], number> = {
  user: 72,
  work: 200,
  aside: 40,
};

/** The transcript's own top and bottom gutter (matches --honk-space-panel-pad). */
export const TRANSCRIPT_EDGE_PAD_PX = 12;
/** Between a turn's two rows (matches --honk-space-gutter). */
const TURN_INNER_GAP_PX = 8;

export const transcriptRows = (items: readonly ConversationItem[]): readonly TranscriptRow[] =>
  items.flatMap((item): readonly TranscriptRow[] =>
    item.kind === "turn"
      ? [
          { kind: "user", key: `user:${item.turn.id}`, item },
          { kind: "work", key: `work:${item.turn.id}`, item },
        ]
      : [{ kind: "aside", key: item.id, item }],
  );

export const transcriptRowEstimatePx = (row: TranscriptRow): number => ROW_ESTIMATE_PX[row.kind];

/**
 * A row's gap is padding inside the measured element, so it must be fixed the
 * moment the row exists — a gap that read the *next* row would flip whenever a
 * sibling streamed in and re-measure settled rows. Every row's successor is
 * known from its own kind: a user row is always followed by its work row, and
 * every other row is always followed by a new turn or an aside.
 */
export const transcriptRowTrailingGapPx = (row: TranscriptRow): number =>
  row.kind === "user" ? TURN_INNER_GAP_PX : TRANSCRIPT_EDGE_PAD_PX;

export const transcriptRowLeadingGapPx = (_row: TranscriptRow, index: number): number =>
  index === 0 ? TRANSCRIPT_EDGE_PAD_PX : 0;

/**
 * The rail's stops: one per turn, previewed by what the user asked and the
 * first thing the agent said back.
 */
export const timelineItems = (
  items: readonly ConversationItem[],
): readonly TimelineNavigatorItem[] =>
  items.flatMap((item) =>
    item.kind === "turn"
      ? [
          {
            id: item.turn.id,
            userText: item.turn.userText,
            assistantText: item.turn.segments[0]?.headline ?? item.turn.summary,
          },
        ]
      : [],
  );
