import { describe, expect, test } from "vitest";

import { virtualTranscriptRangeIndexes } from "./virtual-transcript";

describe("virtual transcript range retention", () => {
  test("keeps an offscreen retained row sorted and dedupes forced overlaps", () => {
    expect(
      virtualTranscriptRangeIndexes({
        baseIndexes: [8, 9, 10],
        stickyOwnerIndex: 6,
        retainedRowIndex: 4,
      }),
    ).toEqual([4, 6, 8, 9, 10]);

    expect(
      virtualTranscriptRangeIndexes({
        baseIndexes: [8, 9, 10],
        stickyOwnerIndex: 8,
        retainedRowIndex: 9,
      }),
    ).toEqual([8, 9, 10]);
  });
});
