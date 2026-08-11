// Presentational only. Holds no tab state.
// Measure the strip with a ResizeObserver in a callback ref. Do not use useEffect for that.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import {
  IconChanges,
  IconCrossSmall,
  IconFolder1,
  IconGlobe,
  IconHomeRoofDoor,
  IconPlusSmall,
} from "./icons";
import { Matrix } from "./matrix";
import { StatusDot } from "./status-dot";
import { applyStyle, type HonkStyle } from "./style";
import type {
  TabDescriptor,
  TabStripProps,
  ThreadTabDescriptor,
  UtilityTabDescriptor,
} from "./tab-model";
import {
  INITIAL_SCROLL_METRICS,
  measureSlots,
  resolveTargetIndex,
  scrollMetricsEqual,
  scrollMetricsFrom,
  syncSlotRectsWithScroll,
  type DragSession,
  type ScrollMetrics,
} from "./tab-strip-geometry";
import {
  colorVars,
  controlVars,
  fontVars,
  iconVars,
  radiusVars,
  shellVars,
  spaceVars,
} from "./tokens.stylex";
import { Tooltip, TooltipProvider, type TooltipProps } from "./tooltip";

// Local tab geometry. Promote to tokens only when a second consumer needs the same sizes.
const AVATAR_STATUS_OFFSET = "-2px";
const SCROLL_FADE_SIZE = "24px";
const TAB_PREVIEW_MAX_WIDTH = "256px";
const TAB_SEPARATOR_WIDTH = "1.5px";
const TAB_SEPARATOR_HEIGHT = "12px";
// Scale the 20px matrix into the 16px slot without changing glyph geometry.
const MATRIX_FIT_SCALE = 0.8;
// Average thread slot width below this goes icon-only.
const COMPACT_MIN_SLOT_WIDTH = 64;
// Horizontal travel before pointerdown becomes a reorder drag.
const DRAG_ACTIVATION_DISTANCE = 4;
const DRAG_AUTOSCROLL_EDGE = 32;
const DRAG_AUTOSCROLL_MAX_STEP = 12;
// Deliberate pause so scrubbing tabs does not flash previews; matches the preview-card open delay.
const TAB_TOOLTIP_OPEN_DELAY_MS = 400;
const TAB_TOOLTIP_SKIP_WINDOW_MS = 500;

const stripStyles = stylex.create({
  strip: {
    display: "flex",
    alignItems: "center",
    // Home and + sit outside the thread scroller. Use the control gap here. threadList owns separator lanes.
    gap: controlVars["--honk-control-gap"],
    height: shellVars["--honk-shell-tab-h"],
    minWidth: 0,
    userSelect: "none",
  },
  threadList: {
    display: "flex",
    alignItems: "center",
    gap: shellVars["--honk-shell-tab-gap"],
    width: "100%",
    minWidth: 0,
    overflowX: "auto",
    overflowY: "hidden",
    overscrollBehaviorInline: "contain",
    scrollbarWidth: "none",
  },
  threadViewport: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    overflow: "hidden",
  },
  fadeInlineStart: {
    maskImage: `linear-gradient(to right, transparent, currentColor ${SCROLL_FADE_SIZE})`,
  },
  fadeInlineEnd: {
    maskImage: `linear-gradient(to left, transparent, currentColor ${SCROLL_FADE_SIZE})`,
  },
  fadeBoth: {
    maskImage: `linear-gradient(to right, transparent, currentColor ${SCROLL_FADE_SIZE}, currentColor calc(100% - ${SCROLL_FADE_SIZE}), transparent)`,
  },
  // Separator pills are JS children. Zero-width lanes with negative half-gap margins keep tab spacing stable when pills appear or disappear.
  separatorLane: {
    width: 0,
    marginInline: `calc(${shellVars["--honk-shell-tab-gap"]} * -0.5)`,
    alignSelf: "stretch",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    pointerEvents: "none",
  },
  separator: {
    width: TAB_SEPARATOR_WIDTH,
    height: TAB_SEPARATOR_HEIGHT,
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-pill"],
    // Border vocabulary, not a surface fill, so the pill does not read as an active-tab layer.
    backgroundColor: colorVars["--honk-color-border-base"],
  },
  newButton: {
    width: shellVars["--honk-shell-tab-h"],
    height: shellVars["--honk-shell-tab-h"],
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    padding: 0,
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    // Titlebar chrome uses tab-hover. layer-01 is lighter than bg-deep on light themes and would hide the hover.
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-tab-hover"] },
    },
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    fontFamily: "inherit",
    lineHeight: 1,
  },
});

