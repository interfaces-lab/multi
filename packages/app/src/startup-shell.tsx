import { Shell } from "@honk/ui/shell";
import * as React from "react";

import { readAppearanceBlob, type ThemePreference } from "./appearance-blob";

const schemeStyles: Record<ThemePreference, React.CSSProperties> = {
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
};

const readStartupTheme = (): ThemePreference => readAppearanceBlob()?.theme ?? "system";

function StartupShell(): React.ReactElement {
  return (
    <Shell
      material={/^Mac/.test(navigator.platform) ? "glass" : "solid"}
      style={schemeStyles[readStartupTheme()]}
    >
      <Shell.TitleBar />
      <Shell.Stage>
        <Shell.Sheet />
      </Shell.Stage>
    </Shell>
  );
}

export { StartupShell };
