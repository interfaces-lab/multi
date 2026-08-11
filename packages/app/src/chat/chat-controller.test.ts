import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Session } from "@honk/core/session";

import { sendInitialPrompt } from "./chat-controller";
import { draftKeyOf, EMPTY_MESSAGE, readDraft, writeDraft } from "./composer-store";

const clientMocks = vi.hoisted(() => ({
  getHonkClient: vi.fn((): unknown => null),
}));

vi.mock("./client", () => ({
  describeError: (error: unknown) => String(error),
  getHonkClient: clientMocks.getHonkClient,
  requireHonkClient: () => {
    throw new Error("Honk Core is not connected yet.");
  },
}));

const SESSION_ID = Session.SessionId.make("ses_initial_prompt");
const KEY = draftKeyOf(SESSION_ID);
const IMAGE = { data: "pixel", mimeType: "image/png" };

beforeEach(() => {
  clientMocks.getHonkClient.mockReturnValue(null);
});

afterEach(() => {
  writeDraft(KEY, EMPTY_MESSAGE);
});

describe("the first prompt of a fresh session", () => {
  it("parks the text in the thread draft when nothing can send it", () => {
    sendInitialPrompt(SESSION_ID, { text: "build the thing", images: [] });
    expect(readDraft(KEY)).toEqual({ text: "build the thing", images: [] });
  });

  it("lands the text in the thread draft when the send is rejected", async () => {
    const prompt = vi.fn(() => Promise.reject(new Error("session.not_found: gone")));
    clientMocks.getHonkClient.mockReturnValue({ session: { prompt } });

    sendInitialPrompt(SESSION_ID, { text: "build the thing", images: [IMAGE] });
    expect(prompt).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      text: "build the thing",
      images: [IMAGE],
    });
    await vi.waitFor(() => {
      expect(readDraft(KEY)).toEqual({ text: "build the thing", images: [IMAGE] });
    });
  });

  it("leaves the draft empty when the send goes out", async () => {
    clientMocks.getHonkClient.mockReturnValue({
      session: { prompt: vi.fn(() => Promise.resolve()) },
    });

    sendInitialPrompt(SESSION_ID, { text: "build the thing", images: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(readDraft(KEY)).toEqual(EMPTY_MESSAGE);
  });
});
