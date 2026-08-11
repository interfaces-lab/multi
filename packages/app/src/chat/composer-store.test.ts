import { describe, expect, it } from "vitest";

import { Session } from "@honk/core/session";

import {
  composerKeyActionOf,
  draftKeyOf,
  promptPhaseOf,
  readDraft,
  restoreDraft,
  startSubmitOf,
  submitLabelOf,
  submitVerbOf,
  subscribeDrafts,
  writeDraft,
} from "./composer-store";

const message = (text: string) => ({ text, images: [] });
const image = { data: "pixel", mimeType: "image/png" };

describe("draft store", () => {
  it("keys the start surface and each thread separately", () => {
    const sessionId = Session.SessionId.make("ses_keys");
    expect(draftKeyOf(null)).toBe("start");
    expect(draftKeyOf(sessionId)).toBe(sessionId);
  });

  it("holds a draft across readers until it is cleared", () => {
    writeDraft("k", message("hello goose"));
    expect(readDraft("k")).toEqual(message("hello goose"));
    writeDraft("k", message(""));
    expect(readDraft("k")).toEqual(message(""));
  });

  it("notifies subscribers on every write", () => {
    let notified = 0;
    const unsubscribe = subscribeDrafts(() => {
      notified += 1;
    });
    writeDraft("n", message("one"));
    writeDraft("n", message(""));
    unsubscribe();
    writeDraft("n", message("silent"));
    expect(notified).toBe(2);
    writeDraft("n", message(""));
  });

  it("restores cleared text into an empty editor as-is", () => {
    restoreDraft("r", message("kept words"));
    expect(readDraft("r")).toEqual(message("kept words"));
    writeDraft("r", message(""));
  });

  it("restores ahead of newer typing instead of clobbering it", () => {
    writeDraft("r", message("newer thought"));
    restoreDraft("r", message("cleared words"));
    expect(readDraft("r")).toEqual(message("cleared words\n\nnewer thought"));
    writeDraft("r", message(""));
  });

  it("restores images with the queued text and keeps newer images", () => {
    writeDraft("r", { text: "newer thought", images: [image] });
    restoreDraft("r", { text: "cleared words", images: [{ ...image, mimeType: "image/jpeg" }] });
    expect(readDraft("r")).toEqual({
      text: "cleared words\n\nnewer thought",
      images: [{ ...image, mimeType: "image/jpeg" }, image],
    });
    writeDraft("r", message(""));
  });

  it("restoring nothing changes nothing", () => {
    let notified = 0;
    const unsubscribe = subscribeDrafts(() => {
      notified += 1;
    });
    restoreDraft("r", message(""));
    unsubscribe();
    expect(notified).toBe(0);
    expect(readDraft("r")).toEqual(message(""));
  });
});

describe("prompt phase", () => {
  it("preserves any authored text and accepts images without text", () => {
    expect(promptPhaseOf(message(""), false)).toBe("empty");
    expect(promptPhaseOf(message("   \n"), false)).toBe("draft");
    expect(promptPhaseOf(message("ship it"), false)).toBe("draft");
    expect(promptPhaseOf({ text: "", images: [image] }, false)).toBe("draft");
  });

  it("lets submitting win over text", () => {
    expect(promptPhaseOf(message("ship it"), true)).toBe("submitting");
    expect(promptPhaseOf(message(""), true)).toBe("submitting");
  });
});

describe("verb matrix", () => {
  it("maps idle Enter to prompt, running Enter to followUp, running mod-Enter to steer", () => {
    expect(submitVerbOf(false, false)).toBe("prompt");
    expect(submitVerbOf(false, true)).toBe("prompt");
    expect(submitVerbOf(true, false)).toBe("followUp");
    expect(submitVerbOf(true, true)).toBe("steer");
  });

  it("labels the button with what Enter will do", () => {
    expect(submitLabelOf("draft", false, false)).toBe("Send");
    expect(submitLabelOf("empty", false, false)).toBe("Send");
    expect(submitLabelOf("draft", true, false)).toBe("Queue");
    expect(submitLabelOf("draft", true, true)).toBe("Steer");
    // A locked start submit never re-arms as a queue or steer.
    expect(submitLabelOf("submitting", true, true)).toBe("Send");
  });
});

describe("composer key grammar", () => {
  const key = (k: string, shiftKey = false, mod = false) => ({ key: k, shiftKey, mod });

  it("plain Enter submits, mod-Enter submits now, Shift+Enter stays a newline", () => {
    expect(composerKeyActionOf(key("Enter"), false)).toBe("submit");
    expect(composerKeyActionOf(key("Enter", false, true), false)).toBe("submit-now");
    expect(composerKeyActionOf(key("Enter", true), false)).toBe("newline");
    expect(composerKeyActionOf(key("a"), false)).toBe("none");
  });

  it("an open menu takes Enter before the send branch: accept, never send", () => {
    expect(composerKeyActionOf(key("Enter"), true)).toBe("menu-accept");
    expect(composerKeyActionOf(key("Tab"), true)).toBe("menu-accept");
    expect(composerKeyActionOf(key("ArrowUp"), true)).toBe("menu-up");
    expect(composerKeyActionOf(key("ArrowDown"), true)).toBe("menu-down");
    expect(composerKeyActionOf(key("Escape"), true)).toBe("menu-close");
  });

  it("the menu's Enter claim outranks the send chords, not just plain Enter", () => {
    // The menu branch runs first on purpose. Read the mod flag before it and
    // an @-mention accept turns into a steer that sends the half-typed path.
    expect(composerKeyActionOf(key("Enter", false, true), true)).toBe("menu-accept");
    expect(composerKeyActionOf(key("Enter", true), true)).toBe("menu-accept");
  });

  it("keys the menu does not own fall through to typing while it is open", () => {
    expect(composerKeyActionOf(key("a"), true)).toBe("none");
    expect(composerKeyActionOf(key("Backspace"), true)).toBe("none");
  });
});

describe("start submit", () => {
  it("ignores a submit while the session is being created", () => {
    expect(startSubmitOf(message("ship it"), true, "/repo")).toBe("ignore");
  });

  it("ignores an empty draft", () => {
    expect(startSubmitOf(message(""), false, "/repo")).toBe("ignore");
  });

  it("starts an image-only message", () => {
    const draft = { text: "", images: [image] };
    expect(startSubmitOf(draft, false, "/repo")).toEqual({ message: draft, directory: "/repo" });
  });

  it("asks for a folder when none is chosen", () => {
    expect(startSubmitOf(message("ship it"), false, null)).toBe("choose-folder");
  });

  it("starts with the exact text in the chosen folder", () => {
    expect(startSubmitOf(message("  ship it  "), false, "/repo")).toEqual({
      message: message("  ship it  "),
      directory: "/repo",
    });
  });
});
