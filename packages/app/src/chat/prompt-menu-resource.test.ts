import { describe, expect, it } from "vitest";

import { loadPromptMenu } from "./prompt-menu-resource";

describe("composer prompt menu resource", () => {
  // The real dynamic import compiles the menu's @honk/ui graph cold in this
  // worker, which can outrun the default 5s on a cache miss.
  it("reuses one menu import", { timeout: 30_000 }, async () => {
    const first = loadPromptMenu();
    const second = loadPromptMenu();

    expect(second).toBe(first);
    expect((await first).PromptMenu).toBeTypeOf("function");
  });
});
