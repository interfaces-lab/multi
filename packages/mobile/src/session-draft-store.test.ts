import { describe, expect, it } from "vitest";

import {
  EMPTY_SESSION_DRAFT,
  readSessionDraft,
  type SessionDraft,
  writeSessionDraft,
} from "./session-draft-store";

describe("session draft store", () => {
  it("keeps exact text and image payloads under the owning session", () => {
    const first = "draft-store:first";
    const second = "draft-store:second";
    const draft: SessionDraft = {
      text: "  keep this exactly\n",
      images: [{ data: "cGl4ZWw=", mimeType: "image/png" }],
    };

    writeSessionDraft(first, draft);

    expect(readSessionDraft(first)).toEqual(draft);
    expect(readSessionDraft(second)).toBe(EMPTY_SESSION_DRAFT);
  });

  it("removes an empty draft instead of leaving stale session state", () => {
    const sessionId = "draft-store:cleared";
    writeSessionDraft(sessionId, { text: "work", images: [] });
    writeSessionDraft(sessionId, EMPTY_SESSION_DRAFT);

    expect(readSessionDraft(sessionId)).toBe(EMPTY_SESSION_DRAFT);
  });
});
