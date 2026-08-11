import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NO_SELECTION,
  readModelSelection,
  readRecent,
  reconcileModelSelection,
  rememberRecent,
  rememberSelection,
  resolveStartDirectory,
  selectionOf,
  type ModelSelection,
} from "./selection";

const provider = (
  id: string,
  configured: boolean,
  models: readonly { id: string; name: string }[],
) => ({ id, name: id, configured, methods: [], models });

const storage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remembered selection", () => {
  it("clears a remembered route instead of translating it to another provider", () => {
    const remembered: ModelSelection = {
      kind: "model",
      model: { providerId: "openai", modelId: "gpt-5.6-sol" },
      thinkingLevel: "high",
    };
    expect(
      reconcileModelSelection(remembered, [
        provider("openai", false, [{ id: "gpt-5.6-sol", name: "Sol" }]),
        provider("openai-codex", true, [{ id: "gpt-5.6-sol", name: "Sol" }]),
      ]),
    ).toEqual({ ...remembered, model: null });
  });

  it("clears a remembered model when no configured route can run it", () => {
    expect(
      reconcileModelSelection(
        {
          kind: "model",
          model: { providerId: "openai", modelId: "gpt-5.6-sol" },
          thinkingLevel: "high",
        },
        [provider("openai", false, [{ id: "gpt-5.6-sol", name: "Sol" }])],
      ),
    ).toEqual({ kind: "model", model: null, thinkingLevel: "high" });
  });

  it("accepts the model variant it writes", () => {
    expect(
      selectionOf({
        kind: "model",
        model: { providerId: "anthropic", modelId: "claude-opus-5" },
        thinkingLevel: "high",
      }),
    ).toEqual({
      kind: "model",
      model: { providerId: "anthropic", modelId: "claude-opus-5" },
      thinkingLevel: "high",
    });
  });

  it("accepts Fusion without admitting model fields", () => {
    expect(selectionOf({ kind: "fusion", stop: "claw" })).toEqual({
      kind: "fusion",
      stop: "claw",
    });
    expect(
      selectionOf({
        kind: "fusion",
        stop: "claw",
        model: { providerId: "anthropic", modelId: "claude-opus-5" },
      }),
    ).toEqual({ kind: "fusion", stop: "claw" });
  });

  it("an unrecognizable stored value reads as nothing rather than a guess", () => {
    expect(selectionOf({ kind: "fusion", stop: "turbo" })).toEqual({
      kind: "model",
      model: null,
      thinkingLevel: null,
    });
    expect(selectionOf("junk")).toEqual({
      kind: "model",
      model: null,
      thinkingLevel: null,
    });
  });

  it("one bad field costs itself, not the rest", () => {
    expect(selectionOf({ kind: "model", model: 7, thinkingLevel: "high" })).toEqual({
      kind: "model",
      model: null,
      thinkingLevel: "high",
    });
  });

  it("rejects empty-string ids that would fail the create codec", () => {
    expect(
      selectionOf({
        kind: "model",
        model: { providerId: "", modelId: "claude-opus-5" },
      }),
    ).toEqual(NO_SELECTION);
    expect(selectionOf({ kind: "model", model: { providerId: "anthropic", modelId: "" } })).toEqual(
      NO_SELECTION,
    );
  });

  it("round-trips through storage", () => {
    vi.stubGlobal("window", { localStorage: storage() });
    const selection: ModelSelection = {
      kind: "model",
      model: { providerId: "anthropic", modelId: "claude-opus-5" },
      thinkingLevel: "high",
    };
    rememberSelection(selection);
    expect(readModelSelection()).toEqual(selection);
  });

  it("a host with no storage reads as no memory", () => {
    expect(readModelSelection()).toEqual(NO_SELECTION);
  });
});

describe("recent directories", () => {
  it("uses the configured default before directory history", () => {
    expect(resolveStartDirectory("/default", ["/recent"])).toBe("/default");
    expect(resolveStartDirectory(null, ["/recent"])).toBe("/recent");
    expect(resolveStartDirectory(null, [])).toBeNull();
  });

  it("keeps the most recent first, deduplicated, capped at eight", () => {
    vi.stubGlobal("window", { localStorage: storage() });
    for (const directory of ["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h", "/i"]) {
      rememberRecent(directory);
    }
    expect(rememberRecent("/b")).toEqual(["/b", "/i", "/h", "/g", "/f", "/e", "/d", "/c"]);
    expect(readRecent()[0]).toBe("/b");
  });

  it("a host with no storage reads as no recents", () => {
    expect(readRecent()).toEqual([]);
  });
});
