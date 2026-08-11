import { describe, expect, it } from "vitest";

import type { Models } from "@honk/core/models";

import { providerSummary } from "../test-fixtures";
import { curatedModelRows, defaultModelChoice, modelDisplayName } from "./model-menu";

const provider = (
  id: string,
  configured: boolean,
  models: readonly { id: string; name: string }[],
): Models.ProviderSummary =>
  providerSummary({
    id,
    name: id === "anthropic" ? "Anthropic" : id,
    configured,
    models,
  });

describe("curated model rows", () => {
  it("ships the fixed list, never the raw catalog", () => {
    const rows = curatedModelRows(
      [
        provider("honk-cloud", true, [
          { id: "claude-fable-5", name: "Claude Fable 5" },
          { id: "claude-opus-5", name: "Claude Opus 5" },
          { id: "qwen-3.5-plus", name: "Qwen3.5 Plus" },
          { id: "big-pickle", name: "Big Pickle" },
          { id: "kimi-k3", name: "Kimi K3" },
        ]),
      ],
      null,
    );
    expect(rows.map((row) => row.modelName)).toEqual(["Fable 5", "Opus 5", "Kimi K3"]);
    expect(rows.every((row) => row.description !== undefined)).toBe(true);
  });

  it("prefers the direct configured provider over a gateway reselling the family", () => {
    const rows = curatedModelRows(
      [
        provider("honk-cloud", true, [{ id: "claude-opus-5", name: "Claude Opus 5" }]),
        provider("anthropic", true, [{ id: "claude-opus-5", name: "Claude Opus 5" }]),
      ],
      null,
    );
    expect(rows.map((row) => row.providerId)).toEqual(["anthropic"]);
  });

  it("prefers the Codex account route over the Platform API when both are disconnected", () => {
    const rows = curatedModelRows(
      [
        provider("openai", false, [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }]),
        provider("openai-codex", false, [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }]),
      ],
      null,
    );
    expect(rows[0]?.providerId).toBe("openai-codex");
  });

  it("keeps a curated family visible but gated when only an unconfigured provider has it", () => {
    const rows = curatedModelRows(
      [provider("anthropic", false, [{ id: "claude-fable-5", name: "Claude Fable 5" }])],
      null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.configured).toBe(false);
  });

  it("resolves the default the way core does: first configured provider, first model", () => {
    expect(
      defaultModelChoice([
        provider("locked", false, [{ id: "m0", name: "M0" }]),
        provider("anthropic", true, [
          { id: "claude-fable-5", name: "Claude Fable 5" },
          { id: "claude-opus-5", name: "Claude Opus 5" },
        ]),
      ]),
    ).toEqual({ providerId: "anthropic", modelId: "claude-fable-5" });
    expect(defaultModelChoice([provider("locked", false, [{ id: "m0", name: "M0" }])])).toBeNull();
  });

  it("the session's own model joins the list when it is not curated", () => {
    const rows = curatedModelRows([provider("faux", true, [{ id: "faux-1", name: "Faux One" }])], {
      providerId: "faux",
      modelId: "faux-1",
    });
    expect(rows.map((row) => row.modelName)).toEqual(["Faux One"]);
    expect(modelDisplayName({ providerId: "faux", modelId: "faux-1" }, rows)).toBe("Faux One");
    expect(modelDisplayName(null, rows)).toBe("Model");
  });

  it("never treats a model from an absent provider as configured", () => {
    const rows = curatedModelRows(
      [provider("carrier", true, [{ id: "faux-1", name: "Faux One" }])],
      { providerId: "missing", modelId: "faux-1" },
    );
    expect(rows[0]?.providerId).toBe("missing");
    expect(rows[0]?.configured).toBe(false);
  });
});