const tabStyles = stylex.create({
  // One private `--_tab-bg` drives the tab fill. `--_` means private and unthemed.
  base: {
    // Idle and hover use the chrome ladder. Active switches to accent so selection is not another gray hover.
    "--_tab-bg": {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-tab-hover"] },
    },
    // Children read the private reveal state without requiring a descendant selector.
    "--_reveal": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
    },
    "--_close-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
    },
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    height: shellVars["--honk-shell-tab-h"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: "var(--_tab-bg)",
    overflow: "hidden",
  },
  thread: {
    width: shellVars["--honk-shell-tab-max-w"],
    minWidth: shellVars["--honk-shell-tab-min-w"],
    flexShrink: 1,
    // oxlint-disable-next-line honk/design-no-raw-values -- thread tab inline padding is a fixed 6px; no control padding token equals 6px
    paddingInline: "6px",
    // Touch scrolls the strip. Reorder stays mouse and pen only.
    touchAction: "pan-x",
  },
  home: {
    width: "auto",
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    // Home never collapses. Thread tabs absorb squeeze.
    flexShrink: 0,
  },
  // Active is a JS pick because the strip already knows activeKey. data-active is a DOM contract only.
  active: {
    "--_tab-bg": colorVars["--honk-color-tab-hover"],
    // Active tabs always show close. That is the touch path to it.
    "--_reveal": "1",
    "--_close-pointer-events": "auto",
  },
  dragging: {
    zIndex: 1,
  },
  slot: {
    width: iconVars["--honk-icon-size-md"],
    height: iconVars["--honk-icon-size-md"],
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    position: "relative",
    overflow: "visible",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-body"],
  },
  title: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: "hidden",
    // Ellipsize rather than hard-clipping the final glyph.
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    // Match the icon/status slot so the title centers with its identity glyph.
    lineHeight: iconVars["--honk-icon-size-md"],
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
  },
  titleActive: {
    color: colorVars["--honk-color-text-primary"],
  },
  // The rename input replaces the title span in the same flex slot. Chrome text styling, no field chrome.
  renameInput: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    height: "100%",
    padding: 0,
    borderStyle: "none",
    // The tab itself is the editing surface. A focus ring inside a 28px tab would double-outline it.
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: colorVars["--honk-color-text-primary"],
    fontFamily: "inherit",
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  // The close button owns a fixed flex slot, so the title truncates before it instead of fading beneath it.
  close: {
    width: iconVars["--honk-icon-size-md"],
    height: "100%",
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    fontFamily: "inherit",
    lineHeight: 1,
    opacity: "var(--_reveal, 0)",
    pointerEvents: "var(--_close-pointer-events)",
  },
  // Compact tabs have no label to reserve space for, so close replaces the identity in the full tab slot.
  closeCompact: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },
  // Grid box, not inline. An inline wrapper baseline-seats the 20px matrix and breaks the 16px slot.
  statusWrap: {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    lineHeight: 0,
  },
  attention: {
    color: colorVars["--honk-color-warn-fg"],
  },
  avatar: {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    // oxlint-disable-next-line honk/design-no-raw-values -- 0.5px avatar ring is a sub-pixel hairline; no border token owns half-pixel widths
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    borderRadius: radiusVars["--honk-radius-avatar"],
    backgroundColor: colorVars["--honk-color-layer-03"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: 1,
    textTransform: "uppercase",
    fontVariantNumeric: "tabular-nums",
  },
});

