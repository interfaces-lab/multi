import * as stylex from "@stylexjs/stylex";
import { normalizePathSeparators } from "@honk/shared/paths";
import { Icon, IconButton, Spinner, Tooltip } from "@honk/ui";
import { IconSidebarSimpleRightWide } from "@honk/ui/icons";
import { controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { removeBrowserResource } from "./browser-store";
import { getHonkClient } from "./chat/client";
import { useWorkbench, workbenchActions } from "./workbench-controller";
import { useWorkbenchChangesSnapshot } from "./workbench-changes-resource";
import type { WorkbenchSessionRef } from "./workbench-frame";
import { workbenchLayout, workbenchToolHeaderLayout } from "./workbench-layout.stylex";
import { workbenchPanelLayout, workbenchPanelSize } from "./workbench-panel-layout.stylex";
import { workbenchPresentation } from "./workbench-presentation";
import { WorkbenchRail, type ChangeBadge } from "./workbench-rail";
import { useWorkbenchSizing } from "./workbench-sizing";
import {
  useWorkbenchTabs,
  workbenchTabActions,
  type WorkbenchTab as ManagedWorkbenchTab,
} from "./workbench-tab-store";
import type { WorkbenchToolKind } from "./workbench-tool-tabs";

const setWorkbenchRailMinimized = (isMinimized: boolean): void => {
  workbenchActions.setRailMinimized(isMinimized);
};

const disposeWorkbenchTerminal = (terminalID: string): void => {
  void import("./workbench-terminal")
    .then((module) => {
      module.disposeWorkbenchTerminal(terminalID);
    })
    .catch(() => undefined);
};

const DeferredWorkbenchPanelColumn = React.lazy(() =>
  import("./workbench-panel-column").then((module) => ({
    default: module.WorkbenchPanelColumn,
  })),
);

const styles = stylex.create({
  column: {
    position: "relative",
    flexShrink: 0,
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "row",
    boxSizing: "border-box",
  },
  // Maximized, the column takes the frame the thread column just vacated.
  columnMaximized: {
    flexGrow: 1,
    minWidth: 0,
  },
  chromeToggle: {
    position: "absolute",
    insetInlineEnd: spaceVars["--honk-space-panel-pad"],
    insetBlockStart: `calc((${workbenchLayout.headerHeight} - ${controlVars["--honk-control-h-sm"]}) / 2)`,
    zIndex: 2,
  },
  panelLoadingCenter: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
});

function WorkbenchPanelLoading(props: {
  readonly isMaximized: boolean;
  readonly panelWidth: number;
}): React.ReactElement {
  return (
    <div
      {...stylex.props(
        workbenchPanelLayout.panel,
        props.isMaximized
          ? workbenchPanelLayout.panelMaximized
          : workbenchPanelSize.width(props.panelWidth),
      )}
    >
      <div aria-hidden="true" {...stylex.props(workbenchToolHeaderLayout.root)} />
      <div {...stylex.props(workbenchPanelLayout.body)}>
        <div {...stylex.props(styles.panelLoadingCenter)}>
          <Spinner label="Loading workbench" tone="muted" />
        </div>
      </div>
    </div>
  );
}

type WorkbenchProps = {
  readonly sessionRef: WorkbenchSessionRef;
  readonly directory: string;
  readonly isThreadRunning: boolean;
};

function Workbench({ sessionRef, directory, isThreadRunning }: WorkbenchProps): React.ReactElement {
  // Tabs are shared per workspace: two chats in one workspace see one tab set,
  // and the session that opens a tool becomes its owner.
  const workspaceKey = sessionRef.workspaceId;
  const sessionId = sessionRef.sessionId;
  const workbenchState = useWorkbench((current) => current);
  const { isRailMinimized, width } = workbenchState;
  const workspaceTabs = useWorkbenchTabs(workspaceKey);
  // The tab badge counts uncommitted work, so it stays on the working tree no matter
  // which comparison the Changes panel itself is currently showing.
  const changesSnapshot = useWorkbenchChangesSnapshot(sessionRef, "git", isThreadRunning);
  const {
    attachColumn,
    availablePanelWidth,
    handleSashKeyDown,
    handleSashPointerDown,
    handleSashPointerEnd,
    handleSashPointerMove,
    isResizing,
    isResponsiveCompact,
    panelWidth,
  } = useWorkbenchSizing(width);
  const managedTabs = workspaceTabs.tabs;
  const presentation = workbenchPresentation({
    activeTabID: workspaceTabs.activeTabID,
    expanded: workspaceTabs.expanded,
    managedTabs,
  });
  const {
    activeTab,
    headerMenuItems,
    headerTabs,
    isOpen,
    openTabs,
    tabLabels,
    terminalCount,
    toolTabs,
  } = presentation;
  const isCompact = isResponsiveCompact || isRailMinimized;
  // A persisted maximized preference is inert until a panel is actually on screen, so a stale
  // `true` from a previous session never changes what boots.
  const isMaximized = workbenchState.isMaximized && isOpen;
  const changeBadge =
    changesSnapshot.phase === "ready"
      ? changesSnapshot.files.reduce<ChangeBadge>(
          (totals, file) => ({
            additions: totals.additions + file.additions,
            deletions: totals.deletions + file.deletions,
          }),
          { additions: 0, deletions: 0 },
        )
      : undefined;

  const activateTab = (tab: ManagedWorkbenchTab): void => {
    workbenchTabActions.activate(workspaceKey, tab.id);
    // `lastTab` reopens the workbench on a tool, and a file tab is not one: it names a path that
    // may no longer exist by the time the workbench is reopened.
    if (tab.kind !== "file") {
      workbenchActions.rememberTab(tab.kind);
    }
  };

  const openTool = (kind: WorkbenchToolKind, newInstance = false): void => {
    const tab = workbenchTabActions.openTool(workspaceKey, kind, sessionId, { newInstance });
    activateTab(tab);
  };

  const openFile = (path: string): void => {
    activateTab(workbenchTabActions.openFile(workspaceKey, path));
  };

  // Quick-open: core's capped substring search feeds the "+" popup's Files section.
  const searchFiles = async (query: string): Promise<readonly string[]> => {
    const client = getHonkClient();
    if (client === null) return [];
    const result = await client.files.find({ workspaceId: sessionRef.workspaceId, query });
    return result.entries.flatMap((entry) =>
      entry.kind === "directory" ? [] : [normalizePathSeparators(entry.path)],
    );
  };

  const collapseWorkbench = (): void => {
    // Closing the panel leaves nothing to maximize, so the preference goes with it.
    workbenchActions.setMaximized(false);
    workbenchTabActions.setExpanded(workspaceKey, false);
  };

  const expandWorkbench = (): void => {
    if (activeTab !== null) {
      activateTab(activeTab);
      return;
    }
    // No tab yet: the expanded empty state offers the tool buttons.
    workbenchTabActions.setExpanded(workspaceKey, true);
  };

  const closeTab = (tab: ManagedWorkbenchTab): void => {
    const wasActive = activeTab?.id === tab.id;
    const result = workbenchTabActions.close(workspaceKey, tab.id);
    if (tab.kind === "browser") removeBrowserResource(tab.owner, tab.browserID);
    if (result.closed?.kind === "terminal") {
      disposeWorkbenchTerminal(result.closed.terminalID);
    }
    if (!wasActive) return;
    const fallback = managedTabs.find((candidate) => candidate.id === result.activeTabID);
    if (fallback === undefined) {
      workbenchActions.setMaximized(false);
      workbenchTabActions.setExpanded(workspaceKey, false);
      return;
    }
    activateTab(fallback);
  };

  const openRailItems = openTabs.map(({ tab, icon }) => ({
    id: `open:${tab.id}`,
    label: tabLabels.get(tab.id) ?? tab.kind,
    icon,
    onOpen: () => {
      activateTab(tab);
    },
  }));
  const toolRailItems = toolTabs.map((entry) => {
    const label =
      entry.id === "terminal" && terminalCount > 0
        ? `${String(terminalCount)} ${terminalCount === 1 ? "Terminal" : "Terminals"}`
        : entry.label;
    return {
      id: `tool:${entry.id}`,
      label,
      icon: entry.icon,
      ...(entry.id === "changes" && changeBadge !== undefined ? { badge: changeBadge } : {}),
      onOpen: () => {
        openTool(entry.id);
      },
    };
  });
  const shouldMountPanel = isOpen || managedTabs.length > 0;

  return (
    <aside
      ref={attachColumn}
      aria-label="Workbench"
      {...stylex.props(styles.column, isMaximized && styles.columnMaximized)}
    >
      {shouldMountPanel ? (
        <React.Suspense
          fallback={<WorkbenchPanelLoading isMaximized={isMaximized} panelWidth={panelWidth} />}
        >
          <DeferredWorkbenchPanelColumn
            activeTabID={activeTab?.id ?? null}
            availablePanelWidth={availablePanelWidth}
            sessionRef={sessionRef}
            directory={directory}
            headerMenuItems={headerMenuItems}
            headerTabs={headerTabs}
            isMaximized={isMaximized}
            isOpen={isOpen}
            isResizing={isResizing}
            isThreadRunning={isThreadRunning}
            managedTabs={managedTabs}
            panelWidth={panelWidth}
            onActivateTab={(id) => {
              const tab = managedTabs.find((candidate) => candidate.id === id);
              if (tab !== undefined) activateTab(tab);
            }}
            onCloseTab={(id) => {
              const tab = managedTabs.find((candidate) => candidate.id === id);
              if (tab !== undefined) closeTab(tab);
            }}
            onCreateItem={(id) => {
              const entry = toolTabs.find((candidate) => `tool:${candidate.id}` === id);
              if (entry !== undefined) {
                openTool(entry.id, entry.id === "terminal" || entry.id === "browser");
              }
            }}
            onOpenFile={openFile}
            onSearchFiles={searchFiles}
            onToggleMaximized={() => {
              workbenchActions.toggleMaximized();
            }}
            onSashKeyDown={handleSashKeyDown}
            onSashPointerDown={handleSashPointerDown}
            onSashPointerEnd={handleSashPointerEnd}
            onSashPointerMove={handleSashPointerMove}
          />
        </React.Suspense>
      ) : null}
      <div {...stylex.props(styles.chromeToggle)}>
        <Tooltip label={isOpen ? "Collapse workbench" : "Open workbench"}>
          <IconButton
            type="button"
            aria-label={isOpen ? "Collapse workbench" : "Open workbench"}
            aria-pressed={isOpen}
            size="sm"
            variant="quiet"
            onClick={isOpen ? collapseWorkbench : expandWorkbench}
          >
            <Icon icon={IconSidebarSimpleRightWide} size="sm" />
          </IconButton>
        </Tooltip>
      </div>
      {!isOpen ? (
        <WorkbenchRail
          compact={isCompact}
          minimized={isRailMinimized}
          responsiveCompact={isResponsiveCompact}
          directory={directory}
          openItems={openRailItems}
          toolItems={toolRailItems}
          onMinimizedChange={setWorkbenchRailMinimized}
        />
      ) : null}
    </aside>
  );
}

export { Workbench };
export type { WorkbenchProps };
