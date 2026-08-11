import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";

import { SESSION_TITLE_MAX_LENGTH } from "../../src/session/contract";
import {
  normalizeSessionTitle,
  generateModelSessionTitle,
  titleFromEntries,
  titleFromModelOutput,
  titleFromPrompt,
} from "../../src/session/title";

describe("session titles", () => {
  it("normalizes a first text prompt into one line", () => {
    expect(titleFromPrompt({ text: "  Fix\n  the tab   title  ", hasImages: false })).toBe(
      "Fix the tab title",
    );
  });

  it("uses an honest title for an image-only prompt", () => {
    expect(titleFromPrompt({ text: "", hasImages: true })).toBe("Image request");
    expect(titleFromPrompt({ text: "", hasImages: false })).toBeUndefined();
  });

  it("clips long titles at a word boundary without splitting Unicode", () => {
    const title = normalizeSessionTitle(
      "Investigate websocket reconnect regressions after worktree restore",
    );
    expect(title).toBe("Investigate websocket reconnect regressions after…");
    expect(title?.length).toBeLessThanOrEqual(SESSION_TITLE_MAX_LENGTH);

    const unicode = normalizeSessionTitle("🪿".repeat(40));
    expect(unicode?.endsWith("🪿…")).toBe(true);
    expect(unicode?.length).toBeLessThanOrEqual(SESSION_TITLE_MAX_LENGTH);
  });

  it("normalizes a title-only model answer", () => {
    expect(
      titleFromModelOutput('<think>drafting</think>\n  "Repair reconnect state."  \nignored'),
    ).toBe("Repair reconnect state");
    expect(titleFromModelOutput("<think>nothing else</think>")).toBeUndefined();
  });

  it("recovers the first real user message from a stored transcript", () => {
    const entries = [
      {
        type: "model_change",
        id: "model",
        parentId: null,
        timestamp: "2026-08-09T00:00:00.000Z",
        provider: "faux",
        modelId: "faux-1",
      },
      {
        type: "message",
        id: "user",
        parentId: "model",
        timestamp: "2026-08-09T00:00:01.000Z",
        message: { role: "user", content: "Restore this title", timestamp: 1 },
      },
    ] satisfies SessionTreeEntry[];

    expect(titleFromEntries(entries)).toBe("Restore this title");
  });

  it("uses the selected model with bounded title-only options and image context", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([
      (context, options) => {
        expect(context.systemPrompt).toContain("concise titles");
        expect(context.messages[0]?.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "image", mimeType: "image/png" }),
          ]),
        );
        expect(options).toMatchObject({
          reasoning: "minimal",
          maxTokens: 64,
          maxRetries: 1,
          cacheRetention: "none",
        });
        return fauxAssistantMessage('"Fix visual tab titles"');
      },
    ]);

    const title = await generateModelSessionTitle(models, {
      model: faux.getModel(),
      text: "The tab still shows the project route",
      images: [{ data: "YWJj", mimeType: "image/png" }],
      signal: new AbortController().signal,
    });

    expect(title).toBe("Fix visual tab titles");
  });
});
