import { create, props } from "@stylexjs/stylex";
import {
  Icon,
  ListRow,
  Matrix,
  Menu,
  SessionTabPreviewProvider,
  SessionTabPreviewTooltip,
  StatusDot,
  type TabDescriptor,
} from "@honk/ui";
import {
  IconChanges,
  IconChevronRightMedium,
  IconCrossSmall,
  IconFilter2,
  IconFolder1,
  IconFolderOpen,
  IconGlobe,
  IconHomeRoofDoor,
  IconPlusSmall,
} from "@honk/ui/icons";
import {
  borderVars,
  colorVars,
  iconVars,
  motionVars,
  radiusVars,
  sidebarVars,
} from "@honk/ui/tokens.stylex";
import {
  useCallback,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react";

import { TabContextMenu } from "../../tab-context-menu";
import type { HonkDesktopCell, HonkDesktopTabs } from "../sdk";
import {
  STATUS_FILTER_OPTIONS,
  verticalSidebarLayout,
  type StatusFilter,
  type VerticalSidebarInput,
} from "./extension";
import {
  buildWorkspaceDrop,
  collapsedKeySet,
  filterWorkspaceGroups,
  groupWorkspaceTabs,
  groupHasPath,
  mergeWorkspaceOrder,
  scrollFadeEdges,
  statusLabel,
  statusTone,
  toggleCollapsedKey,
  toggleSessionCollapsedKey,
  type ScrollFadeEdges,
  type WorkspaceTabGroup,
} from "./model";

const DRAG_ACTIVATION_DISTANCE = 4;
const WORKSPACE_ORDER_CAP = 50;
const DROP_INDICATOR_OFFSET = `calc(${borderVars["--honk-border-hairline"]} * -1)`;
const CHEVRON_OPEN_TRANSFORM = "rotate(90deg)";
// Cursor's sidebar menus sit near-flush: `.ui-sidebar-menu { gap: 1px }`.
const SIDEBAR_LIST_GAP = "1px";
// Matches ListRow sm inline pad so absolute hover actions sit inside the row highlight.
const HOVER_ACTION_INLINE_END = sidebarVars["--honk-sidebar-row-padding-inline"];
// Cursor renders `<Sidebar.Content topFadeSize={18} bottomFadeSize={36}>`; each term collapses to
// 0 once that edge is reached, so the mask only reports scrollable content.
const SCROLL_FADE_TOP = "18px";
const SCROLL_FADE_BOTTOM = "36px";
// Cursor Glass 3.15.1 seats vertical tab previews 4px to the right of the owning row.
const VERTICAL_TAB_PREVIEW_SIDE_OFFSET = 4;
const NO_SCROLL_FADE: ScrollFadeEdges = { showTop: false, showBottom: false };

const TITLE_PRIMARY: CSSProperties = { color: colorVars["--honk-color-text-primary"] };
const TITLE_MUTED: CSSProperties = { color: colorVars["--honk-color-text-muted"] };
const TITLE_FAINT: CSSProperties = { color: colorVars["--honk-color-text-faint"] };

const styles = create({
  // Cursor masks the scroller instead of drawing a scrolled divider; `black` here is a mask
  // alpha, not a surface color.
  fadeTop: {
    maskImage: `linear-gradient(to bottom, transparent 0px, black ${SCROLL_FADE_TOP})`,
  },
  fadeBottom: {
    maskImage: `linear-gradient(to top, transparent 0px, black ${SCROLL_FADE_BOTTOM})`,
  },
  fadeBoth: {
    maskImage: `linear-gradient(to bottom, transparent 0px, black ${SCROLL_FADE_TOP}, black calc(100% - ${SCROLL_FADE_BOTTOM}), transparent 100%)`,
  },
  home: {
    flexShrink: 0,
  },
  workspaceCollection: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass row-list seam: 1px hairline gap between sidebar rows (.ui-sidebar-top-bar-icons gap:1px); no spacing token owns it
    gap: SIDEBAR_LIST_GAP,
  },
  collectionHeader: {
    // Cursor reveals the group-label chevron and actions at full strength; icon weight comes
    // from the tone token, never from a dimmed reveal.
    "--_row-action-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
      ":has([data-popup-open])": "1",
    },
    "--_row-action-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
      ":focus-within": "auto",
      ":has([data-popup-open])": "auto",
    },
    position: "relative",
    minWidth: 0,
  },
  fade: {
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  // Cursor animates every sidebar chevron's rotation over 200ms, separately from the opacity
  // reveal that uncovers it.
  glyphMotion: {
    display: "flex",
    transitionProperty: "transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-expand"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  // One trailing-action lane for every row kind: pinned to the row's inline end, revealed by the
  // owning row's hover/focus vars.
  rowAction: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: HOVER_ACTION_INLINE_END,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "var(--_row-action-opacity, 0)",
    pointerEvents: "var(--_row-action-pointer-events, none)",
  },
  rowActionPinned: {
    opacity: 1,
    pointerEvents: "auto",
  },
  actionSpacer: {
    display: "block",
    width: iconVars["--honk-icon-size-xl"],
    height: 0,
  },
  workspaceList: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass row-list seam: 1px hairline gap between sidebar rows (.ui-sidebar-top-bar-icons gap:1px); no spacing token owns it
    gap: SIDEBAR_LIST_GAP,
  },
  // Cursor closes each section with trailing padding rather than a list gap, so a section reads
  // as one block instead of another rung of a flat ladder while its hit box stays contiguous for
  // reorder drops.
  group: {
    position: "relative",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass row-list seam: 1px hairline gap between sidebar rows (.ui-sidebar-top-bar-icons gap:1px); no spacing token owns it
    gap: SIDEBAR_LIST_GAP,
    paddingBlockEnd: sidebarVars["--honk-sidebar-section-gap"],
  },
  workspaceRow: {
    "--_workspace-folder-opacity": {
      default: "1",
      ":hover": { "@media (hover: hover)": "0" },
      ":focus-within": "0",
    },
    "--_workspace-chevron-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
    },
    position: "relative",
    minWidth: 0,
  },
  workspaceGlyph: {
    position: "relative",
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
  },
  workspaceFolder: {
    position: "absolute",
    display: "flex",
    opacity: "var(--_workspace-folder-opacity, 1)",
  },
  workspaceChevron: {
    position: "absolute",
    display: "flex",
    opacity: "var(--_workspace-chevron-opacity, 0)",
  },
  workspaceChevronOpen: {
    transform: CHEVRON_OPEN_TRANSFORM,
  },
  // Cursor indents a project group's rows by one 8px step so the workspace header owns the
  // outer lane and its tabs read as children rather than siblings.
  groupTabs: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass row-list seam: 1px hairline gap between sidebar rows (.ui-sidebar-top-bar-icons gap:1px); no spacing token owns it
    gap: SIDEBAR_LIST_GAP,
    paddingInlineStart: sidebarVars["--honk-sidebar-gutter-inline"],
  },
  chevron: {
    display: "flex",
    opacity: "var(--_row-action-opacity, 0)",
  },
  chevronOpen: {
    transform: CHEVRON_OPEN_TRANSFORM,
  },
  row: {
    "--_row-action-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
    },
    "--_row-action-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
      ":focus-within": "auto",
    },
    position: "relative",
    width: "100%",
    minWidth: 0,
  },
  rowActive: {
    "--_row-action-opacity": "1",
    "--_row-action-pointer-events": "auto",
  },
  dragging: {
    opacity: 0.45,
  },
  // Cursor's section drop indicator is a hairline pill inset from the row edges, not a bar.
  dropIndicator: {
    "::before": {
      position: "absolute",
      insetInline: sidebarVars["--honk-sidebar-row-padding-inline"],
      zIndex: 1,
      height: borderVars["--honk-border-hairline"],
      borderRadius: radiusVars["--honk-radius-pill"],
      backgroundColor: colorVars["--honk-color-accent"],
      content: "",
      pointerEvents: "none",
    },
  },
  dropBefore: {
    "::before": {
      top: DROP_INDICATOR_OFFSET,
    },
  },
  dropAfter: {
    "::before": {
      bottom: DROP_INDICATOR_OFFSET,
    },
  },
  empty: {
    paddingInline: sidebarVars["--honk-sidebar-row-padding-inline"],
    paddingBlock: sidebarVars["--honk-sidebar-row-padding-block"],
    color: colorVars["--honk-color-text-faint"],
    fontSize: sidebarVars["--honk-sidebar-label-size"],
    lineHeight: sidebarVars["--honk-sidebar-label-leading"],
  },
});

