import * as stylex from "@stylexjs/stylex";
import type { Git } from "@honk/core";
import { Checkbox, Icon, IconButton, Text } from "@honk/ui";
import {
  IconArrowRotateCounterClockwise,
  IconChevronDownMedium,
  IconChevronRightMedium,
  IconFolder1,
  IconFolderOpen,
} from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  fontVars,
  iconVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import { basename, normalizePathSeparators } from "@honk/shared/paths";
import * as React from "react";

// The upstream port drove @pierre/trees through a local Tree/useTreeModel wrapper
// plus Tailwind. Both are gone under the StyleX-only seam, and @pierre/trees renders
// its own preact DOM that StyleX cannot reach, so this is a first-party folder-grouped
// collapsible tree over the same Git.FileChange rows.

type FileNode = {
  readonly kind: "file";
  readonly name: string;
  readonly file: Git.FileChange;
};

type DirNode = {
  readonly kind: "dir";
  readonly name: string;
  readonly path: string;
  // Joined path segments after single-child compaction, e.g. [".agents", "skills"].
  readonly segments: readonly string[];
  readonly dirs: Map<string, DirNode>;
  readonly files: FileNode[];
};

type TreeNode = FileNode | DirNode;

// Per-file Git-action affordances shared with the card list: one include-set plus revert.
type FileRowActions = {
  readonly isIncluded: (path: string) => boolean;
  readonly onToggleInclude: (path: string) => void;
  readonly onRevert: (path: string) => void;
  readonly disabled: boolean;
};

function createDir(name: string, path: string): DirNode {
  return { kind: "dir", name, path, segments: [name], dirs: new Map(), files: [] };
}

function buildTree(files: readonly Git.FileChange[]): DirNode {
  const root = createDir("", "");
  for (const file of files) {
    const normalized = normalizePathSeparators(file.file);
    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;
    const name = segments.at(-1) ?? normalized;
    let dir = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] ?? "";
      const childPath = dir.path === "" ? segment : `${dir.path}/${segment}`;
      let child = dir.dirs.get(segment);
      if (child === undefined) {
        child = createDir(segment, childPath);
        dir.dirs.set(segment, child);
      }
      dir = child;
    }
    dir.files.push({ kind: "file", name, file });
  }
  return root;
}

// Merge a directory whose only child is a directory (and which has no files) upward,
// joining their segments so a `.agents/skills` chain renders as one row (Cursor buildCompactFileTree).
function collapseSingleChildDirs(dir: DirNode): DirNode {
  if (dir.files.length === 0 && dir.dirs.size === 1) {
    const [child] = dir.dirs.values();
    if (child !== undefined) {
      return collapseSingleChildDirs({ ...child, segments: [...dir.segments, ...child.segments] });
    }
  }
  const dirs = new Map<string, DirNode>();
  for (const [key, child] of dir.dirs) {
    dirs.set(key, collapseSingleChildDirs(child));
  }
  return { ...dir, dirs, name: dir.segments[0] ?? dir.name };
}

function sortedChildren(dir: DirNode): readonly TreeNode[] {
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const leaves = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...leaves];
}

