import { describe, expect, it } from "vitest";

import {
  assistantMessageEntry,
  compactionEntry,
  type AssistantContent,
  userMessageEntry,
} from "../test-fixtures";
import { conversationItems } from "./chat-model";
import {
  timelineItems,
  TRANSCRIPT_EDGE_PAD_PX,
  transcriptRowEstimatePx,
  transcriptRowLeadingGapPx,
  transcriptRows,
  transcriptRowTrailingGapPx,
} from "./transcript-rows";

const assistantEntry = (id: string, content: readonly AssistantContent[]) =>
  assistantMessageEntry(id, content);

describe("the transcript's row plane", () => {
  it("splits every turn into a sticky user row and a work row", () => {
    const rows = transcriptRows(
      conversationItems(
        [
          userMessageEntry("u1", "first"),
          assistantEntry("a1", [{ type: "text", text: "done" }]),
          userMessageEntry("u2", "second"),
        ],
        null,
      ),
    );

    expect(rows.map((row) => `${row.kind}:${row.key}`)).toEqual([
      "user:user:u1",
      "work:work:u1",
      "user:user:u2",
      "work:work:u2",
    ]);
  });

  it("gives compaction dividers and notices a row of their own", () => {
    const rows = transcriptRows(
      conversationItems([userMessageEntry("u1", "hi"), compactionEntry("c1")], null),
    );

    expect(rows.map((row) => row.kind)).toEqual(["user", "work", "aside"]);
  });

  it("keeps every row's gap decided by the row itself, never by its successor", () => {
    const rows = transcriptRows(
      conversationItems(
        [userMessageEntry("u1", "first"), assistantEntry("a1", [{ type: "text", text: "done" }])],
        null,
      ),
    );
    const [user, work] = rows;
    if (user === undefined || work === undefined) throw new Error("expected two rows");

    // A user row is always followed by its own work row, so the pair sits at
    // the tighter within-turn gap; every other row opens a new section.
    expect(transcriptRowTrailingGapPx(user)).toBeLessThan(transcriptRowTrailingGapPx(work));
    expect(transcriptRowTrailingGapPx(work)).toBe(TRANSCRIPT_EDGE_PAD_PX);
    // Only the transcript's own top edge is a leading gap.
    expect(transcriptRowLeadingGapPx(user, 0)).toBe(TRANSCRIPT_EDGE_PAD_PX);
    expect(transcriptRowLeadingGapPx(work, 1)).toBe(0);
    expect(transcriptRowEstimatePx(work)).toBeGreaterThan(transcriptRowEstimatePx(user));
  });

  it("maps each turn to one rail stop previewed by its first headline", () => {
    const stops = timelineItems(
      conversationItems(
        [
          userMessageEntry("u1", "bump the version"),
          assistantEntry("a1", [
            { type: "text", text: "Looking at the manifest." },
            { type: "toolCall", id: "c1", name: "read", arguments: { path: "package.json" } },
            { type: "text", text: "Bumped." },
          ]),
          userMessageEntry("u2", "thanks"),
        ],
        null,
      ),
    );

    expect(stops).toEqual([
      { id: "u1", userText: "bump the version", assistantText: "Looking at the manifest." },
      { id: "u2", userText: "thanks", assistantText: null },
    ]);
  });
});
