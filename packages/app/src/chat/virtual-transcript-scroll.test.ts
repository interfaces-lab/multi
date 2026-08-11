import { Virtualizer } from "@tanstack/react-virtual";
import { describe, expect, test, vi } from "vitest";

import {
  shouldAdjustTranscriptScrollPosition,
  TRANSCRIPT_SPACER_KEY,
} from "./virtual-transcript-scroll";

const ITEM_KEYS: readonly (string | number)[] = ["row:0", "row:1", TRANSCRIPT_SPACER_KEY];

function createVirtualizer(input?: {
  readonly direction?: "backward" | "forward" | null;
  readonly offset?: number;
  readonly stickyIndexes?: readonly number[];
}) {
  const scrollToFn = vi.fn();
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: ITEM_KEYS.length,
    getScrollElement: () => null,
    getItemKey: (index) => ITEM_KEYS[index] ?? index,
    estimateSize: () => 120,
    initialRect: { width: 800, height: 100 },
    initialOffset: input?.offset ?? 100,
    observeElementOffset: () => undefined,
    observeElementRect: () => undefined,
    scrollToFn,
  });
  virtualizer.getTotalSize();
  virtualizer.scrollOffset = input?.offset ?? 100;
  virtualizer.scrollDirection = input?.direction ?? null;
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) =>
    shouldAdjustTranscriptScrollPosition(item, delta, instance, input?.stickyIndexes ?? []);
  return { scrollToFn, virtualizer };
}

describe("virtual transcript resize policy", () => {
  test("compensates first measurements even while scrolling up", () => {
    const subject = createVirtualizer({ direction: "backward" });

    // row:0 is above the viewport (start 0 < offset 100) and unmeasured, so
    // the estimate -> actual delta must be compensated or history jumps as it
    // mounts under an upward scroll.
    subject.virtualizer.resizeItem(0, 1_320);

    expect(subject.scrollToFn).toHaveBeenCalledOnce();
  });

  test("skips re-measurements while scrolling up", () => {
    const subject = createVirtualizer({ direction: "backward" });
    subject.virtualizer.itemSizeCache.set("row:0", 120);
    subject.scrollToFn.mockClear();

    subject.virtualizer.resizeItem(0, 40);

    expect(subject.scrollToFn).not.toHaveBeenCalled();
    expect(subject.virtualizer.scrollOffset).toBe(100);
  });

  test("preserves the reading anchor while idle or scrolling forward", () => {
    const idle = createVirtualizer();
    const forward = createVirtualizer({ direction: "forward" });

    idle.virtualizer.resizeItem(0, 240);
    forward.virtualizer.resizeItem(0, 240);

    expect(idle.scrollToFn).toHaveBeenCalledOnce();
    expect(forward.scrollToFn).toHaveBeenCalledOnce();
    expect(idle.virtualizer.scrollOffset).toBeGreaterThan(100);
    expect(forward.virtualizer.scrollOffset).toBeGreaterThan(100);
  });

  test("does not anchor rows below the viewport, the sticky owner, or the spacer", () => {
    const belowViewport = createVirtualizer();
    const stickyOwner = createVirtualizer({ stickyIndexes: [0] });
    const spacer = createVirtualizer({ offset: 300 });

    belowViewport.virtualizer.resizeItem(1, 240);
    stickyOwner.virtualizer.resizeItem(0, 240);
    spacer.virtualizer.resizeItem(2, 240);

    expect(belowViewport.scrollToFn).not.toHaveBeenCalled();
    expect(stickyOwner.scrollToFn).not.toHaveBeenCalled();
    expect(spacer.scrollToFn).not.toHaveBeenCalled();
  });
});
