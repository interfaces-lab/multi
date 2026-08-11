import { RouterProvider } from "@tanstack/react-router";
import * as React from "react";
import type { Root } from "react-dom/client";

// Importing the appearance store applies persisted --honk-* vars at module init
// (dials.ts bind-at-import), before the full application replaces the startup shell.
import { actions as appearanceActions } from "./appearance-store";
import { startHonkCore } from "./chat/client";
import { installDesktopBridge, subscribeDesktopMenuAction } from "./desktop-bridge";
import { installHonkDesktopExtensions } from "./desktop-extensions/runtime";
import { router } from "./router";
import { actions as settingsActions } from "./settings-store";
import { bindTabRouter } from "./tab-store";
import { installThreadNotifications } from "./thread-notifications";
import { installUpdatePill } from "./update-pill";

function installDevelopmentTools(): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const install = () => {
    void import("react-grab");
    const picker = document.createElement("script");
    picker.src = "https://ui.sh/ui-picker.js";
    picker.async = true;
    document.body.append(picker);
  };

  const requestIdle = window.requestIdleCallback;
  if (requestIdle !== undefined) {
    requestIdle(install, { timeout: 2_000 });
  } else {
    setTimeout(install, 0);
  }
}

async function startApp(root: Root): Promise<void> {
  installDesktopBridge();
  installHonkDesktopExtensions();
  subscribeDesktopMenuAction((action) => {
    if (action === "open-settings") settingsActions.open();
    if (action === "increase-font-sizes") appearanceActions.stepFontSizes(1);
    if (action === "decrease-font-sizes") appearanceActions.stepFontSizes(-1);
    if (action === "reset-font-sizes") appearanceActions.resetFontSizes();
  });

  installUpdatePill();
  installThreadNotifications();

  // Connecting here gives Home a core client by the time its composer paints.
  startHonkCore();

  // Before the first render, so the relaunch rule (persisted active tab beats
  // the Home URL) resolves ahead of the router's initial paint.
  bindTabRouter(router);

  // Route-owned lazy components retain the previous page during navigation.
  // A cold launch has no previous route, so keep StartupShell mounted until
  // the initial route and its component are ready to commit together.
  await router.load();

  root.render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
  installDevelopmentTools();
}

export { startApp };
