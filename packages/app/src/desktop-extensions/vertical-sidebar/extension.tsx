// The vertical tab sidebar: a left pane that replaces the titlebar strip and
// lists every open tab grouped by workspace. This module is the whole eager
// cost of the feature. It registers the pane, owns the persisted cells and
// their decoders, and paints the traffic-light seat and placeholder rows while
// the rendered sidebar streams in behind a dynamic import.

import * as stylex from "@stylexjs/stylex";
import { Spinner, type TabDescriptor } from "@honk/ui";
import { colorVars, radiusVars, shellVars, sidebarVars } from "@honk/ui/tokens.stylex";
import { Option, Schema } from "effect";
import { lazy, Suspense, type ComponentType, type ReactElement } from "react";

import { defineHonkDesktopExtension, type HonkDesktopCell, type HonkDesktopTabs } from "../sdk";

const SIDEBAR_DEFAULT_SIZE = 232;
const SIDEBAR_MIN_SIZE = 184;
const SIDEBAR_MAX_SIZE = 360;

// Core projects one activity bit per session, so the filter offers the two
// statuses a tab can actually hold. done/failed/needs-you/draft wait for core.
export type StatusFilter = "working" | "idle";

export const STATUS_FILTER_OPTIONS: readonly {
  readonly value: StatusFilter;
  readonly label: string;
}[] = [
  { value: "working", label: "Working" },
  { value: "idle", label: "Idle" },
] satisfies readonly { readonly value: TabDescriptor["status"]; readonly label: string }[];

export type VerticalSidebarInput = {
  readonly tabs: HonkDesktopTabs;
  readonly collapsedGroups: HonkDesktopCell<readonly string[]>;
  readonly workspaceOrder: HonkDesktopCell<readonly string[]>;
  readonly workspacesOpen: HonkDesktopCell<boolean>;
  readonly threadFilters: HonkDesktopCell<readonly StatusFilter[]>;
};

const decodeStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String));
const decodeStatuses = Schema.decodeUnknownOption(
  Schema.Array(Schema.Literals(["working", "idle"])),
);

export const decodeStringList = (value: unknown): readonly string[] | undefined =>
  Option.getOrUndefined(
    Option.map(decodeStrings(value), (items) => Object.freeze([...new Set(items)])),
  );

export const decodeStatusFilters = (value: unknown): readonly StatusFilter[] | undefined =>
  Option.getOrUndefined(
    Option.map(decodeStatuses(value), (items) => Object.freeze([...new Set(items)])),
  );

export const verticalSidebarLayout = stylex.create({
  root: {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "transparent",
  },
  // Permanent traffic-light seat shared by the final view and its loading state.
  topBar: {
    height: shellVars["--honk-shell-titlebar-h"],
    flexShrink: 0,
    paddingTop: shellVars["--honk-shell-titlebar-seat"],
  },
  navigation: {
    position: "relative",
    minHeight: 0,
    flexGrow: 1,
    overflowY: "auto",
    paddingInline: sidebarVars["--honk-sidebar-gutter-inline"],
    paddingBlockStart: sidebarVars["--honk-sidebar-gutter-inline"],
    paddingBlockEnd: sidebarVars["--honk-sidebar-gutter-inline"],
  },
  navigationContent: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: sidebarVars["--honk-sidebar-section-gap"],
  },
  footer: {
    flexShrink: 0,
    paddingInline: sidebarVars["--honk-sidebar-gutter-inline"],
    paddingBlock: sidebarVars["--honk-sidebar-gutter-inline"],
  },
});

const PLACEHOLDER_ROWS: readonly string[] = ["home", "workspaces", "workspace", "thread"];

