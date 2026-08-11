// The composer's one suggestion menu: `/` and `@` share this trigger,
// keyboard, and rendering path, as the composer surface contract requires.
// Rows come from `./prompt-menu-model`; this module only paints them.
//
// Rendering is deliberately dumb. It knows how a row looks, which glyph a
// kind carries, and which kinds earn a second panel — nothing about where the
// rows came from or what picking one does.

import * as stylex from "@stylexjs/stylex";
import { FileTypeIcon, Icon, Popover, type Glyph, type IconSize, type IconTone } from "@honk/ui";
import { IconBuildingBlocks, IconConsoleSimple, IconFolder1 } from "@honk/ui/icons";
import {
  colorVars,
  composerVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { promptMenuItemInteractionProps } from "./prompt-menu-interaction";

const MAX_EXPANDED_PATH_SEGMENTS = 4;
// Shared edge gutter with the menu/picker/combobox popups so every dropdown insets its
// rounded row highlight the same distance from the popup wall.
const PANEL_EDGE_PAD = controlVars["--honk-control-menu-pad"];
// Matches the gutter the composer's other floating surfaces leave against their anchor.
const MENU_GAP_PX = 8;

// A live rect the menu positions against: the caret's rect inside the composer textarea.
// `contextElement` gives the positioner a real node to hang scroll and resize listeners off, which
// a bare rect closure cannot supply. Identity must change whenever the rect moves — the positioner
// only recomputes when the anchor it was handed is a different object.
export type PromptMenuAnchor = {
  readonly getBoundingClientRect: () => DOMRect;
  readonly contextElement?: Element;
};

/**
 * What a row is, which decides its glyph, its preview, and what picking it
 * does. Exactly the four things Pi can act on: two mention kinds and its two
 * resource kinds.
 */
export type PromptMenuItemKind = "command" | "file" | "folder" | "skill";

export type PromptMenuItem = {
  readonly key: string;
  readonly title: string;
  readonly detail: string | null;
  /** Groups consecutive rows under one heading; absent means no heading. */
  readonly section?: string;
  /** Workspace-relative path, on the two kinds that name one. */
  readonly path?: string;
  readonly kind: PromptMenuItemKind;
};

const KIND_ICONS: Readonly<Record<Exclude<PromptMenuItemKind, "file">, Glyph>> = {
  command: IconConsoleSimple,
  folder: IconFolder1,
  skill: IconBuildingBlocks,
};

export function PromptMenuItemIcon({
  item,
  size = "md",
  tone,
}: {
  readonly item: PromptMenuItem;
  readonly size?: IconSize;
  readonly tone?: IconTone;
}): React.ReactElement {
  // A file gets its own type glyph rather than a generic one, which is what
  // makes a long list of results scannable.
  if (item.kind === "file") {
    const path = item.path ?? item.key;
    return tone === undefined ? (
      <FileTypeIcon path={path} size={size} />
    ) : (
      <FileTypeIcon path={path} size={size} tone={tone} />
    );
  }
  return <Icon icon={KIND_ICONS[item.kind]} size={size} tone={tone ?? "muted"} />;
}

// Both surfaces ride @honk/ui Popover, which portals out of the composer's clipping ancestors and
// owns collision handling. These only restate the menu's own paint and its intrinsic box.
const PANEL_STYLE: React.CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  width: composerVars["--honk-composer-menu-width"],
  maxWidth: "var(--available-width)",
  maxHeight: `min(${composerVars["--honk-composer-menu-max-height"]}, var(--available-height))`,
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: PANEL_EDGE_PAD,
  borderRadius: radiusVars["--honk-radius-menu"],
};

