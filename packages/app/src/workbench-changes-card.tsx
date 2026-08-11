import type { Git } from "@honk/core";
import type { Workspace } from "@honk/core/workspace";
import { basename, normalizePathSeparators } from "@honk/shared/paths";
import { Checkbox, Icon, IconButton, Spinner, Text } from "@honk/ui";
import {
  IconArrowRotateCounterClockwise,
  IconChevronDownMedium,
  IconChevronRightMedium,
  IconClipboard,
} from "@honk/ui/icons";
import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { PatchDiff } from "@pierre/diffs/react";
import * as React from "react";

import { buildDiffOptions } from "./lib/diff-rendering";
import { useTruncatedPath } from "./lib/truncate-text";
import { WorkbenchChangesImage } from "./workbench-changes-image";
import { isImagePreviewPath } from "./workbench-changes-image-resource";

// Font-relative width keeps the status glyph slot aligned with surrounding text.
const STATUS_GLYPH_SLOT_WIDTH = "1em";

const styles = stylex.create({
  root: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    borderBlockEndWidth: borderVars["--honk-border-hairline"],
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colorVars["--honk-color-border-muted"],
  },
  rootViewed: {
    opacity: 0.55,
  },
  header: {
    // Cursor hides the trailing action cluster (revert/copy) until the row is hovered or
    // holds focus; checkboxes stay persistent. Opacity (not display) keeps the buttons in the
    // tab order so :focus-within can reveal them for keyboard users.
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
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minHeight: controlVars["--honk-control-h-sm"],
    paddingBlock: 0,
    paddingInline: controlVars["--honk-control-gap"],
    userSelect: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--honk-color-state-hover"],
    },
    borderRadius: radiusVars["--honk-radius-control"],
  },
  headerButton: {
    appearance: "none",
    display: "flex",
    flexGrow: 1,
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    textAlign: "start",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
  },
  // Selection sync with the tree: the active card keeps the selected fill even under hover so it
  // stays stronger than hover, matching the tree row's selected ordering.
  headerActive: {
    // A selected/active row keeps its actions revealed even without hover or focus.
    "--_row-actions-opacity": "1",
    "--_row-actions-pointer-events": "auto",
    backgroundColor: {
      default: colorVars["--honk-color-control-selected"],
      ":hover": colorVars["--honk-color-control-selected"],
    },
  },
  chevron: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
  },
  glyph: {
    flexShrink: 0,
    width: STATUS_GLYPH_SLOT_WIDTH,
    textAlign: "center",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
  },
  glyphAdded: {
    color: colorVars["--honk-color-diff-addition"],
  },
  glyphDeleted: {
    color: colorVars["--honk-color-diff-deletion"],
  },
  glyphModified: {
    color: colorVars["--honk-color-warn-fg"],
  },
  path: {
    display: "flex",
    flexGrow: 1,
    minWidth: 0,
    alignItems: "baseline",
    overflow: "hidden",
    fontFamily: fontVars["--honk-font-family-ui"],
    // Cursor's changes sidebar runs a 13px base; only the +N/-N counts drop to 12px.
    fontSize: fontVars["--honk-font-size-body"],
  },
  pathDir: {
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
  },
  // The filename outlives everything else in a starved row: useTruncatedPath drops
  // the dir first, then leading-truncates the name itself (Cursor's "…CHING.md") so
  // the extension stays readable instead of the whole path collapsing to zero width.
  pathName: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-primary"],
  },
  // Filename status color is Cursor's gitDecoration ramp, which is not the diff-count ramp:
  // --honk-color-diff-addition's dark stop (#3FA266) is the +N count green and reads too
  // saturated for a filename.
  pathNameAdded: {
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass gitDecoration.addedResourceForeground; no honk token carries this pair
    color: "light-dark(#007041, #70B489)",
  },
  pathNameModified: {
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass gitDecoration.modifiedResourceForeground; --honk-color-warn-fg's light stop (#8B5700) is a different amber
    color: "light-dark(#A46700, #F1B467)",
  },
  pathNameDeleted: {
    color: colorVars["--honk-color-diff-deletion"],
    textDecoration: "line-through",
  },
  stats: {
    flexShrink: 0,
    display: "inline-flex",
    gap: spaceVars["--honk-space-gutter"],
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
  guard: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
  },
  // Counts/status and revert/copy share one grid cell (Cursor's swap): the actions
  // fade in over the stat instead of reserving resting row width for two buttons.
  trailingSwap: {
    flexShrink: 0,
    display: "grid",
    justifyItems: "end",
    alignItems: "center",
  },
  swapStat: {
    gridArea: "1 / 1",
    display: "inline-flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    opacity: "calc(1 - var(--_row-actions-opacity, 0))",
    pointerEvents: "none",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  // Trailing revert/copy: hover/focus-revealed via the header's shared opacity var.
  reveal: {
    gridArea: "1 / 1",
    display: "inline-flex",
    alignItems: "center",
    opacity: "var(--_row-actions-opacity, 0)",
    pointerEvents: "var(--_row-actions-pointer-events, none)",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  body: {
    minWidth: 0,
    userSelect: "text",
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px hairline gap between the two placeholder lines; tightest spacing token is 6px
    gap: "2px",
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
});

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

function placeholderMessage(status: Git.ChangeStatus): {
  readonly title: string;
  readonly detail: string;
} {
  switch (status) {
    case "added":
      return { title: "New file", detail: "Honk has no line diff to render for this addition." };
    case "deleted":
      return { title: "File deleted", detail: "The file was removed from the working tree." };
    case "modified":
      return {
        title: "No diff available",
        detail: "Honk does not show binary or oversized diffs.",
      };
  }
}

function splitPath(file: string): { readonly dir: string; readonly name: string } {
  const normalized = normalizePathSeparators(file);
  const name = basename(normalized);
  const dir = normalized.slice(0, Math.max(0, normalized.length - name.length));
  return { dir, name };
}

function WorkbenchChangesCard({
  file,
  workspaceId,
  patch,
  patchPending,
  diffStyle,
  wordWrap,
  theme,
  isExpanded,
  onToggleExpand,
  isActive,
  onSelect,
  isViewed,
  onToggleViewed,
  isIncluded,
  onToggleInclude,
  onRevert,
  actionsDisabled,
}: {
  readonly file: Git.FileChange;
  readonly workspaceId: Workspace.WorkspaceId;
  readonly patch: string | undefined;
  // While the diff stream is still resolving, an absent patch means "loading", not "no diff".
  readonly patchPending: boolean;
  readonly diffStyle: "unified" | "split";
  readonly wordWrap: boolean;
  readonly theme: "light" | "dark";
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
  // The card whose file is the tree's selected path renders the active treatment; clicking the
  // header reports the selection back so tree and list highlight stay locked.
  readonly isActive: boolean;
  readonly onSelect: () => void;
  readonly isViewed: boolean;
  readonly onToggleViewed: () => void;
  // Whether this file is included in the Files: list sent to the Git agent.
  readonly isIncluded: boolean;
  readonly onToggleInclude: () => void;
  readonly onRevert: () => void;
  // Disabled while a Git action dispatched from the panel is running.
  readonly actionsDisabled: boolean;
}): React.ReactElement {
  const { dir, name } = splitPath(file.file);
  const truncated = useTruncatedPath(dir, name);
  const hasPatch = patch !== undefined && patch.length > 0;
  const isPending = !hasPatch && patchPending;
  const placeholder = placeholderMessage(file.status);

  // buildDiffOptions parses the patch for the dual-gutter onPostRender hook, so
  // it must not run on every render of an expanded card.
  const diffOptions = React.useMemo(
    () => buildDiffOptions(theme, diffStyle, wordWrap, patch),
    [theme, diffStyle, wordWrap, patch],
  );

  const copyPath = (): void => {
    void navigator.clipboard.writeText(file.file);
  };

  // Interactive controls are siblings of the select/expand button, never its
  // descendants: a button must not contain other controls, and sibling layout is
  // what keeps Space/Enter on a control from also toggling the card.
  return (
    <div {...stylex.props(styles.root, isViewed && styles.rootViewed)}>
      <div
        data-active={isActive || undefined}
        // The controls below are siblings, so the row's own padding and gaps sit inside none of
        // them. The row owns the interactive cursor for the whole strip rather than letting each
        // control paint its own island; index.css resolves the value.
        data-cursor-pointer-control=""
        {...stylex.props(styles.header, isActive && styles.headerActive)}
      >
        <span {...stylex.props(styles.guard)}>
          <Checkbox
            size="sm"
            aria-label={`Include ${name} in Git action`}
            checked={isIncluded}
            disabled={actionsDisabled}
            onCheckedChange={onToggleInclude}
          />
        </span>
        <button
          type="button"
          data-canonical-control-exception="Git changes card header: custom disclosure + selection composite; no @honk/ui tree primitive exists."
          aria-expanded={isExpanded}
          title={file.file}
          onClick={() => {
            onSelect();
            onToggleExpand();
          }}
          {...stylex.props(styles.headerButton)}
        >
          <Icon
            icon={isExpanded ? IconChevronDownMedium : IconChevronRightMedium}
            size="sm"
            style={styles.chevron}
          />
          <span ref={truncated.hostRef} {...stylex.props(styles.path)}>
            {truncated.dirDisplay !== null ? (
              <span {...stylex.props(styles.pathDir)}>{truncated.dirDisplay}</span>
            ) : null}
            <span
              {...stylex.props(
                styles.pathName,
                file.status === "added" && styles.pathNameAdded,
                file.status === "modified" && styles.pathNameModified,
                file.status === "deleted" && styles.pathNameDeleted,
              )}
            >
              {truncated.nameDisplay}
            </span>
          </span>
        </button>
        <span {...stylex.props(styles.trailingSwap)}>
          <span {...stylex.props(styles.swapStat)}>
            <span {...stylex.props(styles.stats)}>
              {file.additions > 0 ? (
                <span {...stylex.props(styles.additions)}>+{file.additions}</span>
              ) : null}
              {file.deletions > 0 ? (
                <span {...stylex.props(styles.deletions)}>-{file.deletions}</span>
              ) : null}
            </span>
            <span
              aria-label={file.status}
              {...stylex.props(
                styles.glyph,
                file.status === "added" && styles.glyphAdded,
                file.status === "deleted" && styles.glyphDeleted,
                file.status === "modified" && styles.glyphModified,
              )}
            >
              {fileStatusGlyph(file.status)}
            </span>
          </span>
          <span {...stylex.props(styles.reveal)}>
            <IconButton
              size="sm"
              variant="quiet"
              aria-label={`Revert changes to ${name}`}
              disabled={actionsDisabled}
              onClick={onRevert}
            >
              <Icon icon={IconArrowRotateCounterClockwise} size="sm" />
            </IconButton>
            <IconButton size="sm" variant="quiet" aria-label="Copy path" onClick={copyPath}>
              <Icon icon={IconClipboard} size="sm" />
            </IconButton>
          </span>
        </span>
        <span {...stylex.props(styles.guard)}>
          <Checkbox
            size="sm"
            aria-label="Viewed"
            checked={isViewed}
            onCheckedChange={onToggleViewed}
          />
        </span>
      </div>
      {isExpanded ? (
        <div data-honk-scrollport="" {...stylex.props(styles.body)}>
          {hasPatch ? (
            <PatchDiff patch={patch} options={diffOptions} disableWorkerPool />
          ) : isPending ? (
            <div {...stylex.props(styles.loading)}>
              <Spinner size="sm" tone="muted" />
            </div>
          ) : file.status !== "deleted" && isImagePreviewPath(file.file) ? (
            <WorkbenchChangesImage workspaceId={workspaceId} path={file.file} />
          ) : (
            <div {...stylex.props(styles.placeholder)}>
              <Text as="p" size="sm" tone="muted" weight="regular">
                {placeholder.title}
              </Text>
              <Text as="p" size="xs" tone="faint">
                {placeholder.detail}
              </Text>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export { WorkbenchChangesCard };