const loadingStyles = stylex.create({
  row: {
    minHeight: sidebarVars["--honk-sidebar-item-height"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  rowNarrow: {
    width: "72%",
  },
  center: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
});

function VerticalSidebarLoading(): ReactElement {
  return (
    <aside aria-label="Open tabs" {...stylex.props(verticalSidebarLayout.root)}>
      <div data-shell-drag-region="" {...stylex.props(verticalSidebarLayout.topBar)} />
      <nav aria-label="Loading open tabs" {...stylex.props(verticalSidebarLayout.navigation)}>
        <div aria-hidden="true" {...stylex.props(verticalSidebarLayout.navigationContent)}>
          {PLACEHOLDER_ROWS.map((row, index) => (
            <div
              key={row}
              {...stylex.props(loadingStyles.row, index > 1 && loadingStyles.rowNarrow)}
            />
          ))}
        </div>
        <div {...stylex.props(loadingStyles.center)}>
          <Spinner label="Loading open tabs" tone="muted" />
        </div>
      </nav>
      <div {...stylex.props(verticalSidebarLayout.footer)}>
        <div aria-hidden="true" {...stylex.props(loadingStyles.row)} />
      </div>
    </aside>
  );
}

interface VerticalSidebarViewModule {
  readonly VerticalSidebar: ComponentType<VerticalSidebarInput>;
}

let sharedViewModule: Promise<VerticalSidebarViewModule> | null = null;

function loadVerticalSidebarView(): Promise<VerticalSidebarViewModule> {
  if (sharedViewModule !== null) return sharedViewModule;
  sharedViewModule = import("./view").catch((error: unknown) => {
    sharedViewModule = null;
    throw error;
  });
  return sharedViewModule;
}

const DeferredVerticalSidebar = lazy(() =>
  loadVerticalSidebarView().then((module) => ({ default: module.VerticalSidebar })),
);

function VerticalSidebarSurface(input: VerticalSidebarInput): ReactElement {
  return (
    <Suspense fallback={<VerticalSidebarLoading />}>
      <DeferredVerticalSidebar {...input} />
    </Suspense>
  );
}

export const verticalSidebarExtension = defineHonkDesktopExtension({
  id: "honk.vertical-sidebar",
  name: "Honk vertical sidebar",
  version: "1.0.0",
  activate(honk) {
    const enabled = honk.state.boolean("enabled", false);
    const size = honk.state.number("size", SIDEBAR_DEFAULT_SIZE, {
      min: SIDEBAR_MIN_SIZE,
      max: SIDEBAR_MAX_SIZE,
    });
    const collapsedGroups = honk.state.value<readonly string[]>("collapsed-groups", {
      default: Object.freeze([]),
      decode: decodeStringList,
    });
    const workspaceOrder = honk.state.value<readonly string[]>("workspace-order", {
      default: Object.freeze([]),
      decode: decodeStringList,
    });
    const workspacesOpen = honk.state.boolean("workspaces-open", true);
    const threadFilters = honk.state.value<readonly StatusFilter[]>("thread-filters", {
      default: Object.freeze([]),
      decode: decodeStatusFilters,
    });

    if (enabled.get()) {
      void loadVerticalSidebarView().catch(() => undefined);
    }

    honk.desktop.titlebar.tabStrip({ id: "default-tabs", hidden: enabled });
    honk.desktop.panes.add({
      id: "tabs",
      side: "left",
      open: enabled,
      size,
      minSize: SIDEBAR_MIN_SIZE,
      maxSize: SIDEBAR_MAX_SIZE,
      render: () => (
        <VerticalSidebarSurface
          tabs={honk.desktop.tabs}
          collapsedGroups={collapsedGroups}
          workspaceOrder={workspaceOrder}
          workspacesOpen={workspacesOpen}
          threadFilters={threadFilters}
        />
      ),
    });
    honk.desktop.settings.toggle({
      id: "enabled",
      title: "Tab style",
      description: "Choose where open tabs are shown.",
      value: enabled,
      presentation: {
        kind: "tab-style",
        offLabel: "San Francisco",
        onLabel: "New York",
      },
    });
  },
});