// Plain objects for composed primitives. StyleX refs cannot cross the `style` prop.
const forward = {
  matrixFit: { transform: `scale(${MATRIX_FIT_SCALE})` },
  avatarStatus: {
    position: "absolute",
    insetBlockStart: AVATAR_STATUS_OFFSET,
    insetInlineEnd: AVATAR_STATUS_OFFSET,
  },
  unavailableIcon: { color: colorVars["--honk-color-text-faint"] },
  tabPreviewPopup: {
    boxSizing: "border-box",
    width: TAB_PREVIEW_MAX_WIDTH,
    maxWidth: TAB_PREVIEW_MAX_WIDTH,
    padding: spaceVars["--honk-space-panel-pad"],
    // Preview-card content in a tooltip popup. The tooltip's control radius is too tight for this surface.
    borderRadius: radiusVars["--honk-radius-window"],
    userSelect: "none",
  },
} satisfies Record<string, HonkStyle>;

const dynamic = stylex.create({
  // Runtime drag offset as a StyleX function style, not an inline style object.
  dragShift: (dx: number) => ({ transform: `translateX(${dx}px)` }),
});

const previewStyles = stylex.create({
  // The tooltip trigger must be a real element. Render-merging trigger props onto a composed
  // component (the context-menu wrapper) silently drops them and the preview never opens.
  trigger: {
    display: "flex",
    minWidth: 0,
  },
  root: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- preview card stacks text rows at a fixed 6px popup gap; no vertical spacing token owns it
    gap: "6px",
    width: "100%",
    fontVariantNumeric: "tabular-nums",
  },
  project: {
    overflowWrap: "anywhere",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    letterSpacing: fontVars["--honk-letter-spacing-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  title: {
    overflowWrap: "anywhere",
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
    letterSpacing: fontVars["--honk-letter-spacing-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  detail: {
    overflowWrap: "anywhere",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    letterSpacing: fontVars["--honk-letter-spacing-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  server: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    letterSpacing: fontVars["--honk-letter-spacing-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
});

function closestTab(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tab-key]") : null;
}

function closestClose(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tab-close]") : null;
}

function closestRenameInput(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tab-editing]") : null;
}

// Callback ref. Runs once on mount so the rename input opens focused with the title selected.
function seatRenameInput(element: HTMLInputElement | null): void {
  element?.focus();
  element?.select();
}

// Close pointerdown must not start a reorder. Stop it before the strip's delegated handler runs.
function stopPointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

function repositoryInitial(label: string): string {
  return Array.from(label.trim())[0] ?? "?";
}

// Abbreviate the server home to ~ for display. Functional consumers keep the raw path.
function previewPath(path: string, homePath: string | undefined): string {
  if (homePath === undefined || homePath.length === 0) {
    return path;
  }
  if (path === homePath) {
    return "~";
  }
  return path.startsWith(`${homePath}/`) ? `~${path.slice(homePath.length)}` : path;
}

function TabPreview({ tab }: { tab: TabDescriptor }): React.ReactElement {
  const project =
    tab.kind !== "home" && tab.repository.state === "ready" ? tab.repository.label : null;
  return (
    <span data-tab-preview="" {...stylex.props(previewStyles.root)}>
      {project === null ? null : <span {...stylex.props(previewStyles.project)}>{project}</span>}
      <span {...stylex.props(previewStyles.title)}>{tab.title}</span>
      {tab.kind !== "home" && tab.path !== undefined ? (
        <span {...stylex.props(previewStyles.detail)}>
          {previewPath(tab.path, tab.kind === "thread" ? tab.homePath : undefined)}
        </span>
      ) : null}
      {tab.kind !== "home" && tab.server !== undefined ? (
        <span {...stylex.props(previewStyles.server)}>{tab.server.label}</span>
      ) : null}
    </span>
  );
}

function threadStatusTone(status: ThreadTabDescriptor["status"]): "ok" | "err" | "draft" | null {
  switch (status) {
    case "done":
      return "ok";
    case "failed":
      return "err";
    case "draft":
      return "draft";
    case "idle":
    case "working":
    case "needs-you":
      return null;
  }
}

