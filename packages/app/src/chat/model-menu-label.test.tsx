// The trigger label must be deterministic: core's default model when nothing
// is chosen, and a catalog-resolved display name — never a raw model id —
// whenever the catalog knows the model, even if the exact provider row is
// missing (the load window, or a provider id the catalog doesn't list).

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Models } from "@honk/core/models";

import { providerSummary } from "../test-fixtures";
import { CoreModelSelector } from "./model-menu";
import { NO_SELECTION } from "./selection";

const catalogState: {
  phase: {
    readonly status: "ready";
    readonly providers: readonly Models.ProviderSummary[];
    readonly error: null;
  };
} = { phase: { status: "ready", providers: [], error: null } };

vi.mock("./model-catalog", () => ({
  useCatalogPhase: () => catalogState.phase,
}));

const provider = (
  id: string,
  name: string,
  configured: boolean,
  models: readonly { id: string; name: string }[],
): Models.ProviderSummary => providerSummary({ id, name, configured, models });

const labelOf = (html: string): string | undefined => /aria-label="Model: ([^"]*)"/.exec(html)?.[1];

describe("the model trigger label", () => {
  it("with no explicit selection the trigger names core's default model", () => {
    catalogState.phase = {
      status: "ready",
      providers: [
        provider("anthropic", "Anthropic", true, [
          { id: "claude-fable-5", name: "Claude Fable 5" },
          { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
        ]),
      ],
      error: null,
    };
    const html = renderToStaticMarkup(
      <CoreModelSelector mode="create" selection={NO_SELECTION} onSelectionChange={() => {}} />,
    );
    expect(labelOf(html)).toBe("Fable 5");
  });

  it("a model whose exact provider row is missing still renders the catalog's display name", () => {
    catalogState.phase = {
      status: "ready",
      providers: [
        provider("anthropic", "Anthropic", true, [
          { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
        ]),
      ],
      error: null,
    };
    const html = renderToStaticMarkup(
      <CoreModelSelector
        mode="session"
        selection={{
          kind: "model",
          model: { providerId: "opencode", modelId: "claude-haiku-4-5" },
          thinkingLevel: null,
        }}
        onModelChange={() => {}}
        onThinkingLevel={() => {}}
      />,
    );
    expect(labelOf(html)).toBe("Claude Haiku 4.5");
  });

  it("keeps the edit trigger compact while naming its model and effort", () => {
    catalogState.phase = {
      status: "ready",
      providers: [
        provider("anthropic", "Anthropic", true, [
          { id: "claude-fable-5", name: "Claude Fable 5" },
        ]),
      ],
      error: null,
    };
    const html = renderToStaticMarkup(
      <CoreModelSelector
        mode="edit"
        selection={{
          kind: "model",
          model: { providerId: "anthropic", modelId: "claude-fable-5" },
          thinkingLevel: "high",
        }}
        onSelectionChange={() => {}}
      />,
    );

    expect(labelOf(html)).toBe("Fable 5 · High");
    expect(html).not.toContain(">Fable 5<");
  });
});
