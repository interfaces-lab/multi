import { describe, expect, it } from "vitest";

import type { Models } from "@honk/core/models";

import { accountProviderRows, DEFAULT_ACCOUNT_PROVIDERS } from "./settings-providers";
import { providerSummary } from "./test-fixtures";

const provider = (id: string, configured: boolean): Models.ProviderSummary =>
  providerSummary({ id, configured });

describe("accountProviderRows", () => {
  // Ids verified against core's builtinModels catalog (what models.list maps),
  // not guessed: zai is Z.AI's GLM coding plan, kimi-coding is Kimi For Coding.
  it("pins the curated default set", () => {
    expect(DEFAULT_ACCOUNT_PROVIDERS).toEqual(["zai", "kimi-coding", "anthropic", "openai-codex"]);
  });

  it("leads with the defaults in declared order regardless of catalog order", () => {
    const rows = accountProviderRows([
      provider("openai-codex", false),
      provider("anthropic", false),
      provider("kimi-coding", false),
      provider("zai", false),
    ]);
    expect(rows.map((row) => row.id)).toEqual(DEFAULT_ACCOUNT_PROVIDERS);
  });

  it("skips a curated id the catalog lacks instead of inventing a row", () => {
    const rows = accountProviderRows([provider("anthropic", false), provider("zai", false)]);
    expect(rows.map((row) => row.id)).toEqual(["zai", "anthropic"]);
  });

  it("appends any other configured provider after the defaults", () => {
    const rows = accountProviderRows([
      provider("deepseek", true),
      provider("anthropic", true),
      provider("zai", false),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["zai", "anthropic", "deepseek"]);
  });

  it("hides an unconfigured provider outside the default set", () => {
    const rows = accountProviderRows([provider("deepseek", false), provider("anthropic", false)]);
    expect(rows.map((row) => row.id)).toEqual(["anthropic"]);
  });
});