function ThreadIdentity({ tab }: { tab: ThreadTabDescriptor }): React.ReactElement {
  // Needs-you outranks busy or loading chrome so a blocked tab cannot look merely working.
  if (tab.status === "needs-you") {
    return (
      <span
        role="status"
        aria-label="Needs you"
        {...stylex.props(tabStyles.statusWrap, tabStyles.attention)}
      >
        <Matrix grid={5} variant="attention" style={forward.matrixFit} />
      </span>
    );
  }

  // Swap the avatar for the progress glyph while the repository loads or the thread is working.
  if (tab.repository.state === "loading" || tab.status === "working") {
    return (
      <span
        role="status"
        aria-label={tab.repository.state === "loading" ? "Loading repository" : "Working"}
        {...stylex.props(tabStyles.statusWrap)}
      >
        <Matrix grid={5} style={forward.matrixFit} />
      </span>
    );
  }

  const tone = threadStatusTone(tab.status);
  return (
    <>
      {tab.repository.state === "ready" ? (
        <span aria-hidden={true} {...stylex.props(tabStyles.avatar)}>
          {repositoryInitial(tab.repository.label)}
        </span>
      ) : (
        <Icon icon={IconFolder1} size="sm" tone="faint" style={forward.unavailableIcon} />
      )}
      {tone !== null ? (
        <StatusDot tone={tone} label={tab.status} style={forward.avatarStatus} />
      ) : null}
    </>
  );
}

function UtilityIdentity({ tab }: { tab: UtilityTabDescriptor }): React.ReactElement {
  return <Icon icon={tab.utility === "browser" ? IconGlobe : IconChanges} size="sm" tone="faint" />;
}

interface TabProps {
  tab: TabDescriptor;
  isActive: boolean;
  isCompact: boolean;
  dragOffset: number | null;
  onRename?: TabStripProps["onRename"];
  renderContextMenu?: TabStripProps["renderContextMenu"];
}

interface SessionTabPreviewTooltipProps {
  readonly tab: ThreadTabDescriptor;
  readonly disabled?: boolean;
  readonly side?: TooltipProps["side"];
  readonly align?: TooltipProps["align"];
  readonly sideOffset?: TooltipProps["sideOffset"];
  readonly children: React.ReactElement;
}

function SessionTabPreviewProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <TooltipProvider
      delay={TAB_TOOLTIP_OPEN_DELAY_MS}
      closeDelay={0}
      timeout={TAB_TOOLTIP_SKIP_WINDOW_MS}
    >
      {children}
    </TooltipProvider>
  );
}

function SessionTabPreviewTooltip({
  tab,
  disabled = false,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  children,
}: SessionTabPreviewTooltipProps): React.ReactElement {
  if (tab.status === "draft") {
    return children;
  }

  return (
    <Tooltip
      label={<TabPreview tab={tab} />}
      side={side}
      align={align}
      sideOffset={sideOffset}
      delay={TAB_TOOLTIP_OPEN_DELAY_MS}
      closeDelay={0}
      disabled={disabled}
      popupStyle={forward.tabPreviewPopup}
    >
      <div data-tab-preview-trigger="" {...stylex.props(previewStyles.trigger)}>
        {children}
      </div>
    </Tooltip>
  );
}

