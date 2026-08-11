import * as stylex from "@stylexjs/stylex";
import { Button, Icon } from "@honk/ui";
import { IconConsoleSimple, IconFileBend, IconGlobe } from "@honk/ui/icons";
import { colorVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { WORKBENCH_WIDTH_MIN } from "./workbench-controller";
import type { WorkbenchSessionRef } from "./workbench-frame";
import { workbenchPanelLayout, workbenchPanelSize } from "./workbench-panel-layout.stylex";
import { WorkbenchPanelSurface } from "./workbench-panel-surface";
import type { WorkbenchTab as ManagedWorkbenchTab } from "./workbench-tab-store";
import { WorkbenchToolHeader } from "./workbench-tool-header";
import type {
  WorkbenchToolHeaderMenuItem,
  WorkbenchToolHeaderTab,
} from "./workbench-tool-header-types";

const SASH_WIDTH = "5px";
const styles = stylex.create({
  sash: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: `calc(${SASH_WIDTH} / -2)`,
    width: SASH_WIDTH,
    cursor: "col-resize",
    zIndex: 1,
    backgroundColor: "transparent",
    touchAction: "none",
  },
  sashActive: { backgroundColor: colorVars["--honk-color-accent"], opacity: 0.4 },
  // Keep visited panels mounted so terminals and browser surfaces survive tab switches.
  panelHost: { flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  emptyState: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  hidden: { display: "none" },
});

type WorkbenchPanelColumnProps = {
  readonly activeTabID: string | null;
  readonly availablePanelWidth: number;
  readonly sessionRef: WorkbenchSessionRef;
  readonly directory: string;
  readonly headerMenuItems: readonly WorkbenchToolHeaderMenuItem[];
  readonly headerTabs: readonly WorkbenchToolHeaderTab[];
  readonly isMaximized: boolean;
  readonly isOpen: boolean;
  readonly isResizing: boolean;
  readonly isThreadRunning: boolean;
  readonly managedTabs: readonly ManagedWorkbenchTab[];
  readonly panelWidth: number;
  readonly onActivateTab: (id: string) => void;
  readonly onCloseTab: (id: string) => void;
  readonly onCreateItem: (id: string) => void;
  readonly onOpenFile: (path: string) => void;
  readonly onSearchFiles: (query: string) => Promise<readonly string[]>;
  readonly onToggleMaximized: () => void;
  readonly onSashKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly onSashPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onSashPointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onSashPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
};

function WorkbenchPanelColumn({
  activeTabID,
  availablePanelWidth,
  sessionRef,
  directory,
  headerMenuItems,
  headerTabs,
  isMaximized,
  isOpen,
  isResizing,
  isThreadRunning,
  managedTabs,
  panelWidth,
  onActivateTab,
  onCloseTab,
  onCreateItem,
  onOpenFile,
  onSearchFiles,
  onToggleMaximized,
  onSashKeyDown,
  onSashPointerDown,
  onSashPointerEnd,
  onSashPointerMove,
}: WorkbenchPanelColumnProps): React.ReactElement {
  return (
    <div
      {...stylex.props(
        workbenchPanelLayout.panel,
        isMaximized ? workbenchPanelLayout.panelMaximized : workbenchPanelSize.width(panelWidth),
        !isOpen && styles.hidden,
      )}
    >
      {/* A maximized panel owns the whole frame, so there is no boundary left to drag and no
          meaningful `aria-valuenow` to report. */}
      {isMaximized ? null : (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize workbench"
          aria-valuemin={WORKBENCH_WIDTH_MIN}
          aria-valuemax={availablePanelWidth}
          aria-valuenow={panelWidth}
          {...stylex.props(styles.sash, isResizing && styles.sashActive)}
          onKeyDown={onSashKeyDown}
          onPointerDown={onSashPointerDown}
          onPointerMove={onSashPointerMove}
          onPointerUp={onSashPointerEnd}
          onPointerCancel={onSashPointerEnd}
        />
      )}
      <WorkbenchToolHeader
        tabs={headerTabs}
        activeTabID={activeTabID ?? ""}
        isMaximized={isMaximized}
        menuItems={headerMenuItems}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onCreate={onCreateItem}
        onToggleMaximized={onToggleMaximized}
        onSearchFiles={onSearchFiles}
        onOpenFile={onOpenFile}
      />
      <div {...stylex.props(workbenchPanelLayout.body)}>
        {activeTabID === null ? (
          <div role="group" aria-label="Open a workbench tool" {...stylex.props(styles.emptyState)}>
            <Button size="lg" onClick={() => onCreateItem("tool:browser")}>
              <Icon icon={IconGlobe} size="sm" />
              Browser
            </Button>
            <Button size="lg" onClick={() => onCreateItem("tool:terminal")}>
              <Icon icon={IconConsoleSimple} size="sm" />
              Terminal
            </Button>
            <Button size="lg" onClick={() => onCreateItem("tool:files")}>
              <Icon icon={IconFileBend} size="sm" />
              File
            </Button>
          </div>
        ) : null}
        {managedTabs.map((tab) => {
          const visible = isOpen && activeTabID === tab.id;
          return (
            <div key={tab.id} {...stylex.props(styles.panelHost, !visible && styles.hidden)}>
              <WorkbenchPanelSurface
                tab={tab}
                sessionRef={sessionRef}
                directory={directory}
                isThreadRunning={isThreadRunning}
                isVisible={visible}
                onOpenFile={onOpenFile}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { WorkbenchPanelColumn };
export type { WorkbenchPanelColumnProps };
