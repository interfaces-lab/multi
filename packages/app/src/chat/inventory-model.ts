// The chat inventory, pure: core's `session.watchInventory` frames folded
// into state, and that state projected into start-page rows. Each frame is
// the full authoritative list (spec/core.md section 9), so the fold replaces
// wholesale — there is nothing to merge and no shadow inventory to drift.

import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  isValid,
  parseISO,
} from "date-fns";

import type { Session } from "@honk/core/session";

export type InventoryStatus = "connecting" | "ready" | "disconnected" | "failed";

export interface InventoryState {
  readonly status: InventoryStatus;
  readonly sessions: readonly Session.SessionSummary[];
  readonly error: string | null;
}

export type InventoryEvent =
  | { readonly type: "frame"; readonly sessions: readonly Session.SessionSummary[] }
  | { readonly type: "stream_ended" }
  | { readonly type: "failed"; readonly message: string };

export const initialInventory: InventoryState = {
  status: "connecting",
  sessions: [],
  error: null,
};

export const reduceInventory = (state: InventoryState, event: InventoryEvent): InventoryState => {
  switch (event.type) {
    case "frame":
      return { status: "ready", sessions: event.sessions, error: null };
    case "stream_ended":
      // The list stays rendered from the last authoritative frame; only the
      // liveness changed.
      return { ...state, status: "disconnected" };
    case "failed":
      return { ...state, status: "failed", error: event.message };
  }
};

/** One start-page row: identity, place, liveness, recency. */
export interface InventoryRow {
  readonly id: Session.SessionId;
  readonly title: Session.SessionTitle | undefined;
  readonly directory: string;
  /** Any phase but idle: the harness is doing something right now. */
  readonly working: boolean;
  readonly updatedAt: string;
}

// An unparseable timestamp sorts last instead of poisoning the order.
const timeOf = (timestamp: string): number => {
  const time = parseISO(timestamp);
  return isValid(time) ? time.getTime() : 0;
};

/** Newest activity first. Working sessions rise naturally: they were touched last. */
export const inventoryRows = (
  sessions: readonly Session.SessionSummary[],
): readonly InventoryRow[] =>
  [...sessions]
    // Delegation-owned sessions live inside their parent thread, not in a
    // top-level Home or new-thread list.
    .filter((session) => session.delegation === undefined)
    .sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt))
    .map((session) => ({
      id: session.id,
      title: session.title,
      directory: session.directory,
      working: session.phase !== "idle",
      updatedAt: session.updatedAt,
    }));

/** Same compact vocabulary as the home thread rows: now, 5m, 3h, 2d. */
export const agoLabel = (nowMs: number, timestamp: string): string => {
  const time = parseISO(timestamp);
  if (!isValid(time)) return "now";
  const now = new Date(Math.max(nowMs, time.getTime()));
  const days = differenceInDays(now, time);
  if (days >= 1) return `${String(days)}d`;
  const hours = differenceInHours(now, time);
  if (hours >= 1) return `${String(hours)}h`;
  const minutes = differenceInMinutes(now, time);
  return minutes >= 1 ? `${String(minutes)}m` : "now";
};