// Memo so only the dragged row re-renders on pointermove. Handlers live on the strip via data-tab-* attributes.
const Tab = ({ tab, isActive, isCompact, dragOffset, onRename, renderContextMenu }: TabProps) => {
  const isHome = tab.kind === "home";
  const [editing, setEditing] = React.useState(false);
  // Enter commits and unmount blurs in the same tick. The ref makes whichever fires second a no-op.
  const renameDoneRef = React.useRef(false);
  const canRename =
    onRename !== undefined && tab.kind === "thread" && tab.status !== "draft" && !isCompact;

  const startRename = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    renameDoneRef.current = false;
    setEditing(true);
  };

  const finishRename = (element: HTMLInputElement, save: boolean): void => {
    if (renameDoneRef.current) {
      return;
    }
    renameDoneRef.current = true;
    setEditing(false);
    const next = element.value.trim();
    if (save && next.length > 0 && next !== tab.title) {
      onRename?.(tab.key, next);
    }
  };

  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // The editor owns keystrokes. Shell hotkeys must not fire while a title is being typed.
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finishRename(event.currentTarget, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishRename(event.currentTarget, false);
    }
  };

  const seatActiveTab = React.useCallback(
    (element: HTMLDivElement | null): void => {
      if (element !== null && isActive && tab.kind !== "home") {
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    },
    [isActive, tab.kind],
  );

  const accessibleName =
    tab.kind !== "home"
      ? [
          tab.title,
          tab.repository.state === "ready" ? tab.repository.label : null,
          tab.server?.label ?? null,
        ]
          .filter((value): value is string => value !== null)
          .join(", ")
      : tab.title;
  const element = (
    <div
      ref={seatActiveTab}
      role="tab"
      aria-selected={isActive}
      aria-label={accessibleName}
      data-tab-key={tab.key}
      data-active={isActive ? "" : undefined}
      data-editing={editing ? "" : undefined}
      data-shell-no-drag=""
      {...stylex.props(
        tabStyles.base,
        isHome ? tabStyles.home : tabStyles.thread,
        isActive && tabStyles.active,
        dragOffset !== null && tabStyles.dragging,
        dragOffset !== null && dynamic.dragShift(dragOffset),
      )}
    >
      <span {...stylex.props(tabStyles.slot)}>
        {tab.kind === "home" ? (
          <Icon icon={IconHomeRoofDoor} size="sm" />
        ) : tab.kind === "utility" ? (
          <UtilityIdentity tab={tab} />
        ) : (
          <ThreadIdentity tab={tab} />
        )}
      </span>
      {!isHome &&
        (editing ? (
          <input
            type="text"
            data-tab-editing=""
            aria-label={`Rename ${tab.title}`}
            defaultValue={tab.title}
            ref={seatRenameInput}
            onKeyDown={handleRenameKeyDown}
            onBlur={(event) => {
              finishRename(event.currentTarget, true);
            }}
            {...stylex.props(tabStyles.renameInput)}
          />
        ) : (
          !isCompact && (
            <span
              data-tab-title=""
              onDoubleClick={canRename ? startRename : undefined}
              {...stylex.props(tabStyles.title, isActive && tabStyles.titleActive)}
            >
              {tab.title}
            </span>
          )
        ))}
      {!isHome && !editing && (
        <button
          type="button"
          aria-label={`Close ${tab.title}`}
          data-tab-close={tab.key}
          onPointerDown={stopPointerDown}
          {...stylex.props(tabStyles.close, isCompact && tabStyles.closeCompact)}
        >
          <Icon icon={IconCrossSmall} size="xs" />
        </button>
      )}
    </div>
  );
  const contextMenuElement = renderContextMenu?.(tab, element) ?? element;

  if (tab.kind !== "thread") {
    return contextMenuElement;
  }

  return (
    // No preview while dragging or renaming, and none before the session location resolves.
    <SessionTabPreviewTooltip
      tab={tab}
      disabled={dragOffset !== null || editing || tab.path === undefined}
    >
      {contextMenuElement}
    </SessionTabPreviewTooltip>
  );
};