function fileStatusGlyph(status: Git.ChangeStatus): "A" | "D" | "M" {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    padding: spaceVars["--honk-space-gutter"],
    fontFamily: fontVars["--honk-font-family-ui"],
  },
  row: {
    appearance: "none",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor --cursor-spacing-1 (4px) between row glyphs; --honk-control-gap is 6px
    gap: "4px",
    width: "100%",
    minWidth: 0,
    minHeight: controlVars["--honk-control-h-sm"],
    paddingInlineEnd: spaceVars["--honk-space-gutter"],
    paddingBlock: 0,
    borderStyle: "none",
    // Glass overrides --cursor-radius-base to 8px for these rows, not the 6px control radius.
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
      ":active": colorVars["--honk-color-state-press"],
    },
    textAlign: "start",
    userSelect: "none",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
  },
  rowSelected: {
    backgroundColor: {
      default: colorVars["--honk-color-control-selected"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-control-selected"] },
    },
  },
  fileRowWrap: {
    // Cursor reveals a file row's trailing actions only on hover or focus; the checkbox stays
    // persistent. Opacity (not display) keeps the revert button in the tab order for keyboard use.
    "--_row-actions-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
      // Touch devices never hover, so the actions stay permanently reachable there.
      "@media (hover: none)": "1",
    },
    // Opacity alone leaves an invisible button hit-testable; pointer-events tracks the reveal.
    "--_row-actions-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
      ":focus-within": "auto",
      "@media (hover: none)": "auto",
    },
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
    paddingInlineEnd: spaceVars["--honk-space-gutter"],
  },
  // The selected row keeps its revert action revealed even without hover or focus.
  fileRowWrapSelected: {
    "--_row-actions-opacity": "1",
    "--_row-actions-pointer-events": "auto",
  },
  // Cursor stacks the +N/-N counts and the revert action in one trailing cell so the counts
  // cross-fade into the action instead of the row reflowing when the action appears.
  statSwap: {
    display: "grid",
    justifyItems: "end",
    alignItems: "center",
    flexShrink: 0,
  },
  swapLayer: {
    gridArea: "1 / 1",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  swapStat: {
    opacity: "calc(1 - var(--_row-actions-opacity, 0))",
    // The counts are decorative text under the action layer; never let them eat its clicks.
    pointerEvents: "none",
  },
  swapAction: {
    opacity: "var(--_row-actions-opacity, 0)",
    pointerEvents: "var(--_row-actions-pointer-events, none)",
  },
  fileRowButton: {
    flexGrow: 1,
    width: "auto",
    paddingInlineEnd: 0,
  },
  indent: (depth: number) => ({
    paddingInlineStart: `calc(${spaceVars["--honk-space-gutter"]} + ${depth} * ${spaceVars["--honk-space-gutter"]})`,
  }),
  // Cursor pins the folder chevron in a fixed 20px slot with a 10px glyph; honk's
  // nearest icon token is xs (12px).
  disclosure: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: iconVars["--honk-icon-size-xl"],
    color: colorVars["--honk-color-text-faint"],
  },
  glyphSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    minWidth: iconVars["--honk-icon-size-sm"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: 1,
  },
  name: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  dirName: {
    color: colorVars["--honk-color-text-muted"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  stats: {
    display: "inline-flex",
    flexShrink: 0,
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor --cursor-spacing-1 (4px) separates +N and -N; --honk-space-gutter is 8px and no stats-gap token exists
    gap: "4px",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontVariantNumeric: "tabular-nums",
  },
  additions: {
    color: colorVars["--honk-color-diff-addition"],
  },
  deletions: {
    color: colorVars["--honk-color-diff-deletion"],
  },
  // Filename + trailing status glyph share one status color, drawn from Cursor's gitDecoration
  // ramp rather than the diff-count ramp above: --honk-color-diff-addition's dark stop (#3FA266)
  // is the +N count green and reads too saturated on a filename.
  statusAdded: {
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass gitDecoration.addedResourceForeground; no honk token carries this pair
    color: "light-dark(#007041, #70B489)",
  },
  statusModified: {
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass gitDecoration.modifiedResourceForeground; --honk-color-warn-fg's light stop (#8B5700) is a different amber
    color: "light-dark(#A46700, #F1B467)",
  },
  statusDeleted: {
    color: colorVars["--honk-color-diff-deletion"],
  },
  deletedName: {
    textDecorationLine: "line-through",
  },
  segmentSeparator: {
    color: colorVars["--honk-color-text-faint"],
  },
});

function statusColorStyle(status: Git.ChangeStatus) {
  if (status === "added") return styles.statusAdded;
  if (status === "deleted") return styles.statusDeleted;
  return styles.statusModified;
}

function FileRow({
  node,
  depth,
  isSelected,
  onSelect,
  actions,
}: {
  readonly node: FileNode;
  readonly depth: number;
  readonly isSelected: boolean;
  readonly onSelect: (path: string) => void;
  readonly actions: FileRowActions;
}): React.ReactElement {
  const { file } = node;
  const name = basename(node.name);
  return (
    <div
      // Checkbox, row button, and revert action are siblings (see the note at the counts below),
      // so the wrap's gaps and trailing pad belong to no control. The wrap owns the interactive
      // cursor for the whole row rather than flashing between its children.
      data-cursor-pointer-control=""
      {...stylex.props(
        styles.fileRowWrap,
        styles.indent(depth),
        isSelected && styles.fileRowWrapSelected,
      )}
    >
      <Checkbox
        size="sm"
        aria-label={`Include ${name} in Git action`}
        checked={actions.isIncluded(file.file)}
        disabled={actions.disabled}
        onCheckedChange={() => {
          actions.onToggleInclude(file.file);
        }}
      />
      <button
        type="button"
        data-canonical-control-exception="Git file-tree row: custom disclosure + selection composite; no @honk/ui tree primitive exists."
        aria-current={isSelected ? "true" : undefined}
        {...stylex.props(styles.row, styles.fileRowButton, isSelected && styles.rowSelected)}
        onClick={() => {
          onSelect(file.file);
        }}
      >
        <span
          {...stylex.props(
            styles.name,
            statusColorStyle(file.status),
            file.status === "deleted" && styles.deletedName,
          )}
        >
          {name}
        </span>
        <span
          aria-label={file.status}
          title={file.status}
          {...stylex.props(styles.glyphSlot, statusColorStyle(file.status))}
        >
          {fileStatusGlyph(file.status)}
        </span>
      </button>
      {/* The counts live outside the row button so they can share a grid cell with the revert
          action, which must not be a descendant of another control. */}
      <span {...stylex.props(styles.statSwap)}>
        <span {...stylex.props(styles.stats, styles.swapLayer, styles.swapStat)}>
          {file.additions > 0 ? (
            <span {...stylex.props(styles.additions)}>+{file.additions}</span>
          ) : null}
          {file.deletions > 0 ? (
            <span {...stylex.props(styles.deletions)}>-{file.deletions}</span>
          ) : null}
        </span>
        <span {...stylex.props(styles.swapLayer, styles.swapAction)}>
          <IconButton
            size="sm"
            variant="quiet"
            aria-label={`Revert changes to ${name}`}
            disabled={actions.disabled}
            onClick={() => {
              actions.onRevert(file.file);
            }}
          >
            <Icon icon={IconArrowRotateCounterClockwise} size="sm" />
          </IconButton>
        </span>
      </span>
    </div>
  );
}

