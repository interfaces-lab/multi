// The transcript's virtual row plane and its scroll attribution ledger.
//
// Two jobs, one organ. The plane mounts only the rows near the viewport and
// pins each user message to the top of its own turn. The ledger decides who
// owns the scrollport: the conversation follows the bottom while it streams,
// and the moment the reader scrolls away it stops — every scroll event is
// attributed to the user or to our own write before it may change that intent.

import { zVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import {
  defaultRangeExtractor,
  elementScroll,
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import * as React from "react";
import { flushSync } from "react-dom";

import {
  shouldAdjustTranscriptScrollPosition,
  TRANSCRIPT_SPACER_KEY,
} from "./virtual-transcript-scroll";

const OVERSCAN_ROWS = 8;
const MAX_RETAINED_TRANSCRIPTS = 50;
// Ignore sub-pixel drift between the follow target and the actual offset so
// spacer rounding does not cause 1px scroll nudges every measurement.
const FOLLOW_DEADBAND_PX = 2;
// A scroll event landing within this many px of our last follow write is our
// own echo, not user intent (mirrors core's 1.5px intended-offset snap slack).
const PROGRAMMATIC_TOLERANCE_PX = 4;
// Released follow re-engages only when the user actually reaches the bottom.
// Deliberately much tighter than nearEndThresholdPx so a small scroll-up
// inside the bottom band cannot be clobbered back into following.
const REENGAGE_THRESHOLD_PX = 4;
// A scroll event within this window of a wheel/key/touch/pointer gesture is
// treated as user-driven; outside it, untagged events (browser clamps, core
// measurement adjustments) must not release or re-arm follow on their own.
const USER_INPUT_WINDOW_MS = 250;
// Keys that count as a user scroll gesture; the upward subset releases follow.
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
const RELEASE_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

type RetainedTranscript = {
  readonly offset: number;
  readonly measurements: VirtualItem[];
  readonly shouldFollow: boolean;
  readonly lastStickyKey: string | null;
};

// Per session, bounded: reopening a thread lands where it was left, and the
// oldest entry falls out rather than the map growing for the process's life.
const retainedTranscripts = new Map<string, RetainedTranscript>();

function retainTranscript(key: string, state: RetainedTranscript): void {
  retainedTranscripts.delete(key);
  retainedTranscripts.set(key, state);
  if (retainedTranscripts.size <= MAX_RETAINED_TRANSCRIPTS) return;
  const oldest = retainedTranscripts.keys().next().value;
  if (oldest !== undefined) retainedTranscripts.delete(oldest);
}

interface ElementScrollOptions {
  readonly adjustments?: number;
  readonly behavior?: "auto" | "smooth" | "instant";
}

// Latest-write-wins guard for deferred adjustment scrolls: a queued adjusted
// write must not overwrite a newer scroll command (adjusted or not) that was
// issued after it. Core computes adjusted targets as absolute offsets from
// accumulated deltas, so dropping superseded writes is lossless.
const scrollGenerations = new WeakMap<Virtualizer<HTMLDivElement, HTMLDivElement>, number>();

// Per-instance hook that synchronously commits the transcript's render so the
// sizer reflects the latest measurements before an adjustment write.
// Registered by the component because only React can flush its own render.
const sizerCommits = new WeakMap<Virtualizer<HTMLDivElement, HTMLDivElement>, () => void>();

function scrollWithDeferredAdjustments(
  offset: number,
  options: ElementScrollOptions,
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
): void {
  const generation = (scrollGenerations.get(instance) ?? 0) + 1;
  scrollGenerations.set(instance, generation);
  if (options.adjustments === undefined) {
    elementScroll(offset, options, instance);
    return;
  }
  // An adjustment write and the geometry it compensates must land in the same
  // paint. The write happens here in a microtask, while the grown sizer and
  // the moved rows commit in a *scheduled* React render — writing against the
  // stale layout tears the frame two ways: targets past the stale scrollHeight
  // get clamped to the old bottom (the viewport dumps back down on every first
  // measurement while the reader scrolls up), and un-clamped writes shift the
  // scrollport a frame before the rows move under it (the pinned-message
  // flicker). Force the commit, then write, so one paint carries both.
  queueMicrotask(() => {
    if (scrollGenerations.get(instance) !== generation) return;
    sizerCommits.get(instance)?.();
    // The forced commit can mount and measure new rows, issuing a newer
    // adjusted write that supersedes this one.
    if (scrollGenerations.get(instance) !== generation) return;
    elementScroll(offset, options, instance);
  });
}

const styles = stylex.create({
  plane: {
    position: "relative",
    minWidth: 0,
    width: "100%",
    overflowAnchor: "none",
  },
  row: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineStart: 0,
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    contain: "layout",
  },
  // A sticky row's wrapper spans from the row's start to the next sticky
  // row's start, positioned with top (not transform) so CSS sticky resolves
  // against the scrollport. The next sticky region's start is this region's
  // end, which is what pushes the pinned message off the top.
  stickyRegion: {
    position: "absolute",
    insetInlineStart: 0,
    width: "100%",
    minWidth: 0,
    pointerEvents: "none",
  },
  stickyContent: {
    position: "sticky",
    insetBlockStart: 0,
    zIndex: zVars["--honk-z-thread-sticky-message"],
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    pointerEvents: "auto",
  },
});

const dynamic = stylex.create({
  planeHeight: (px: number) => ({ height: `${String(px)}px` }),
  rowStart: (px: number) => ({ transform: `translate3d(0, ${String(px)}px, 0)` }),
  regionFrame: (topPx: number, heightPx: number) => ({
    insetBlockStart: `${String(topPx)}px`,
    height: `${String(heightPx)}px`,
  }),
  rowGaps: (leadingPx: number, trailingPx: number) => ({
    paddingBlockStart: `${String(leadingPx)}px`,
    paddingBlockEnd: `${String(trailingPx)}px`,
  }),
});

export type VirtualTranscriptController = {
  readonly scrollToIndex: (
    index: number,
    options?: { readonly behavior?: ScrollBehavior; readonly align?: "start" | "center" | "end" },
  ) => void;
};

export function virtualTranscriptRangeIndexes(input: {
  readonly baseIndexes: readonly number[];
  readonly stickyOwnerIndex: number | null;
  readonly retainedRowIndex: number | null;
}): number[] {
  const indexes = new Set(input.baseIndexes);
  if (input.stickyOwnerIndex !== null) indexes.add(input.stickyOwnerIndex);
  if (input.retainedRowIndex !== null) indexes.add(input.retainedRowIndex);
  return [...indexes].sort((left, right) => left - right);
}

type VirtualTranscriptProps<Row> = {
  readonly rows: readonly Row[];
  // Parent-owned refs attach after descendant layout effects. Passing the
  // resolved node makes virtualizer and listener setup rerun as soon as the
  // scrollport exists.
  readonly scrollElement: HTMLDivElement | null;
  readonly controllerRef?: React.RefObject<VirtualTranscriptController | null>;
  readonly getRowId: (row: Row) => string;
  readonly retainedRowId?: string;
  readonly stickyRow: (row: Row) => boolean;
  readonly estimateRowSize: (row: Row) => number;
  // Row gaps render as padding inside the measured element, so they are part
  // of the row's virtual size. Both callbacks must be stable for a row's
  // lifetime: the trailing gap may depend only on the row itself, the leading
  // gap only on the row and its predecessor. A gap that depended on the *next*
  // row would flip when a sibling streams in, re-measuring settled rows and
  // shifting virtual geometry a frame behind the DOM.
  readonly getRowLeadingGapPx: (row: Row, index: number) => number;
  readonly getRowTrailingGapPx: (row: Row) => number;
  readonly renderRow: (row: Row, index: number) => React.ReactNode;
  readonly onRowElement?: (row: Row, index: number, element: HTMLDivElement | null) => void;
  readonly endClearancePx: number;
  readonly initialViewportHeightPx: number;
  readonly nearEndThresholdPx: number;
  readonly contentVersion: unknown;
  readonly restorationKey?: string;
};

export function VirtualTranscript<Row>({
  rows,
  scrollElement,
  controllerRef,
  getRowId,
  retainedRowId,
  stickyRow,
  estimateRowSize,
  getRowLeadingGapPx,
  getRowTrailingGapPx,
  renderRow,
  onRowElement,
  endClearancePx,
  initialViewportHeightPx,
  nearEndThresholdPx,
  contentVersion,
  restorationKey,
}: VirtualTranscriptProps<Row>): React.ReactElement {
  const rowCount = rows.length;
  const spacerIndex = rowCount;
  const stickyIndexes = rows.flatMap((row, index) => (stickyRow(row) ? [index] : []));
  const requestedRetainedRowIndex =
    retainedRowId === undefined ? -1 : rows.findIndex((row) => getRowId(row) === retainedRowId);
  const retainedRowIndex = requestedRetainedRowIndex < 0 ? null : requestedRetainedRowIndex;
  const lastStickyIndex = stickyIndexes[stickyIndexes.length - 1] ?? null;
  const lastStickyRow = lastStickyIndex === null ? undefined : rows[lastStickyIndex];
  const lastStickyKey = lastStickyRow === undefined ? null : getRowId(lastStickyRow);
  const [restored] = React.useState(() =>
    restorationKey === undefined ? null : (retainedTranscripts.get(restorationKey) ?? null),
  );
  const shouldFollowRef = React.useRef(restored?.shouldFollow ?? true);
  // Attribution ledger: the scrollTop of the last programmatic follow write.
  // A scroll event matching it (before genuine user input clears it) is our
  // own echo and must not change follow intent — this is what prevents the
  // programmatic snap from re-arming follow against the user.
  const expectedOffsetRef = React.useRef<number | null>(null);
  // Gesture ledger, shared by the scroll listeners and the controller: only
  // attributed events may change follow intent. Untagged scroll events —
  // browser clamps during sizer shrink, measurement adjustments — must
  // neither release nor re-arm follow, or a clamp landing at the bottom pins
  // the reader there while unmeasured history settles.
  const pointerDownRef = React.useRef(false);
  const lastUserInputAtRef = React.useRef(Number.NEGATIVE_INFINITY);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: spacerIndex + 1,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => {
      const row = rows[index];
      return row === undefined ? TRANSCRIPT_SPACER_KEY : getRowId(row);
    },
    estimateSize: (index) => {
      const row = rows[index];
      if (row === undefined) return endClearancePx;
      return estimateRowSize(row) + getRowLeadingGapPx(row, index) + getRowTrailingGapPx(row);
    },
    overscan: OVERSCAN_ROWS,
    // The sticky row owning the top of the viewport must stay mounted while
    // its turn scrolls underneath. A retained row may sit outside the range
    // while an in-place interaction owns state that must stay mounted.
    rangeExtractor: (range) => {
      const stickyOwnerIndex = stickyIndexes.findLast((index) => index <= range.startIndex) ?? null;
      return virtualTranscriptRangeIndexes({
        baseIndexes: defaultRangeExtractor(range),
        stickyOwnerIndex,
        retainedRowIndex,
      });
    },
    initialRect: { width: 0, height: initialViewportHeightPx },
    initialOffset: restored?.offset ?? 0,
    initialMeasurementsCache: restored?.measurements ?? [],
    scrollEndThreshold: nearEndThresholdPx,
    useAnimationFrameWithResizeObserver: true,
    scrollToFn: scrollWithDeferredAdjustments,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const [, forceRender] = React.useReducer((count: number) => count + 1, 0);

  React.useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) =>
      shouldAdjustTranscriptScrollPosition(item, delta, instance, stickyIndexes);
  }, [stickyIndexes, virtualizer]);

  // Adjustment writes call this (via scrollWithDeferredAdjustments) when their
  // target lies beyond the current sizer, so the plane height re-renders from
  // the fresh measurements before the browser can clamp the write. Runs from a
  // microtask, never during render, so flushSync is legal here.
  React.useLayoutEffect(() => {
    sizerCommits.set(virtualizer, () => {
      flushSync(forceRender);
    });
    return () => {
      sizerCommits.delete(virtualizer);
    };
  }, [virtualizer]);

  React.useLayoutEffect(() => {
    const spacer = virtualizer.measurementsCache[spacerIndex];
    if (spacer === undefined) return;
    if (Math.abs(spacer.size - endClearancePx) >= 1) {
      virtualizer.resizeItem(spacerIndex, endClearancePx);
    }
  });

  React.useLayoutEffect(() => {
    if (scrollElement === null) return;
    // A real gesture stamps the attribution window and retires any pending
    // echo so a coincidental offset match cannot mislabel the user's own
    // scroll as programmatic.
    const markUserInput = (): void => {
      lastUserInputAtRef.current = Date.now();
      expectedOffsetRef.current = null;
    };
    const userAttributed = (): boolean =>
      pointerDownRef.current || Date.now() - lastUserInputAtRef.current <= USER_INPUT_WINDOW_MS;
    const handleScroll = (): void => {
      const expected = expectedOffsetRef.current;
      if (
        expected !== null &&
        Math.abs(scrollElement.scrollTop - expected) <= PROGRAMMATIC_TOLERANCE_PX
      ) {
        // Our own follow write echoing back: consume it, leave intent alone.
        expectedOffsetRef.current = null;
        return;
      }
      const distance = virtualizer.getDistanceFromEnd();
      // Any non-echo scroll that leaves the bottom band ends following.
      if (distance > nearEndThresholdPx) {
        shouldFollowRef.current = false;
        return;
      }
      // Inside the band: an upward user gesture releases immediately (touch
      // drags and scrollbar grabs produce no wheel event); a user-attributed
      // return to the bottom re-engages; anything else keeps the current
      // intent. Requiring attribution on both sides means a browser clamp or
      // measurement adjustment that happens to land at the bottom cannot
      // re-arm follow against a reader who scrolled away.
      if (userAttributed() && virtualizer.scrollDirection === "backward") {
        shouldFollowRef.current = false;
        return;
      }
      if (userAttributed() && distance <= REENGAGE_THRESHOLD_PX) shouldFollowRef.current = true;
    };
    const handleWheel = (event: WheelEvent): void => {
      markUserInput();
      if (event.deltaY < 0) shouldFollowRef.current = false;
    };
    const handlePointerDown = (): void => {
      pointerDownRef.current = true;
      markUserInput();
    };
    const handlePointerUp = (): void => {
      pointerDownRef.current = false;
      markUserInput();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!SCROLL_KEYS.has(event.key)) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      markUserInput();
      const releases = RELEASE_KEYS.has(event.key) || (event.key === " " && event.shiftKey);
      if (releases) shouldFollowRef.current = false;
    };
    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    scrollElement.addEventListener("wheel", handleWheel, { passive: true });
    scrollElement.addEventListener("pointerdown", handlePointerDown, { passive: true });
    // Chromium delivers mousedown but not reliably pointerdown for scrollbar
    // interactions; without this a scrollbar drag would be unattributed.
    scrollElement.addEventListener("mousedown", handlePointerDown, { passive: true });
    scrollElement.addEventListener("touchstart", markUserInput, { passive: true });
    scrollElement.addEventListener("touchmove", markUserInput, { passive: true });
    scrollElement.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    window.addEventListener("pointercancel", handlePointerUp, { passive: true });
    window.addEventListener("mouseup", handlePointerUp, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
      scrollElement.removeEventListener("wheel", handleWheel);
      scrollElement.removeEventListener("pointerdown", handlePointerDown);
      scrollElement.removeEventListener("mousedown", handlePointerDown);
      scrollElement.removeEventListener("touchstart", markUserInput);
      scrollElement.removeEventListener("touchmove", markUserInput);
      scrollElement.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [nearEndThresholdPx, scrollElement, virtualizer]);

  // A newly appended user message always re-enters follow mode so it pins to
  // the top of the scrollport, even if the user was reading history. Seeding
  // the ref from the retained key (not the current one) lets a message that
  // arrived while this transcript was unmounted register as an append below.
  const lastStickyKeyRef = React.useRef(restored === null ? lastStickyKey : restored.lastStickyKey);
  React.useLayoutEffect(() => {
    if (lastStickyKeyRef.current === lastStickyKey) return;
    lastStickyKeyRef.current = lastStickyKey;
    if (lastStickyKey !== null) shouldFollowRef.current = true;
  }, [lastStickyKey]);

  React.useLayoutEffect(() => {
    if (!shouldFollowRef.current || scrollElement === null) return;
    const frame = window.requestAnimationFrame(() => {
      if (!shouldFollowRef.current) return;
      if (virtualizer.getDistanceFromEnd() <= FOLLOW_DEADBAND_PX) return;
      // Scroll the element directly rather than via virtualizer.scrollToEnd():
      // scrollToEnd installs core's self-rescheduling scrollState reconcile
      // loop, which re-snaps to the growing bottom every frame for seconds and
      // is re-fed (never cancelled) by user scrolls — the snap-back and bounce
      // bug. One tagged write per content change follows the bottom without a
      // loop, and its echo is excluded via expectedOffsetRef. The follow write
      // is the newest scroll command: bump the generation so any queued
      // adjustment microtask is superseded instead of landing after this write
      // and dragging the viewport off the bottom.
      scrollGenerations.set(virtualizer, (scrollGenerations.get(virtualizer) ?? 0) + 1);
      const target = scrollElement.scrollHeight - scrollElement.clientHeight;
      expectedOffsetRef.current = target;
      scrollElement.scrollTo({ top: target, behavior: "auto" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    contentVersion,
    endClearancePx,
    lastStickyKey,
    rowCount,
    scrollElement,
    totalSize,
    virtualizer,
  ]);

  React.useLayoutEffect(() => {
    if (restorationKey === undefined || scrollElement === null) return;
    return () => {
      retainTranscript(restorationKey, {
        offset: virtualizer.scrollOffset ?? scrollElement.scrollTop,
        measurements: virtualizer.takeSnapshot(),
        shouldFollow: shouldFollowRef.current,
        lastStickyKey: lastStickyKeyRef.current,
      });
    };
  }, [restorationKey, scrollElement, virtualizer]);

  React.useLayoutEffect(() => {
    if (controllerRef === undefined) return;
    const controller: VirtualTranscriptController = {
      scrollToIndex: (index, options) => {
        // Explicit navigation owns the viewport: release follow and retire any
        // pending follow echo so the jump is neither fought by a streaming
        // follow write nor misattributed. The jump is a user act (a click), so
        // it stamps the attribution window — landing at the bottom inside it
        // re-engages follow through the scroll handler like any user return.
        shouldFollowRef.current = false;
        expectedOffsetRef.current = null;
        lastUserInputAtRef.current = Date.now();
        virtualizer.scrollToIndex(index, {
          align: options?.align ?? "start",
          behavior: options?.behavior ?? "auto",
        });
      },
    };
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [controllerRef, virtualizer]);

  const nextStickyStart = (index: number): number => {
    const next = stickyIndexes.find((stickyIndex) => stickyIndex > index);
    if (next === undefined) return totalSize;
    return virtualizer.measurementsCache[next]?.start ?? totalSize;
  };

  return (
    <div data-virtual-transcript="" {...stylex.props(styles.plane, dynamic.planeHeight(totalSize))}>
      {virtualItems.map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (row === undefined) return null;
        if (stickyRow(row)) {
          return (
            <div
              key={virtualRow.key}
              ref={(element) => {
                onRowElement?.(row, virtualRow.index, element);
              }}
              data-virtual-transcript-region=""
              {...stylex.props(
                styles.stickyRegion,
                dynamic.regionFrame(
                  virtualRow.start,
                  Math.max(nextStickyStart(virtualRow.index) - virtualRow.start, 0),
                ),
              )}
            >
              <div
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                data-virtual-transcript-row=""
                {...stylex.props(
                  styles.stickyContent,
                  dynamic.rowGaps(
                    getRowLeadingGapPx(row, virtualRow.index),
                    getRowTrailingGapPx(row),
                  ),
                )}
              >
                {renderRow(row, virtualRow.index)}
              </div>
            </div>
          );
        }
        return (
          <div
            key={virtualRow.key}
            ref={(element) => {
              virtualizer.measureElement(element);
              onRowElement?.(row, virtualRow.index, element);
            }}
            data-index={virtualRow.index}
            data-virtual-transcript-row=""
            {...stylex.props(
              styles.row,
              dynamic.rowStart(virtualRow.start),
              dynamic.rowGaps(getRowLeadingGapPx(row, virtualRow.index), getRowTrailingGapPx(row)),
            )}
          >
            {renderRow(row, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