function TabStrip({
  tabs,
  activeKey,
  onActivate,
  onClose,
  onReorder,
  onNew,
  onRename,
  renderContextMenu,
  style,
}: TabStripProps): React.ReactElement {
  // ResizeObserver attaches in the scroller callback ref. Home and + sit outside that measured width.
  const stripElRef = React.useRef<HTMLDivElement | null>(null);
  const scrollElRef = React.useRef<HTMLDivElement | null>(null);
  const scrollObserverRef = React.useRef<ResizeObserver | null>(null);
  const scrollMutationObserverRef = React.useRef<MutationObserver | null>(null);
  const scrollMeasureRafRef = React.useRef(0);
  const autoScrollRafRef = React.useRef(0);
  const dragRenderRafRef = React.useRef(0);
  const dragPointerXRef = React.useRef(0);
  const sessionRef = React.useRef<DragSession | null>(null);
  const [drag, setDrag] = React.useState<{ fromIndex: number; dx: number } | null>(null);
  const [scrollMetrics, setScrollMetrics] = React.useState<ScrollMetrics>(INITIAL_SCROLL_METRICS);

  const publishScrollMetrics = (element: HTMLElement): void => {
    const next = scrollMetricsFrom(element);
    setScrollMetrics((previous) => (scrollMetricsEqual(previous, next) ? previous : next));
  };

  const attachStrip = (el: HTMLDivElement | null): void => {
    if (el === null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = 0;
      cancelAnimationFrame(dragRenderRafRef.current);
      dragRenderRafRef.current = 0;
      stripElRef.current = null;
      return;
    }
    stripElRef.current = el;
  };

  const cleanupThreadScroller = (): void => {
    cancelAnimationFrame(scrollMeasureRafRef.current);
    scrollMeasureRafRef.current = 0;
    scrollObserverRef.current?.disconnect();
    scrollObserverRef.current = null;
    scrollMutationObserverRef.current?.disconnect();
    scrollMutationObserverRef.current = null;
    scrollElRef.current = null;
  };

  const attachThreadScroller = (el: HTMLDivElement | null): (() => void) => {
    if (el === null) {
      cleanupThreadScroller();
      return cleanupThreadScroller;
    }
    scrollElRef.current = el;
    publishScrollMetrics(el);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(scrollMeasureRafRef.current);
      scrollMeasureRafRef.current = requestAnimationFrame(() => {
        scrollMeasureRafRef.current = 0;
        publishScrollMetrics(el);
      });
    });
    // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- React 19 runs the returned callback-ref teardown, which disconnects both observers below.
    observer.observe(el);
    scrollObserverRef.current = observer;
    const mutationObserver = new MutationObserver(() => {
      cancelAnimationFrame(scrollMeasureRafRef.current);
      scrollMeasureRafRef.current = requestAnimationFrame(() => {
        scrollMeasureRafRef.current = 0;
        publishScrollMetrics(el);
      });
    });
    mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });
    scrollMutationObserverRef.current = mutationObserver;
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      if (scrollElRef.current === el) {
        cancelAnimationFrame(scrollMeasureRafRef.current);
        scrollMeasureRafRef.current = 0;
        scrollObserverRef.current = null;
        scrollMutationObserverRef.current = null;
        scrollElRef.current = null;
      }
    };
  };

  // Derive compactness from the last measured width and current thread count. No stored flag, no effect.
  const threadCount = tabs.reduce((count, tab) => count + (tab.kind === "home" ? 0 : 1), 0);
  const isCompact =
    threadCount > 0 &&
    scrollMetrics.width > 0 &&
    scrollMetrics.width / threadCount < COMPACT_MIN_SLOT_WIDTH;

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    // Close pointerdown is stopped, but its mousedown still bubbles. Guard activate here too.
    if (closestClose(event.target) !== null) {
      return;
    }
    // Clicks inside the rename input place the caret. They never re-activate.
    if (closestRenameInput(event.target) !== null) {
      return;
    }
    const key = closestTab(event.target)?.dataset["tabKey"];
    if (key !== undefined) {
      // Activate on mousedown, like browsers, not on click.
      onActivate(key);
    }
  };

  const handleAuxClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 1) {
      return;
    }
    const key = closestTab(event.target)?.dataset["tabKey"];
    if (key === undefined) {
      return;
    }
    const tab = tabs.find((candidate) => candidate.key === key);
    if (tab === undefined || tab.kind === "home") {
      return;
    }
    event.preventDefault();
    onClose(key);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const key = closestClose(event.target)?.dataset["tabClose"];
    if (key !== undefined) {
      onClose(key);
    }
  };

  const dragOffsetFor = (session: DragSession, pointerX: number): number => {
    const scrollDelta = (scrollElRef.current?.scrollLeft ?? 0) - session.startScrollLeft;
    return pointerX - session.startX + scrollDelta;
  };

  const stopAutoScroll = (): void => {
    cancelAnimationFrame(autoScrollRafRef.current);
    autoScrollRafRef.current = 0;
  };

  const stopDragRender = (): void => {
    cancelAnimationFrame(dragRenderRafRef.current);
    dragRenderRafRef.current = 0;
  };

  const scheduleDragRender = (): void => {
    if (dragRenderRafRef.current !== 0) {
      return;
    }
    dragRenderRafRef.current = requestAnimationFrame(() => {
      dragRenderRafRef.current = 0;
      const session = sessionRef.current;
      if (session === null || !session.isDragging) {
        return;
      }
      setDrag({
        fromIndex: session.fromIndex,
        dx: dragOffsetFor(session, dragPointerXRef.current),
      });
    });
  };

  const scheduleAutoScroll = (): void => {
    if (autoScrollRafRef.current !== 0) {
      return;
    }
    autoScrollRafRef.current = requestAnimationFrame(() => {
      autoScrollRafRef.current = 0;
      const session = sessionRef.current;
      const scroller = scrollElRef.current;
      if (session === null || !session.isDragging || scroller === null) {
        return;
      }

      const rect = scroller.getBoundingClientRect();
      const pointerX = dragPointerXRef.current;
      let step = 0;
      if (pointerX < rect.left + DRAG_AUTOSCROLL_EDGE) {
        const pressure = Math.min(
          1,
          Math.max(0, (rect.left + DRAG_AUTOSCROLL_EDGE - pointerX) / DRAG_AUTOSCROLL_EDGE),
        );
        step = -Math.max(1, Math.round(DRAG_AUTOSCROLL_MAX_STEP * pressure));
      } else if (pointerX > rect.right - DRAG_AUTOSCROLL_EDGE) {
        const pressure = Math.min(
          1,
          Math.max(0, (pointerX - (rect.right - DRAG_AUTOSCROLL_EDGE)) / DRAG_AUTOSCROLL_EDGE),
        );
        step = Math.max(1, Math.round(DRAG_AUTOSCROLL_MAX_STEP * pressure));
      }
      if (step === 0) {
        return;
      }

      const before = scroller.scrollLeft;
      scroller.scrollLeft += step;
      if (scroller.scrollLeft === before) {
        return;
      }
      syncSlotRectsWithScroll(session, scroller.scrollLeft);
      publishScrollMetrics(scroller);
      setDrag({ fromIndex: session.fromIndex, dx: dragOffsetFor(session, pointerX) });
      scheduleAutoScroll();
    });
  };

  const handleThreadScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    publishScrollMetrics(event.currentTarget);
    const session = sessionRef.current;
    if (session === null || !session.isDragging) {
      return;
    }
    syncSlotRectsWithScroll(session, event.currentTarget.scrollLeft);
    scheduleDragRender();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.pointerType === "touch") {
      return;
    }
    const tabEl = closestTab(event.target);
    if (tabEl === null) {
      return;
    }
    // Text selection inside the rename input must not become a reorder drag.
    if (tabEl.dataset["editing"] !== undefined) {
      return;
    }
    const key = tabEl.dataset["tabKey"];
    const fromIndex = tabs.findIndex((candidate) => candidate.key === key);
    const tab = fromIndex === -1 ? undefined : tabs[fromIndex];
    if (tab === undefined || tab.kind === "home") {
      return;
    }
    const scrollLeft = scrollElRef.current?.scrollLeft ?? 0;
    const scrollableFromIndex = tabs.findIndex((candidate) => candidate.kind !== "home");
    // Record origin only. Drag starts after DRAG_ACTIVATION_DISTANCE of travel.
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: scrollLeft,
      slotsScrollLeft: scrollLeft,
      scrollableFromIndex: Math.max(0, scrollableFromIndex),
      fromIndex,
      tabEl,
      isDragging: false,
      slots: null,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) {
      return;
    }
    dragPointerXRef.current = event.clientX;
    const dx = dragOffsetFor(session, event.clientX);
    if (!session.isDragging) {
      if (Math.abs(dx) < DRAG_ACTIVATION_DISTANCE) {
        return;
      }
      session.isDragging = true;
      // Capture so move and up keep targeting the tab after the pointer leaves the strip.
      session.tabEl.setPointerCapture(session.pointerId);
      session.slots = measureSlots(stripElRef.current);
      session.slotsScrollLeft = scrollElRef.current?.scrollLeft ?? session.slotsScrollLeft;
    }
    setDrag({ fromIndex: session.fromIndex, dx });
    scheduleAutoScroll();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) {
      return;
    }
    if (session.isDragging && session.slots !== null) {
      syncSlotRectsWithScroll(session, scrollElRef.current?.scrollLeft ?? session.slotsScrollLeft);
      // Home at index 0 stays fixed. Nothing may land before it.
      const minIndex = tabs[0]?.kind === "home" ? 1 : 0;
      const to = resolveTargetIndex(
        session.fromIndex,
        dragOffsetFor(session, event.clientX),
        session.slots,
        minIndex,
      );
      if (to !== session.fromIndex) {
        onReorder(session.fromIndex, to);
      }
    }
    stopAutoScroll();
    stopDragRender();
    if (session.tabEl.hasPointerCapture(session.pointerId)) {
      session.tabEl.releasePointerCapture(session.pointerId);
    }
    sessionRef.current = null;
    setDrag(null);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) {
      return;
    }
    stopAutoScroll();
    stopDragRender();
    if (session.tabEl.hasPointerCapture(session.pointerId)) {
      session.tabEl.releasePointerCapture(session.pointerId);
    }
    sessionRef.current = null;
    setDrag(null);
  };

  // Insert a separator between thread neighbors unless either neighbor is active.
  const threadChildren: React.ReactNode[] = [];
  let homeTab: React.ReactNode = null;
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (tab === undefined) {
      continue;
    }
    if (tab.kind === "home") {
      homeTab = (
        <Tab
          key={tab.key}
          tab={tab}
          isActive={tab.key === activeKey}
          isCompact={false}
          dragOffset={null}
          {...(renderContextMenu === undefined ? {} : { renderContextMenu })}
        />
      );
      continue;
    }
    if (index > 0 && tabs[index - 1]?.kind !== "home") {
      const isBesideActive = tabs[index - 1]?.key === activeKey || tab.key === activeKey;
      if (!isBesideActive) {
        threadChildren.push(
          <span
            key={`separator-${tab.key}`}
            aria-hidden={true}
            {...stylex.props(stripStyles.separatorLane)}
          >
            <span {...stylex.props(stripStyles.separator)} />
          </span>,
        );
      }
    }
    threadChildren.push(
      <Tab
        key={tab.key}
        tab={tab}
        isActive={tab.key === activeKey}
        isCompact={isCompact}
        dragOffset={drag !== null && drag.fromIndex === index ? drag.dx : null}
        {...(onRename === undefined ? {} : { onRename })}
        {...(renderContextMenu === undefined ? {} : { renderContextMenu })}
      />,
    );
  }

  const scrollFadeStyle =
    scrollMetrics.canScrollStart && scrollMetrics.canScrollEnd
      ? stripStyles.fadeBoth
      : scrollMetrics.canScrollStart
        ? stripStyles.fadeInlineStart
        : scrollMetrics.canScrollEnd
          ? stripStyles.fadeInlineEnd
          : null;

  return (
    <SessionTabPreviewProvider>
      <div
        role="tablist"
        aria-label="Tabs"
        ref={attachStrip}
        // Marks the window-drag region. App CSS owns -webkit-app-region. StyleX cannot express that cascade.
        data-shell-drag-region=""
        onMouseDown={handleMouseDown}
        onAuxClick={handleAuxClick}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        {...applyStyle(stylex.props(stripStyles.strip), style)}
      >
        {homeTab}
        <div data-shell-no-drag="" {...stylex.props(stripStyles.threadViewport)}>
          <div
            ref={attachThreadScroller}
            data-tab-scroll=""
            onScroll={handleThreadScroll}
            {...stylex.props(stripStyles.threadList, scrollFadeStyle)}
          >
            {threadChildren}
          </div>
        </div>
        <button
          type="button"
          aria-label="New thread"
          data-shell-no-drag=""
          onClick={onNew}
          {...stylex.props(stripStyles.newButton)}
        >
          <Icon icon={IconPlusSmall} size="sm" />
        </button>
      </div>
    </SessionTabPreviewProvider>
  );
}

export { SessionTabPreviewProvider, SessionTabPreviewTooltip, TabStrip };
export type { SessionTabPreviewTooltipProps };
export type { TabDescriptor, TabStripProps } from "./tab-model";