// Scales the 20px matrix into the 16px leading slot without changing glyph geometry.
const MATRIX_FIT: CSSProperties = { transform: "scale(0.8)" };

type WorkspaceDragSession = {
  readonly pointerId: number;
  readonly sourceKey: string;
  readonly originY: number;
  readonly element: HTMLButtonElement;
  isDragging: boolean;
  anchorKey: string | null;
  dropAfter: boolean;
};

type WorkspaceDragVisual = {
  readonly sourceKey: string;
  readonly anchorKey: string | null;
  readonly dropAfter: boolean;
};

type RowMouseHandler = (event: MouseEvent<HTMLButtonElement>) => void;
type RowPointerHandler = (event: PointerEvent<HTMLButtonElement>) => void;

type TabRowHandlers = {
  readonly activate: RowMouseHandler;
  readonly close: RowMouseHandler;
  readonly create: RowMouseHandler;
};

type WorkspaceDragHandlers = {
  readonly pointerDown: RowPointerHandler;
  readonly pointerMove: RowPointerHandler;
  readonly pointerUp: RowPointerHandler;
  readonly pointerCancel: RowPointerHandler;
};

export function VerticalSidebar(input: VerticalSidebarInput): ReactElement {
  const snapshot = useTabs(input.tabs);
  const persistedCollapsedKeys = useCell(input.collapsedGroups);
  const rankedWorkspaceKeys = useCell(input.workspaceOrder);
  const isWorkspaceCollectionOpen = useCell(input.workspacesOpen);
  const threadFilters = useCell(input.threadFilters);
  const workspaceCollectionID = useId();
  const groups = groupWorkspaceTabs(snapshot.tabs);
  const orderedGroups = mergeWorkspaceOrder(groups, rankedWorkspaceKeys);
  const visibleGroups = filterWorkspaceGroups(orderedGroups, threadFilters);
  const suppressWorkspaceActivationKey = useRef<string | null>(null);
  const [ephemeralCollapsedKeys, setEphemeralCollapsedKeys] = useState<readonly string[]>([]);
  const dragSession = useRef<WorkspaceDragSession | null>(null);
  const [dragVisual, setDragVisual] = useState<WorkspaceDragVisual | null>(null);
  const [scrollFade, setScrollFade] = useState<ScrollFadeEdges>(NO_SCROLL_FADE);
  const collapsedKeys = collapsedKeySet(groups, persistedCollapsedKeys, ephemeralCollapsedKeys);
  // Handlers are rebuilt each render so they read the current groups directly; the only state
  // that must outlive a render is the pointer session, which lives in a ref.
  const toggleWorkspace = createCollapseToggle({
    cell: input.collapsedGroups,
    groups,
    setEphemeralKeys: setEphemeralCollapsedKeys,
    suppressActivationKey: suppressWorkspaceActivationKey,
  });
  const dragHandlers = createWorkspaceDragHandlers({
    cell: input.workspaceOrder,
    groups,
    rankedKeys: rankedWorkspaceKeys,
    session: dragSession,
    setVisual: setDragVisual,
    suppressActivationKey: suppressWorkspaceActivationKey,
  });
  const tabHandlers = createTabHandlers(input.tabs);
  const toggleCollection = (): void => {
    input.workspacesOpen.set((current) => !current);
  };
  // Callback ref, not an effect: the fade tracks a layout fact the DOM owns. Stable identity so
  // the observer is not torn down on every render. The scroller's own box rarely changes, so the
  // content column is observed too, it resizes whenever a group collapses or a tab opens.
  const attachScroller = useCallback((element: HTMLElement | null): (() => void) => {
    if (element === null) return () => {};
    publishScrollFade(element, setScrollFade);
    const observer = new ResizeObserver(() => publishScrollFade(element, setScrollFade));
    observer.observe(element);
    if (element.firstElementChild !== null) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <SessionTabPreviewProvider>
      <aside aria-label="Open tabs" {...props(verticalSidebarLayout.root)}>
        <div data-shell-drag-region="" {...props(verticalSidebarLayout.topBar)} />
        <nav
          aria-label="Open tabs"
          data-honk-scrollport
          ref={attachScroller}
          onScroll={(event) => publishScrollFade(event.currentTarget, setScrollFade)}
          {...props(verticalSidebarLayout.navigation, scrollFadeStyle(scrollFade))}
        >
          <div {...props(verticalSidebarLayout.navigationContent)}>
            <HomeTabRow
              tab={snapshot.tabs.find((tab) => tab.kind === "home")}
              activeKey={snapshot.activeKey}
              onActivate={tabHandlers.activate}
            />
            <WorkspaceCollection
              groups={visibleGroups}
              activeKey={snapshot.activeKey}
              collectionID={workspaceCollectionID}
              isOpen={isWorkspaceCollectionOpen}
              filters={threadFilters}
              collapsedKeys={collapsedKeys}
              drag={dragVisual}
              onToggleCollection={toggleCollection}
              onToggleWorkspace={toggleWorkspace}
              dragHandlers={dragHandlers}
              tabHandlers={tabHandlers}
              threadFilters={input.threadFilters}
            />
          </div>
        </nav>
        <div {...props(verticalSidebarLayout.footer)}>
          <ListRow size="sm" onClick={tabHandlers.create}>
            <ListRow.Slot>
              <Icon icon={IconPlusSmall} size="sm" tone="muted" />
            </ListRow.Slot>
            <ListRow.Title style={TITLE_MUTED}>New thread</ListRow.Title>
          </ListRow>
        </div>
      </aside>
    </SessionTabPreviewProvider>
  );
}

function HomeTabRow(input: {
  readonly tab: TabDescriptor | undefined;
  readonly activeKey: string;
  readonly onActivate: RowMouseHandler;
}): ReactElement | null {
  if (input.tab === undefined || input.tab.kind !== "home") return null;
  const isActive = input.activeKey === input.tab.key;
  return (
    <div {...props(styles.home)}>
      <TabContextMenu tab={input.tab}>
        <ListRow
          size="sm"
          data-honk-desktop-tab-key={input.tab.key}
          aria-current={isActive ? "page" : undefined}
          isSelected={isActive}
          onClick={input.onActivate}
        >
          <ListRow.Slot>
            <TabGlyph tab={input.tab} isActive={isActive} />
          </ListRow.Slot>
          <ListRow.Title style={isActive ? TITLE_PRIMARY : TITLE_MUTED}>
            {input.tab.title}
          </ListRow.Title>
        </ListRow>
      </TabContextMenu>
    </div>
  );
}

function WorkspaceCollection(input: {
  readonly groups: readonly WorkspaceTabGroup[];
  readonly activeKey: string;
  readonly collectionID: string;
  readonly isOpen: boolean;
  readonly filters: readonly StatusFilter[];
  readonly collapsedKeys: ReadonlySet<string>;
  readonly drag: WorkspaceDragVisual | null;
  readonly onToggleCollection: () => void;
  readonly onToggleWorkspace: RowMouseHandler;
  readonly dragHandlers: WorkspaceDragHandlers;
  readonly tabHandlers: TabRowHandlers;
  readonly threadFilters: HonkDesktopCell<readonly StatusFilter[]>;
}): ReactElement {
  const filtersActive = input.filters.length > 0;

  return (
    <section aria-label="Workspace tabs" {...props(styles.workspaceCollection)}>
      <div {...props(styles.collectionHeader)}>
        <ListRow
          size="sm"
          aria-expanded={input.isOpen}
          aria-controls={input.isOpen ? input.collectionID : undefined}
          onClick={input.onToggleCollection}
        >
          <ListRow.Title style={TITLE_FAINT}>Workspaces</ListRow.Title>
          <ListRow.Meta>
            <span {...props(styles.chevron, styles.fade)}>
              <span {...props(styles.glyphMotion, input.isOpen && styles.chevronOpen)}>
                <Icon icon={IconChevronRightMedium} size="xs" tone="faint" />
              </span>
            </span>
            <span aria-hidden {...props(styles.actionSpacer)} />
          </ListRow.Meta>
        </ListRow>
        <div {...props(styles.rowAction, styles.fade, filtersActive && styles.rowActionPinned)}>
          <Menu.Root>
            <Menu.Trigger
              render={
                <ListRow.Action
                  aria-label="Filter threads"
                  title="Filter threads"
                  isActive={filtersActive}
                />
              }
            >
              <Icon icon={IconFilter2} size="sm" />
            </Menu.Trigger>
            <Menu.Popup align="start" side="bottom">
              {STATUS_FILTER_OPTIONS.map((option) => (
                <Menu.CheckboxItem
                  key={option.value}
                  checked={input.filters.includes(option.value)}
                  onCheckedChange={() => toggleStatusFilter(input.threadFilters, option.value)}
                >
                  {option.label}
                </Menu.CheckboxItem>
              ))}
            </Menu.Popup>
          </Menu.Root>
        </div>
      </div>
      {input.isOpen ? (
        <div id={input.collectionID} {...props(styles.workspaceList)}>
          {input.groups.length === 0 ? (
            <div {...props(styles.empty)}>
              {filtersActive ? "No matching workspace tabs" : "No open workspace tabs"}
            </div>
          ) : (
            input.groups.map((group, index) => (
              <WorkspaceGroup
                key={group.key}
                group={group}
                activeKey={input.activeKey}
                panelID={`${input.collectionID}-${index}`}
                isOpen={!input.collapsedKeys.has(group.key)}
                isDragging={input.drag?.sourceKey === group.key}
                dropAfter={input.drag?.anchorKey === group.key ? input.drag.dropAfter : null}
                onToggleWorkspace={input.onToggleWorkspace}
                dragHandlers={input.dragHandlers}
                tabHandlers={input.tabHandlers}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function WorkspaceGroup(input: {
  readonly group: WorkspaceTabGroup;
  readonly activeKey: string;
  readonly panelID: string;
  readonly isOpen: boolean;
  readonly isDragging: boolean;
  readonly dropAfter: boolean | null;
  readonly onToggleWorkspace: RowMouseHandler;
  readonly dragHandlers: WorkspaceDragHandlers;
  readonly tabHandlers: TabRowHandlers;
}): ReactElement | null {
  if (input.group.tabs.length === 0) return null;
  const hasActiveTab = input.group.tabs.some((entry) => entry.tab.key === input.activeKey);

  return (
    <section
      aria-label={`${input.group.label} tabs`}
      data-honk-desktop-workspace-section-key={input.group.key}
      {...props(
        styles.group,
        input.isDragging && styles.dragging,
        input.dropAfter !== null && styles.dropIndicator,
        input.dropAfter === false && styles.dropBefore,
        input.dropAfter === true && styles.dropAfter,
      )}
    >
      <WorkspaceHeader
        group={input.group}
        panelID={input.panelID}
        isOpen={input.isOpen}
        hasActiveTab={hasActiveTab}
        onToggleWorkspace={input.onToggleWorkspace}
        dragHandlers={input.dragHandlers}
      />
      {input.isOpen ? (
        <div
          id={input.panelID}
          role="group"
          aria-label={`${input.group.label} open tabs`}
          {...props(styles.groupTabs)}
        >
          {input.group.tabs.map((entry) => (
            <TabRow
              key={entry.tab.key}
              tab={entry.tab}
              isActive={input.activeKey === entry.tab.key}
              onActivate={input.tabHandlers.activate}
              onClose={input.tabHandlers.close}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WorkspaceHeader(input: {
  readonly group: WorkspaceTabGroup;
  readonly panelID: string;
  readonly isOpen: boolean;
  readonly hasActiveTab: boolean;
  readonly onToggleWorkspace: RowMouseHandler;
  readonly dragHandlers: WorkspaceDragHandlers;
}): ReactElement {
  const tabCount = input.group.tabs.length;
  const accessibleLabel = `${input.group.label}, ${tabCount} open ${tabCount === 1 ? "tab" : "tabs"}`;
  // Cursor signals selection by promoting the row's foreground, glyph included, not by a
  // heavier fill.
  const glyphTone = input.hasActiveTab ? "current" : "faint";

  return (
    <div {...props(styles.workspaceRow)}>
      <ListRow
        size="sm"
        data-honk-desktop-workspace-drag-key={input.group.key}
        aria-label={accessibleLabel}
        aria-expanded={input.isOpen}
        aria-controls={input.isOpen ? input.panelID : undefined}
        title={input.group.path ?? input.group.label}
        onClick={input.onToggleWorkspace}
        onPointerDown={input.dragHandlers.pointerDown}
        onPointerMove={input.dragHandlers.pointerMove}
        onPointerUp={input.dragHandlers.pointerUp}
        onPointerCancel={input.dragHandlers.pointerCancel}
      >
        <ListRow.Slot>
          <span {...props(styles.workspaceGlyph)}>
            <span {...props(styles.workspaceFolder, styles.fade)}>
              <Icon icon={input.isOpen ? IconFolderOpen : IconFolder1} size="sm" tone={glyphTone} />
            </span>
            <span {...props(styles.workspaceChevron, styles.fade)}>
              <span {...props(styles.glyphMotion, input.isOpen && styles.workspaceChevronOpen)}>
                <Icon icon={IconChevronRightMedium} size="sm" tone={glyphTone} />
              </span>
            </span>
          </span>
        </ListRow.Slot>
        <ListRow.Content>
          <ListRow.Title style={input.hasActiveTab ? TITLE_PRIMARY : TITLE_MUTED}>
            {input.group.label}
          </ListRow.Title>
        </ListRow.Content>
        <ListRow.Meta>
          <span aria-hidden {...props(styles.actionSpacer)} />
        </ListRow.Meta>
      </ListRow>
    </div>
  );
}

function TabRow(input: {
  readonly tab: Exclude<TabDescriptor, { readonly kind: "home" }>;
  readonly isActive: boolean;
  readonly onActivate: RowMouseHandler;
  readonly onClose: RowMouseHandler;
}): ReactElement {
  const row = (
    <div {...props(styles.row, input.isActive && styles.rowActive)}>
      <ListRow
        size="sm"
        data-honk-desktop-tab-key={input.tab.key}
        aria-current={input.isActive ? "page" : undefined}
        title={input.tab.title}
        isSelected={input.isActive}
        onClick={input.onActivate}
      >
        <ListRow.Slot>
          <TabGlyph tab={input.tab} isActive={input.isActive} />
        </ListRow.Slot>
        <ListRow.Content>
          <ListRow.Title style={input.isActive ? TITLE_PRIMARY : TITLE_MUTED}>
            {input.tab.title}
          </ListRow.Title>
        </ListRow.Content>
        <ListRow.Meta>
          <span aria-hidden {...props(styles.actionSpacer)} />
        </ListRow.Meta>
      </ListRow>
      <span {...props(styles.rowAction, styles.fade)}>
        <ListRow.Action
          data-honk-desktop-tab-key={input.tab.key}
          aria-label={`Close ${input.tab.title}`}
          onClick={input.onClose}
        >
          <Icon icon={IconCrossSmall} size="xs" />
        </ListRow.Action>
      </span>
    </div>
  );
  const withContextMenu = <TabContextMenu tab={input.tab}>{row}</TabContextMenu>;
  if (input.tab.kind !== "thread") return withContextMenu;
  return (
    <SessionTabPreviewTooltip
      tab={input.tab}
      side="right"
      align="start"
      sideOffset={VERTICAL_TAB_PREVIEW_SIDE_OFFSET}
    >
      {withContextMenu}
    </SessionTabPreviewTooltip>
  );
}

function TabGlyph(input: {
  readonly tab: TabDescriptor;
  readonly isActive: boolean;
}): ReactElement {
  // Cursor promotes a selected row's icon from secondary to primary; the fill stays the same.
  const tone = input.isActive ? "current" : "muted";
  if (input.tab.kind === "home" && input.tab.status === "idle") {
    return <Icon icon={IconHomeRoofDoor} size="sm" tone={tone} />;
  }
  if (input.tab.kind === "utility") {
    const glyph = input.tab.utility === "browser" ? IconGlobe : IconChanges;
    return <Icon icon={glyph} size="sm" tone={tone} />;
  }
  if (input.tab.status === "needs-you") {
    return <Matrix grid={5} variant="attention" isActive style={MATRIX_FIT} />;
  }
  if (
    input.tab.status === "working" ||
    (input.tab.kind === "thread" && input.tab.repository.state === "loading")
  ) {
    return <Matrix grid={5} isActive style={MATRIX_FIT} />;
  }
  return <StatusDot tone={statusTone(input.tab.status)} label={statusLabel(input.tab.status)} />;
}

function useTabs(tabs: HonkDesktopTabs) {
  return useSyncExternalStore(
    (listener) => tabs.subscribe(listener),
    () => tabs.getSnapshot(),
    () => tabs.getSnapshot(),
  );
}

function useCell<T>(cell: HonkDesktopCell<T>): T {
  return useSyncExternalStore(
    (listener) => cell.subscribe(() => listener()),
    () => cell.get(),
    () => cell.get(),
  );
}

function createTabHandlers(tabs: HonkDesktopTabs): TabRowHandlers {
  return {
    activate: (event) => {
      const key = event.currentTarget.dataset.honkDesktopTabKey;
      if (key !== undefined) tabs.activate(key);
    },
    close: (event) => {
      const key = event.currentTarget.dataset.honkDesktopTabKey;
      if (key !== undefined) tabs.close(key);
    },
    create: () => {
      tabs.create();
    },
  };
}

function createCollapseToggle(input: {
  readonly cell: HonkDesktopCell<readonly string[]>;
  readonly groups: readonly WorkspaceTabGroup[];
  readonly setEphemeralKeys: (update: (current: readonly string[]) => readonly string[]) => void;
  readonly suppressActivationKey: { current: string | null };
}): RowMouseHandler {
  return (event) => {
    const key = event.currentTarget.dataset.honkDesktopWorkspaceDragKey;
    if (key === undefined) return;
    if (input.suppressActivationKey.current === key) {
      input.suppressActivationKey.current = null;
      return;
    }
    const group = input.groups.find((candidate) => candidate.key === key);
    if (group === undefined) return;
    if (!groupHasPath(group)) {
      input.setEphemeralKeys((current) => toggleSessionCollapsedKey(current, key, input.groups));
      return;
    }
    input.cell.set((current) =>
      toggleCollapsedKey(current, key, input.groups, WORKSPACE_ORDER_CAP),
    );
  };
}

function createWorkspaceDragHandlers(input: {
  readonly cell: HonkDesktopCell<readonly string[]>;
  readonly groups: readonly WorkspaceTabGroup[];
  readonly rankedKeys: readonly string[];
  readonly session: { current: WorkspaceDragSession | null };
  readonly setVisual: (visual: WorkspaceDragVisual | null) => void;
  readonly suppressActivationKey: { current: string | null };
}): WorkspaceDragHandlers {
  const finish = (event: PointerEvent<HTMLButtonElement>, isCancelled: boolean): void => {
    const session = input.session.current;
    if (session === null || session.pointerId !== event.pointerId) return;
    if (!isCancelled && session.isDragging) {
      if (session.anchorKey !== null) {
        input.cell.set(
          buildWorkspaceDrop({
            groups: input.groups,
            rankedKeys: input.rankedKeys,
            sourceKey: session.sourceKey,
            anchorKey: session.anchorKey,
            dropAfter: session.dropAfter,
            cap: WORKSPACE_ORDER_CAP,
          }),
        );
      }
      input.suppressActivationKey.current = session.sourceKey;
    }
    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId);
    }
    input.session.current = null;
    input.setVisual(null);
  };

  return {
    pointerDown: (event) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      const sourceKey = event.currentTarget.dataset.honkDesktopWorkspaceDragKey;
      if (sourceKey === undefined) return;
      input.session.current = {
        pointerId: event.pointerId,
        sourceKey,
        originY: event.clientY,
        element: event.currentTarget,
        isDragging: false,
        anchorKey: null,
        dropAfter: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    pointerMove: (event) => {
      const session = input.session.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      if (!session.isDragging) {
        if (Math.abs(event.clientY - session.originY) < DRAG_ACTIVATION_DISTANCE) return;
        session.isDragging = true;
      }
      event.preventDefault();
      const target =
        document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[data-honk-desktop-workspace-section-key]") ?? null;
      const anchorKey = target?.dataset.honkDesktopWorkspaceSectionKey;
      if (target === null || anchorKey === undefined || anchorKey === session.sourceKey) {
        session.anchorKey = null;
        input.setVisual({ sourceKey: session.sourceKey, anchorKey: null, dropAfter: false });
        return;
      }
      const bounds = target.getBoundingClientRect();
      session.anchorKey = anchorKey;
      session.dropAfter = event.clientY > bounds.top + bounds.height / 2;
      input.setVisual({ sourceKey: session.sourceKey, anchorKey, dropAfter: session.dropAfter });
    },
    pointerUp: (event) => finish(event, false),
    pointerCancel: (event) => finish(event, true),
  };
}

function publishScrollFade(
  element: HTMLElement,
  setEdges: (update: (current: ScrollFadeEdges) => ScrollFadeEdges) => void,
): void {
  const next = scrollFadeEdges(element);
  setEdges((current) =>
    current.showTop === next.showTop && current.showBottom === next.showBottom ? current : next,
  );
}

// Cursor's mask carries one term per scrollable edge; each collapses at its own edge.
function scrollFadeStyle(edges: ScrollFadeEdges) {
  if (edges.showTop && edges.showBottom) return styles.fadeBoth;
  if (edges.showTop) return styles.fadeTop;
  if (edges.showBottom) return styles.fadeBottom;
  return undefined;
}

function toggleStatusFilter(
  cell: HonkDesktopCell<readonly StatusFilter[]>,
  value: StatusFilter,
): void {
  cell.set((current) =>
    Object.freeze(
      current.includes(value) ? current.filter((filter) => filter !== value) : [...current, value],
    ),
  );
}
