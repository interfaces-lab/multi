import type * as React from "react";

import type { PromptMenuProps } from "./prompt-menu";

interface PromptMenuModule {
  readonly PromptMenu: React.ComponentType<PromptMenuProps>;
}

let sharedPromptMenuModule: Promise<PromptMenuModule> | null = null;

function loadPromptMenu(): Promise<PromptMenuModule> {
  if (sharedPromptMenuModule !== null) return sharedPromptMenuModule;
  sharedPromptMenuModule = import("./prompt-menu").catch((error: unknown) => {
    sharedPromptMenuModule = null;
    throw error;
  });
  return sharedPromptMenuModule;
}

export { loadPromptMenu };