function DirRow({
  node,
  depth,
  isExpanded,
  onToggle,
}: {
  readonly node: DirNode;
  readonly depth: number;
  readonly isExpanded: boolean;
  readonly onToggle: (path: string) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-canonical-control-exception="Git file-tree folder row: custom disclosure composite; no @honk/ui tree primitive exists."
      aria-expanded={isExpanded}
      {...stylex.props(styles.row, styles.indent(depth))}
      onClick={() => {
        onToggle(node.path);
      }}
    >
      <span {...stylex.props(styles.disclosure)}>
        <Icon
          icon={isExpanded ? IconChevronDownMedium : IconChevronRightMedium}
          size="xs"
          tone="faint"
        />
      </span>
      <span {...stylex.props(styles.glyphSlot)}>
        <Icon icon={isExpanded ? IconFolderOpen : IconFolder1} size="sm" tone="muted" />
      </span>
      <span {...stylex.props(styles.name, styles.dirName)}>
        {node.segments.map((segment, index) => (
          <React.Fragment key={index}>
            {index > 0 ? <span {...stylex.props(styles.segmentSeparator)}> / </span> : null}
            {segment}
          </React.Fragment>
        ))}
      </span>
    </button>
  );
}

function renderNodes(
  nodes: readonly TreeNode[],
  depth: number,
  collapsed: ReadonlySet<string>,
  selectedPath: string | null,
  onSelect: (path: string) => void,
  onToggle: (path: string) => void,
  actions: FileRowActions,
): readonly React.ReactElement[] {
  const rows: React.ReactElement[] = [];
  for (const node of nodes) {
    if (node.kind === "file") {
      rows.push(
        <FileRow
          key={`f:${node.file.file}`}
          node={node}
          depth={depth}
          isSelected={selectedPath === node.file.file}
          onSelect={onSelect}
          actions={actions}
        />,
      );
      continue;
    }
    const isExpanded = !collapsed.has(node.path);
    rows.push(
      <DirRow
        key={`d:${node.path}`}
        node={node}
        depth={depth}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />,
    );
    if (isExpanded) {
      rows.push(
        ...renderNodes(
          sortedChildren(node),
          depth + 1,
          collapsed,
          selectedPath,
          onSelect,
          onToggle,
          actions,
        ),
      );
    }
  }
  return rows;
}

function WorkbenchChangesFileTree({
  files,
  selectedPath,
  onSelect,
  fileActions,
}: {
  readonly files: readonly Git.FileChange[];
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
  readonly fileActions: FileRowActions;
}): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());

  const toggle = (path: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const tree = buildTree(files);
  const roots = sortedChildren({
    ...tree,
    dirs: new Map(
      [...tree.dirs].map(([key, child]): [string, DirNode] => [
        key,
        collapseSingleChildDirs(child),
      ]),
    ),
  });

  return (
    <div data-honk-scrollport="" {...stylex.props(styles.root)}>
      {roots.length === 0 ? (
        <Text as="p" size="xs" tone="faint">
          No changed files.
        </Text>
      ) : (
        renderNodes(roots, 0, collapsed, selectedPath, onSelect, toggle, fileActions)
      )}
    </div>
  );
}

export { WorkbenchChangesFileTree };
