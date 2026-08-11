import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";

// Synthetic terminal row carrying the transcript's end gutter. It has no DOM
// element; its size lives only in the virtualizer's measurement cache, so the
// gutter is inside `getTotalSize()` and distance-from-end still reads true.
export const TRANSCRIPT_SPACER_KEY = "transcript-end-spacer";

export function shouldAdjustTranscriptScrollPosition(
  item: VirtualItem,
  delta: number,
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
  stickyIndexes: readonly number[],
): boolean {
  if (delta === 0 || item.key === TRANSCRIPT_SPACER_KEY) return false;
  // Growth above the viewport keeps it visually stable; growth below it
  // never moves it. Pinned reading stays still, and following is handled
  // separately by the transcript.
  const scrollOffset = instance.scrollOffset ?? 0;
  if (item.start >= scrollOffset) return false;
  // The currently pinned sticky owner is visually at the top even though
  // its start is above the scroll offset. Compensating its resize would
  // keep the following rows visually still while the header grows,
  // overlapping them or leaving a gap when it shrinks.
  const stickyOwner = stickyIndexes.findLast(
    (index) =>
      (instance.measurementsCache[index]?.start ?? Number.POSITIVE_INFINITY) <= scrollOffset,
  );
  if (item.index === stickyOwner) return false;
  // First measurement (estimate -> actual) must always be compensated, even
  // while scrolling up, or unmeasured history jumps as it mounts. Only skip
  // re-measurements during backward scroll, matching the core default and
  // avoiding the "items jump while scrolling up" cascade.
  return !instance.itemSizeCache.has(item.key) || instance.scrollDirection !== "backward";
}
