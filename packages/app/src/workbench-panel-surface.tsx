import * as stylex from "@stylexjs/stylex";
import { basename } from "@honk/shared/paths";
import { Icon, Spinner, Text } from "@honk/ui";
import { IconChanges, IconChevronDownMedium } from "@honk/ui/icons";
import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { browserLayout } from "./browser-layout.stylex";
import { workbenchChangesLayout } from "./workbench-changes-layout.stylex";
import type { WorkbenchSessionRef } from "./workbench-frame";
import type { WorkbenchTab } from "./workbench-tab-store";
import { workbenchTerminalLayout } from "./workbench-terminal-layout.stylex";

const DeferredWorkbenchFiles = React.lazy(() =>
  import("./workbench-files").then((module) => ({ default: module.WorkbenchFiles })),
);
const DeferredWorkbenchChanges = React.lazy(() =>
  import("./workbench-changes").then((module) => ({ default: module.WorkbenchChanges })),
);
const DeferredBrowserSurface = React.lazy(() =>
  import("./browser").then((module) => ({ default: module.BrowserSurface })),
);
const DeferredWorkbenchTerminal = React.lazy(() =>
  import("./workbench-terminal").then((module) => ({ default: module.WorkbenchTerminal })),
);

// Permanent Files split geometry. These match workbench-files.tsx while keeping its data/UI module
// outside the startup graph.
const EXPLORER_MIN_WIDTH = "160px";
const EXPLORER_MAX_WIDTH = "240px";