const PREVIEW_STYLE: React.CSSProperties = {
  boxSizing: "border-box",
  width: composerVars["--honk-composer-menu-preview-width"],
  maxWidth: "var(--available-width)",
  maxHeight: `min(${composerVars["--honk-composer-menu-preview-max-height"]}, var(--available-height))`,
  overflow: "hidden",
  padding: controlVars["--honk-control-gap"],
  borderRadius: radiusVars["--honk-radius-menu"],
  // The preview is read-only chrome; keeping it inert stops a stray press from stealing the caret.
  pointerEvents: "none",
};

// Stay on the inline axis so the preview never lands on top of the list it describes.
const SAME_AXIS_ONLY: {
  readonly side: "flip";
  readonly align: "shift";
  readonly fallbackAxisSide: "none";
} = { side: "flip", align: "shift", fallbackAxisSide: "none" };

const styles = stylex.create({
  section: {
    boxSizing: "border-box",
    flexShrink: 0,
    height: controlVars["--honk-control-h-sm"],
    display: "flex",
    alignItems: "center",
    paddingInline: controlVars["--honk-control-pad-sm"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-caption"],
  },
  row: {
    appearance: "none",
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    flexShrink: 0,
    height: controlVars["--honk-control-h-sm"],
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingBlock: 0,
    paddingInline: controlVars["--honk-control-pad-sm"],
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
    },
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    textAlign: "start",
  },
  // A row grows to two lines only when it actually shows a detail; a command
  // row keeps its detail for the side panel and stays one line tall.
  rowWithDetail: {
    height: "auto",
    minHeight: controlVars["--honk-control-h-lg"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px block pad is the compact two-line row intrinsic
    paddingBlock: "4px",
  },
  rowSelected: {
    backgroundColor: {
      default: colorVars["--honk-color-control-selected"],
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-control-selected"],
      },
    },
  },
  rowText: { minWidth: 0, display: "flex", flexDirection: "column" },
  title: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  detail: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  empty: {
    minHeight: controlVars["--honk-control-h-lg"],
    display: "flex",
    alignItems: "center",
    paddingInline: controlVars["--honk-control-pad-sm"],
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  footer: {
    flexShrink: 0,
    minHeight: controlVars["--honk-control-h-sm"],
    display: "flex",
    alignItems: "center",
    paddingInline: controlVars["--honk-control-pad-sm"],
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-caption"],
  },
  previewTitle: {
    margin: 0,
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
  },
  previewBody: {
    marginBlockStart: spaceVars["--honk-space-gutter"],
    marginBlockEnd: 0,
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    whiteSpace: "pre-wrap",
  },
  staircase: { display: "flex", flexDirection: "column", minWidth: 0 },
  pathRow: {
    minWidth: 0,
    minHeight: controlVars["--honk-control-h-md"],
    display: "flex",
    alignItems: "stretch",
  },
  pathRail: {
    boxSizing: "border-box",
    flexShrink: 0,
    width: controlVars["--honk-control-pad-lg"],
    borderInlineStartWidth: controlVars["--honk-control-border-width"],
    borderInlineStartStyle: "solid",
    borderInlineStartColor: colorVars["--honk-color-border-muted"],
  },
  pathLabel: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  pathLabelLeaf: { color: colorVars["--honk-color-text-primary"] },
  pathText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

export function PromptMenuPathPreview({
  item,
}: {
  readonly item: PromptMenuItem;
}): React.ReactElement {
  const segments = (item.path ?? item.key).split(/[\\/]/).filter(Boolean);
  const isFile = item.kind === "file";
  const directorySegments = isFile ? segments.slice(0, -1) : segments;
  const collapsedCount = Math.max(0, directorySegments.length - MAX_EXPANDED_PATH_SEGMENTS);
  const rows = [
    ...(collapsedCount === 0
      ? []
      : [
          {
            key: "collapsed",
            label: directorySegments.slice(0, collapsedCount).join("/"),
            depth: 0,
            isLeaf: false,
            isFile: false,
          },
        ]),
    ...directorySegments.slice(collapsedCount).map((segment, index) => ({
      key: `directory:${String(index)}:${segment}`,
      label: segment,
      depth: index + (collapsedCount === 0 ? 0 : 1),
      isLeaf: !isFile && index === directorySegments.length - collapsedCount - 1,
      isFile: false,
    })),
    ...(isFile
      ? [
          {
            key: "file",
            label: segments.at(-1) ?? item.title,
            depth: directorySegments.length - collapsedCount + (collapsedCount === 0 ? 0 : 1),
            isLeaf: true,
            isFile: true,
          },
        ]
      : []),
  ];

  return (
    <div {...stylex.props(styles.staircase)}>
      {rows.map((row) => (
        <div key={row.key} {...stylex.props(styles.pathRow)}>
          {Array.from({ length: row.depth }, (_, index) => (
            <span key={index} aria-hidden="true" {...stylex.props(styles.pathRail)} />
          ))}
          <span {...stylex.props(styles.pathLabel, row.isLeaf && styles.pathLabelLeaf)}>
            {row.isFile ? (
              <PromptMenuItemIcon item={item} size="sm" />
            ) : (
              <Icon icon={IconFolder1} size="sm" tone={row.isLeaf ? "muted" : "faint"} />
            )}
            <span {...stylex.props(styles.pathText)}>{row.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Whether a row shows its detail inline or saves it for the side panel.
 *
 * Skills and commands hold a sentence of prose, which reads far better as a
 * paragraph beside the list than as a truncated second line inside it — and
 * keeping those rows one line tall is what lets a long `/` menu stay scannable.
 */
function showsDetail(item: PromptMenuItem): boolean {
  return item.detail !== null && item.kind !== "command" && item.kind !== "skill";
}

/**
 * The second panel's content, or null for a row that has nothing worth one.
 *
 * Null is also what closes the preview: a described-less command would open an
 * empty card, which reads as a rendering bug rather than as "nothing here".
 */
function previewContent(item: PromptMenuItem): React.ReactElement | null {
  if (item.kind === "file" || item.kind === "folder") {
    return <PromptMenuPathPreview key={item.path ?? item.key} item={item} />;
  }
  if (item.detail === null) return null;
  return (
    <>
      <h3 {...stylex.props(styles.previewTitle)}>{item.title}</h3>
      <p {...stylex.props(styles.previewBody)}>{item.detail}</p>
    </>
  );
}

export interface PromptMenuProps {
  readonly anchor: PromptMenuAnchor;
  readonly items: readonly PromptMenuItem[];
  readonly selectedIndex: number;
  readonly placement: "above" | "below";
  readonly emptyLabel: string;
  /** The truncation notice under the rows, when the search stopped early. */
  readonly footer?: string | undefined;
  readonly isLoading: boolean;
  readonly listboxId: string;
  readonly onSelect: (item: PromptMenuItem) => void;
  readonly onHighlight: (index: number) => void;
  readonly isKeyboardNavigation: boolean;
}

export function PromptMenu({
  anchor,
  items,
  selectedIndex,
  placement,
  emptyLabel,
  footer,
  isLoading,
  listboxId,
  onSelect,
  onHighlight,
  isKeyboardNavigation,
}: PromptMenuProps): React.ReactElement {
  const pointerDownItemKeyRef = React.useRef<string | null>(null);
  const panelElementRef = React.useRef<HTMLDivElement | null>(null);
  // Pair the node with the item it represents. Results can change before callback refs commit, and
  // a detached button is not an honest anchor for the next result's preview.
  const [previewAnchor, setPreviewAnchor] = React.useState<{
    readonly itemKey: string;
    readonly element: HTMLButtonElement;
  } | null>(null);
  const selected = items[selectedIndex];
  const selectedKey = selected?.key ?? null;
  const preview = selected === undefined ? null : previewContent(selected);
  const selectedElement =
    previewAnchor !== null &&
    previewAnchor.itemKey === selectedKey &&
    previewAnchor.element.isConnected
      ? previewAnchor.element
      : null;
  // React invokes a changed callback ref with null before attaching the replacement. The React
  // Compiler keeps this identity stable until its captured selection changes, so its state update
  // cannot render-loop.
  const trackSelectedRow = (element: HTMLButtonElement | null): void => {
    setPreviewAnchor((current) => {
      if (element === null || selectedKey === null) {
        return current?.itemKey === selectedKey ? null : current;
      }
      if (current?.itemKey === selectedKey && current.element === element) return current;
      return { itemKey: selectedKey, element };
    });
    const panel = panelElementRef.current;
    if (element === null || panel === null || !isKeyboardNavigation) return;
    if (element.offsetTop < panel.scrollTop) {
      panel.scrollTop = element.offsetTop;
      return;
    }
    if (element.offsetTop + element.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = element.offsetTop + element.offsetHeight - panel.clientHeight;
    }
  };
  return (
    <>
      <Popover.Root modal={false} open>
        <Popover.Popup
          ref={panelElementRef}
          id={listboxId}
          role="listbox"
          aria-label="Composer suggestions"
          aria-busy={isLoading}
          anchor={anchor}
          positionMethod="fixed"
          side={placement === "above" ? "top" : "bottom"}
          align="start"
          sideOffset={MENU_GAP_PX}
          collisionAvoidance={SAME_AXIS_ONLY}
          initialFocus={false}
          finalFocus={false}
          style={PANEL_STYLE}
        >
          {items.length === 0 ? (
            <div role="status" aria-live="polite" {...stylex.props(styles.empty)}>
              {emptyLabel}
            </div>
          ) : (
            <>
              {items.map((item, index) => {
                const previousSection = items[index - 1]?.section;
                return (
                  <React.Fragment key={item.key}>
                    {item.section !== undefined && item.section !== previousSection ? (
                      <div role="presentation" {...stylex.props(styles.section)}>
                        {item.section}
                      </div>
                    ) : null}
                    <button
                      id={`${listboxId}-option-${String(index)}`}
                      ref={index === selectedIndex ? trackSelectedRow : null}
                      type="button"
                      tabIndex={-1}
                      role="option"
                      aria-selected={index === selectedIndex}
                      data-canonical-control-exception="Composer suggestion row: focus remains in the textarea while this composite owns keyboard selection."
                      {...stylex.props(
                        styles.row,
                        showsDetail(item) && styles.rowWithDetail,
                        index === selectedIndex && styles.rowSelected,
                      )}
                      {...promptMenuItemInteractionProps(
                        item,
                        onSelect,
                        index === selectedIndex,
                        pointerDownItemKeyRef,
                      )}
                      onPointerMove={() => {
                        if (isKeyboardNavigation || index !== selectedIndex) onHighlight(index);
                      }}
                    >
                      <PromptMenuItemIcon item={item} />
                      <span {...stylex.props(styles.rowText)}>
                        <span {...stylex.props(styles.title)}>{item.title}</span>
                        {showsDetail(item) ? (
                          <span {...stylex.props(styles.detail)}>{item.detail}</span>
                        ) : null}
                      </span>
                    </button>
                  </React.Fragment>
                );
              })}
            </>
          )}
          {footer === undefined ? null : (
            <div role="status" aria-live="polite" {...stylex.props(styles.footer)}>
              {footer}
            </div>
          )}
        </Popover.Popup>
      </Popover.Root>
      {preview === null || selectedElement === null || selected === undefined ? null : (
        <Popover.Root modal={false} open>
          <Popover.Popup
            aria-label={`${selected.title} preview`}
            anchor={selectedElement}
            positionMethod="fixed"
            side="inline-end"
            align="start"
            sideOffset={MENU_GAP_PX}
            collisionAvoidance={SAME_AXIS_ONLY}
            initialFocus={false}
            finalFocus={false}
            style={PREVIEW_STYLE}
          >
            {preview}
          </Popover.Popup>
        </Popover.Root>
      )}
    </>
  );
}
