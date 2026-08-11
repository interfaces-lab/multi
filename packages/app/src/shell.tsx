// Shell mounts the one hotkey registry. Leaf routes do not bind shell chords.

import {
  FileTypeIconSprite,
  Icon,
  IconButton,
  Shell,
  TabStrip,
  Tooltip,
  TooltipProvider,
  type TabDescriptor,
} from "@honk/ui";
import { IconSettingsGear2 } from "@honk/ui/icons";
import { Outlet } from "@tanstack/react-router";
import * as React from "react";

import { useAppearanceTheme } from "./appearance-store";
import { useInventory } from "./chat/inventory-store";
import { shouldUseDesktopGlass } from "./desktop-bridge";
import { HonkDesktopExtensionLayout } from "./desktop-extensions/layout";
import { useIsHonkDesktopTabStripHidden } from "./desktop-extensions/runtime";
import { HonkDesktopTitlebarControls } from "./desktop-extensions/titlebar-controls";
import { DevChannelChip } from "./dev-channel-chip";
import { useShellHotkeys } from "./hotkeys";
import { DevelopmentPerformanceMonitor } from "./performance-monitor";
import { actions as settingsActions } from "./settings-store";
import { CommandMenuOverlayHost, SettingsOverlayHost } from "./shell-overlays";
import { HOME_TAB_KEY, tabDescriptors } from "./tab-presentation";
import { actions as tabActions, useTabState } from "./tab-store";
import { ToastViewportHost } from "./toast-host";
import { TitleBarTrailing } from "./update-pill";

const TabContextMenu = React.lazy(() =>
  import("./tab-context-menu").then((module) => ({ default: module.TabContextMenu })),
);

const schemeStyles: Record<string, React.CSSProperties> = {
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
};

function SettingsTriggerButton(): React.ReactElement {
  return (
    <Tooltip label="Settings">
      <IconButton
        data-shell-no-drag=""
        size="sm"
        variant="quiet"
        aria-label="Open settings"
        onClick={() => settingsActions.open()}
      >
        <Icon icon={IconSettingsGear2} size="sm" />
      </IconButton>
    </Tooltip>
  );
}

// The lazy boundary falls back to the bare tab element so tabs never blank
// while the context-menu chunk loads.
function renderTabContextMenu(
  tab: TabDescriptor,
  children: React.ReactElement,
): React.ReactElement {
  return (
    <React.Suspense fallback={children}>
      <TabContextMenu tab={tab}>{children}</TabContextMenu>
    </React.Suspense>
  );
}

function ShellTabStrip(): React.ReactElement | null {
  // Retains the inventory watch while the shell lives: the strip's activity
  // glyphs and the store's reconciliation both ride its frames. The watch is
  // held even when the vertical sidebar owns the tabs and the strip renders
  // nothing.
  const inventory = useInventory();
  const state = useTabState();
  const isHidden = useIsHonkDesktopTabStripHidden();
  const tabs = tabDescriptors(state, inventory.sessions);
  if (isHidden) return null;
  return (
    <TabStrip
      tabs={tabs}
      activeKey={state.activeId ?? HOME_TAB_KEY}
      onActivate={(key) => {
        tabActions.activate(key);
      }}
      onClose={(key) => {
        tabActions.close(key);
      }}
      onReorder={(from, to) => {
        tabActions.reorder(from, to);
      }}
      onNew={() => {
        tabActions.openNew();
      }}
      renderContextMenu={renderTabContextMenu}
    />
  );
}

function AppShell({
  isInteractive = true,
}: {
  readonly isInteractive?: boolean;
}): React.ReactElement {
  const theme = useAppearanceTheme();
  useShellHotkeys(undefined, isInteractive);

  const trailing = (
    <TitleBarTrailing>
      <HonkDesktopTitlebarControls />
      <SettingsTriggerButton />
      {import.meta.env.DEV ? <DevChannelChip /> : null}
    </TitleBarTrailing>
  );

  return (
    <TooltipProvider>
      <FileTypeIconSprite />
      <Shell material={shouldUseDesktopGlass() ? "glass" : "solid"} style={schemeStyles[theme]}>
        <HonkDesktopExtensionLayout>
          <Shell.TitleBar trailing={trailing}>
            <ShellTabStrip />
          </Shell.TitleBar>
          <Shell.Stage>
            <Shell.Sheet>
              <Outlet />
            </Shell.Sheet>
          </Shell.Stage>
        </HonkDesktopExtensionLayout>
        {import.meta.env.DEV ? <DevelopmentPerformanceMonitor /> : null}
        <SettingsOverlayHost />
        <CommandMenuOverlayHost />
        <ToastViewportHost />
      </Shell>
    </TooltipProvider>
  );
}

export { AppShell };