const styles = stylex.create({
  filesRoot: {
    display: "flex",
    flexDirection: "row",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
  },
  filesExplorer: {
    flexShrink: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    width: "38%",
    minWidth: EXPLORER_MIN_WIDTH,
    maxWidth: EXPLORER_MAX_WIDTH,
    borderInlineEndWidth: borderVars["--honk-border-hairline"],
    borderInlineEndStyle: "solid",
    borderInlineEndColor: colorVars["--honk-color-border-muted"],
  },
  filesToolbar: {
    flexShrink: 0,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    height: controlVars["--honk-control-h-lg"],
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  filesToolbarName: {
    minWidth: 0,
    flexGrow: 1,
  },
  filesToolbarAction: {
    width: controlVars["--honk-control-h-sm"],
    height: controlVars["--honk-control-h-sm"],
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  filesEditor: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  filesCenter: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
  changesScopeLoading: {
    minWidth: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  browserControlLoading: {
    width: controlVars["--honk-control-h-sm"],
    height: controlVars["--honk-control-h-sm"],
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  browserLocationLoading: {
    height: controlVars["--honk-control-h-md"],
    minWidth: 0,
    flexGrow: 1,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  terminalLoading: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
});

function BrowserLoading(): React.ReactElement {
  return (
    <div {...stylex.props(browserLayout.root)}>
      <div aria-hidden="true" {...stylex.props(browserLayout.toolbar)}>
        <span {...stylex.props(styles.browserControlLoading)} />
        <span {...stylex.props(styles.browserControlLoading)} />
        <span {...stylex.props(styles.browserControlLoading)} />
        <span {...stylex.props(styles.browserLocationLoading)} />
        <span {...stylex.props(styles.browserControlLoading)} />
      </div>
      <div {...stylex.props(browserLayout.host)}>
        <div {...stylex.props(browserLayout.center)}>
          <Spinner label="Loading browser" tone="muted" />
        </div>
      </div>
    </div>
  );
}

function BrowserSurface(props: {
  readonly sessionId: Extract<WorkbenchTab, { readonly kind: "browser" }>["owner"];
  readonly directory: string;
  readonly resourceID: string;
  readonly isVisible: boolean;
}): React.ReactElement {
  return (
    <React.Suspense fallback={<BrowserLoading />}>
      <DeferredBrowserSurface {...props} />
    </React.Suspense>
  );
}

function WorkbenchTerminalLoading(): React.ReactElement {
  return (
    <div {...stylex.props(workbenchTerminalLayout.root)}>
      <div {...stylex.props(workbenchTerminalLayout.terminalArea)}>
        <div {...stylex.props(styles.terminalLoading)}>
          <Spinner label="Loading terminal" tone="muted" />
        </div>
      </div>
    </div>
  );
}

function WorkbenchTerminalSurface(props: {
  readonly cwd: string;
  readonly isVisible: boolean;
  readonly terminalID: string;
}): React.ReactElement {
  return (
    <React.Suspense fallback={<WorkbenchTerminalLoading />}>
      <DeferredWorkbenchTerminal {...props} />
    </React.Suspense>
  );
}

function WorkbenchChangesLoading(): React.ReactElement {
  return (
    <div {...stylex.props(workbenchChangesLayout.root)}>
      <div {...stylex.props(workbenchChangesLayout.toolbar)}>
        <span aria-hidden="true" {...stylex.props(styles.changesScopeLoading)}>
          <Icon icon={IconChanges} size="sm" />
          <span>Uncommitted</span>
          <Icon icon={IconChevronDownMedium} size="xs" />
        </span>
        <span {...stylex.props(workbenchChangesLayout.spacer)} />
      </div>
      <div {...stylex.props(workbenchChangesLayout.center)}>
        <Spinner label="Loading changes" tone="muted" />
      </div>
    </div>
  );
}

function WorkbenchChangesSurface(props: {
  readonly sessionRef: WorkbenchSessionRef;
  readonly directory: string;
  readonly isThreadRunning: boolean;
}): React.ReactElement {
  return (
    <React.Suspense fallback={<WorkbenchChangesLoading />}>
      <DeferredWorkbenchChanges {...props} />
    </React.Suspense>
  );
}

function WorkbenchFilesLoading(props: {
  readonly directory: string;
  readonly selectedPath: string | null;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.filesRoot)}>
      <section aria-label="Files explorer" {...stylex.props(styles.filesExplorer)}>
        <div {...stylex.props(styles.filesToolbar)}>
          <Text
            size="xs"
            tone="faint"
            family="mono"
            truncate
            title={props.directory}
            style={styles.filesToolbarName}
          >
            {basename(props.directory)}
          </Text>
          <span aria-hidden="true" {...stylex.props(styles.filesToolbarAction)} />
        </div>
        <div {...stylex.props(styles.filesCenter)}>
          <Spinner label="Loading files" tone="muted" />
        </div>
      </section>
      <section aria-label="File preview" {...stylex.props(styles.filesEditor)}>
        <div {...stylex.props(styles.filesToolbar)}>
          <Text size="xs" tone="faint">
            Editor
          </Text>
        </div>
        <div role="status" {...stylex.props(styles.filesCenter)}>
          <Text as="p" size="sm" tone="muted" weight="regular">
            {props.selectedPath === null ? "Loading files" : "Loading file"}
          </Text>
        </div>
      </section>
    </div>
  );
}

function WorkbenchFilesSurface(props: {
  readonly workspaceId: WorkbenchSessionRef["workspaceId"];
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly isVisible: boolean;
  readonly selectedPath: string | null;
  readonly onOpenFile: (path: string) => void;
}): React.ReactElement {
  return (
    <React.Suspense
      fallback={
        <WorkbenchFilesLoading directory={props.directory} selectedPath={props.selectedPath} />
      }
    >
      <DeferredWorkbenchFiles {...props} />
    </React.Suspense>
  );
}

function WorkbenchPanelSurface({
  tab,
  sessionRef,
  directory,
  isThreadRunning,
  isVisible,
  onOpenFile,
}: {
  readonly tab: WorkbenchTab;
  readonly sessionRef: WorkbenchSessionRef;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly isVisible: boolean;
  readonly onOpenFile: (path: string) => void;
}): React.ReactElement {
  if (tab.kind === "changes") {
    // The tab's owner is the session that opened it; the workspace frame is the
    // authority for which session the panel serves now.
    return (
      <WorkbenchChangesSurface
        sessionRef={sessionRef}
        directory={directory}
        isThreadRunning={isThreadRunning}
      />
    );
  }
  if (tab.kind === "files") {
    return (
      <WorkbenchFilesSurface
        workspaceId={sessionRef.workspaceId}
        directory={directory}
        isThreadRunning={isThreadRunning}
        isVisible={isVisible}
        selectedPath={null}
        onOpenFile={onOpenFile}
      />
    );
  }
  if (tab.kind === "file") {
    return (
      <WorkbenchFilesSurface
        workspaceId={sessionRef.workspaceId}
        directory={directory}
        isThreadRunning={isThreadRunning}
        isVisible={isVisible}
        selectedPath={tab.filePath}
        onOpenFile={onOpenFile}
      />
    );
  }
  if (tab.kind === "terminal") {
    return (
      <WorkbenchTerminalSurface cwd={directory} isVisible={isVisible} terminalID={tab.terminalID} />
    );
  }
  return (
    <BrowserSurface
      sessionId={tab.owner}
      directory={directory}
      resourceID={tab.browserID}
      isVisible={isVisible}
    />
  );
}

export { WorkbenchPanelSurface };
