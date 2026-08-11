import * as stylex from "@stylexjs/stylex";
import type { Git } from "@honk/core";
import { AlertDialog, Button, Checkbox, Icon, IconButton, Menu, Spinner, Text } from "@honk/ui";
import {
  IconArrowRotateClockwise,
  IconSidebarSimpleRightWide,
  IconArrowRotateCounterClockwise,
  IconBranch,
  IconChanges,
  IconChevronDownMedium,
  IconChevronRightMedium,
  IconDotGrid1x3Horizontal,
  IconEyeOpen,
  IconStop,
  IconSummary,
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
import * as React from "react";

import { setDiffWordWrap, setGitAgentDefaultAction, useAppSettings } from "./app-settings-store";
import { getHonkClient } from "./chat/client";
import { errorMessage } from "./error-message";
import {
  GIT_AGENT_ACTIONS,
  GIT_AGENT_ACTION_ORDER,
  type GitAgentActionId,
} from "./lib/git-agent-actions";
import { useGitViewedState } from "./lib/use-git-viewed-state";
import { useResolvedTheme } from "./lib/use-resolved-theme";
import { actions as toastActions } from "./toast-store";
import { WorkbenchChangesCard } from "./workbench-changes-card";
import { WorkbenchChangesFileTree } from "./workbench-changes-file-tree";
import { workbenchChangesLayout } from "./workbench-changes-layout.stylex";
import {
  changesResourceFor,
  type ChangesScope,
  useWorkbenchChangesSnapshot,
} from "./workbench-changes-resource";
import type { WorkbenchSessionRef } from "./workbench-frame";

const DIFF_STYLE_STORAGE_KEY = "honk:git-diff-style";
const RAIL_STORAGE_KEY = "honk:git-changes-rail";
const SCOPE_STORAGE_KEY = "honk:git-changes-scope";
const EMPTY_FILES: readonly Git.FileChange[] = Object.freeze([]);
// Cursor fixes the rail header at a structural height beyond Honk's control-height scale.
const SCOPE_ROW_MIN_HEIGHT = "36px";
// Cursor's resizable changes rail uses these default, floor, and ceiling measures.
const CHANGES_RAIL_WIDTH = "220px";
const CHANGES_RAIL_MIN_WIDTH = "180px";
const CHANGES_RAIL_MAX_WIDTH = "460px";
// Cursor's split-button chevron occupies a narrower segment than Honk's controls.
const SPLIT_CHEVRON_WIDTH = "20px";
// Cursor's split button is monochrome, not accent-blue: the fill is its inverted-neutral
// --cursor-base, which ships as light-dark(#141414, #F0F0F0). No honk color token pairs those two
// stops, so the literal carries the fidelity. StyleX evaluates these module consts at build time
// (same pattern as tool-call.tsx's shimmer).
const SPLIT_FILL = "light-dark(#141414, #F0F0F0)";
// Cursor replaces the fill on hover/press instead of overlaying a state tint: the interactive stop
// is --cursor-text-secondary, 74% of the same base.
const SPLIT_FILL_INTERACTIVE = `color-mix(in srgb, ${SPLIT_FILL} 74%, transparent)`;
// The chevron segment's inset divider is Cursor's .ui-eswg0q seam,
// color-mix(in srgb, var(--cursor-bg-editor) 16%, transparent). Honk's --honk-color-on-accent is the
// theme-tracking analogue of Cursor's editor background, so the seam follows the active theme.
const SPLIT_DIVIDER_COLOR = `color-mix(in srgb, ${colorVars["--honk-color-on-accent"]} 16%, transparent)`;

type DiffStyle = "unified" | "split";

const styles = stylex.create({
  branch: {
    minWidth: 0,
    flexShrink: 1,
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    overflow: "hidden",
    color: colorVars["--honk-color-text-muted"],
  },
  // Copy-on-click carries no chrome; a pointer cursor is the whole affordance (matches the old panel).
  branchCopyable: {
    appearance: "none",
    borderStyle: "none",
    backgroundColor: "transparent",
    textAlign: "start",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    borderRadius: radiusVars["--honk-radius-control"],
  },
  branchLabel: {
    minWidth: 0,
    overflow: "hidden",
    // Cursor renders the branch in the UI (sans) font, not mono.
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px is a sub-token meta gap; tightest spacing token (--honk-control-gap) is 6px and would loosen the add/del counts
    gap: "4px",
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontVariantNumeric: "tabular-nums",
  },
  // Cursor's scope trigger carries no chrome: icon, truncating label, live counts,
  // chevron. Closed it reads secondary and promotes to primary on hover or while open.
  scopeTrigger: {
    minWidth: 0,
    flexShrink: 1,
    maxWidth: "100%",
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    appearance: "none",
    margin: 0,
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    textAlign: "start",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": colorVars["--honk-color-text-primary"],
      "[data-popup-open]": colorVars["--honk-color-text-primary"],
    },
    // Cursor keeps the trigger's +N/-N quaternary until the trigger itself is
    // hovered, then gives them their git colors. The hover lives on the button, so
    // the two count colors travel down as custom properties.
    "--_scope-stat-add": {
      default: colorVars["--honk-color-text-faint"],
      ":hover": colorVars["--honk-color-diff-addition"],
      "[data-popup-open]": colorVars["--honk-color-diff-addition"],
    },
    "--_scope-stat-del": {
      default: colorVars["--honk-color-text-faint"],
      ":hover": colorVars["--honk-color-diff-deletion"],
      "[data-popup-open]": colorVars["--honk-color-diff-deletion"],
    },
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    borderRadius: radiusVars["--honk-radius-control"],
  },
  // The label is the only part that gives up width; "Uncommitted" ellipsis-truncates
  // rather than abbreviating, so the counts and chevron stay readable in a narrow panel.
  scopeTriggerLabel: {
    minWidth: 0,
    flexShrink: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  scopeStats: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    fontVariantNumeric: "tabular-nums",
  },
  scopeStatAdd: {
    color: "var(--_scope-stat-add)",
  },
  scopeStatDel: {
    color: "var(--_scope-stat-del)",
  },
  // Cursor's scope row is the top row of the rail itself: 36px tall and borderless.
  scopeRow: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minHeight: SCOPE_ROW_MIN_HEIGHT,
    paddingInline: controlVars["--honk-control-gap"],
  },
  scopeLabel: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  body: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
  },
  // The rail is the last flex child, so its hairline separates it from the diff column on its
  // inline-start edge. Cursor sizes it as a fixed sidebar (schema min 180 / max 460 / default 220),
  // not a proportional share; no honk width token covers those intrinsics.
  treeColumn: {
    flexShrink: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    width: CHANGES_RAIL_WIDTH,
    minWidth: CHANGES_RAIL_MIN_WIDTH,
    maxWidth: CHANGES_RAIL_MAX_WIDTH,
    borderInlineStartWidth: borderVars["--honk-border-hairline"],
    borderInlineStartStyle: "solid",
    borderInlineStartColor: colorVars["--honk-color-border-muted"],
  },
  treeScroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  cardList: {
    flexGrow: 1,
    // Wide diff content must not inflate the region past its share of the body.
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  },
  cardWrap: {
    minWidth: 0,
  },
  gitActions: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  // One attached, flat split control: the two segments touch, share Cursor's monochrome fill, and
  // the group rounds only its outer corners (each segment rounds its own outer side).
  splitGroup: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "stretch",
    height: controlVars["--honk-control-h-sm"],
  },
  splitSegment: {
    appearance: "none",
    boxSizing: "border-box",
    position: "relative",
    isolation: "isolate",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    margin: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: colorVars["--honk-color-on-accent"],
    fontFamily: fontVars["--honk-font-family-ui"],
    whiteSpace: "nowrap",
    userSelect: "none",
    // Cursor's disabled split button (.ui-ijokvz) is 0.5, dimmer than honk's 0.4 control token.
    opacity: { default: 1, ":disabled": 0.5 },
    // Cursor draws the focus ring inset (2px wide, -2px offset) so the attached segments keep their
    // shared silhouette. Honk keeps its opaque accent outline color instead of Cursor's translucent
    // ring: a deliberate contrast-stronger deviation.
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor's inset focus ring is a fixed 2px; the border tokens are hairlines and would under-draw it
    outlineWidth: "2px",
    outlineOffset: "-2px",
    // Flat by design: only color/background/border animate — no elevation, no highlight gloss.
    transitionProperty: "background-color, border-color, color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-base"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    "::before": {
      content: '""',
      position: "absolute",
      inset: 0,
      zIndex: -1,
      borderRadius: "inherit",
      pointerEvents: "none",
      backgroundColor: {
        // oxlint-disable-next-line honk/design-no-raw-values -- Cursor --cursor-base inverted-neutral fill; no honk token pairs light-dark(#141414, #F0F0F0)
        default: SPLIT_FILL,
        // Cursor replaces the fill on hover/press with --cursor-text-secondary (74% of base)
        // instead of overlaying a state tint, so there is no second pseudo-element here.
        ":hover": { "@media (hover: hover)": SPLIT_FILL_INTERACTIVE },
        ":active": SPLIT_FILL_INTERACTIVE,
      },
    },
  },
  splitPrimary: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px icon-to-label gap (busy spinner); tightest gap token (--honk-control-gap) is 6px and would loosen the pairing
    gap: "2px",
    paddingBlock: 0,
    paddingInline: spaceVars["--honk-space-gutter"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    letterSpacing: fontVars["--honk-letter-spacing-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    borderStartStartRadius: radiusVars["--honk-radius-control"],
    borderEndStartRadius: radiusVars["--honk-radius-control"],
  },
  splitChevron: {
    width: SPLIT_CHEVRON_WIDTH,
    paddingInline: 0,
    borderStartEndRadius: radiusVars["--honk-radius-control"],
    borderEndEndRadius: radiusVars["--honk-radius-control"],
    borderInlineStartWidth: borderVars["--honk-border-hairline"],
    borderInlineStartStyle: "solid",
    borderInlineStartColor: SPLIT_DIVIDER_COLOR,
  },
  menuLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function readDiffStyle(): DiffStyle {
  if (typeof window === "undefined") return "unified";
  try {
    return window.localStorage.getItem(DIFF_STYLE_STORAGE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

function readScope(): ChangesScope {
  if (typeof window === "undefined") return "git";
  try {
    const stored = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    if (stored === "branch" || stored === "lastTurn") return stored;
    return "git";
  } catch {
    return "git";
  }
}

// Cursor's rail is a persisted dock toggle, not width-responsive: at narrow panel
// widths the fixed 220px rail starves the cards, and collapsing it is the user's
// call. Honk defaults to expanded where Cursor defaults collapsed.
function readRailExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

// Split button: primary segment dispatches the persisted default action; the chevron opens the
// remaining actions in order. While a panel dispatch runs, the primary segment shows the dispatched
// action's loading label and a Stop control replaces the interaction.
function GitActionBar({
  defaultAction,
  pendingAction,
  disabled,
  hasIncludedFiles,
  onRunDefault,
  onSelectAction,
  onStop,
}: {
  readonly defaultAction: GitAgentActionId;
  readonly pendingAction: GitAgentActionId | null;
  readonly disabled: boolean;
  readonly hasIncludedFiles: boolean;
  readonly onRunDefault: () => void;
  readonly onSelectAction: (action: GitAgentActionId) => void;
  readonly onStop: () => void;
}): React.ReactElement {
  const busy = pendingAction !== null;
  const primaryLabel =
    pendingAction !== null
      ? GIT_AGENT_ACTIONS[pendingAction].loadingLabel
      : GIT_AGENT_ACTIONS[defaultAction].label;
  const otherActions = GIT_AGENT_ACTION_ORDER.filter((action) => action !== defaultAction);
  // With every file unchecked, a staging action would send a prompt with no Files:
  // scope and the agent would operate on the whole tree; only createBranch is
  // meaningful without included files.
  const requiresFiles = (action: GitAgentActionId): boolean => action !== "createBranch";
  const stopRef = React.useRef<HTMLButtonElement>(null);
  const wasBusyRef = React.useRef(false);
  // Disabling the primary segment mid-run drops keyboard focus to document.body; hand it to Stop,
  // the only control that stays actionable while the run is in flight.
  React.useEffect(() => {
    if (busy && !wasBusyRef.current) stopRef.current?.focus();
    wasBusyRef.current = busy;
  }, [busy]);
  return (
    <span {...stylex.props(styles.gitActions)}>
      {busy ? (
        <IconButton
          ref={stopRef}
          type="button"
          size="sm"
          variant="quiet"
          aria-label="Stop Git action"
          onClick={onStop}
        >
          <Icon icon={IconStop} size="sm" />
        </IconButton>
      ) : null}
      <span {...stylex.props(styles.splitGroup)}>
        <button
          type="button"
          data-canonical-control-exception="Git split button: attached primary+chevron composite sharing one flat monochrome fill; no @honk/ui split-button primitive exists."
          // The two segments are one attached control, so they must fade together: the file
          // requirement is enforced on click below rather than by disabling this segment alone.
          disabled={disabled || busy}
          aria-busy={busy || undefined}
          onClick={() => {
            if (requiresFiles(defaultAction) && !hasIncludedFiles) {
              toastActions.add({ type: "error", title: "Select at least one file to include." });
              return;
            }
            onRunDefault();
          }}
          {...stylex.props(styles.splitSegment, styles.splitPrimary)}
        >
          {busy ? <Spinner size="sm" tone="muted" /> : null}
          {primaryLabel}
        </button>
        <Menu.Root>
          <Menu.Trigger
            render={
              <button
                type="button"
                data-canonical-control-exception="Git split button: attached chevron segment sharing the primary's flat monochrome fill; no @honk/ui split-button primitive exists."
                aria-label="More Git actions"
                disabled={disabled || busy}
                {...stylex.props(styles.splitSegment, styles.splitChevron)}
              >
                <Icon icon={IconChevronDownMedium} size="xs" />
              </button>
            }
          />
          <Menu.Popup side="bottom" align="end">
            {otherActions.map((action) => (
              <Menu.Item
                key={action}
                disabled={requiresFiles(action) && !hasIncludedFiles}
                onClick={() => {
                  onSelectAction(action);
                }}
              >
                {GIT_AGENT_ACTIONS[action].label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Root>
      </span>
    </span>
  );
}

function WorkbenchChanges({
  sessionRef,
  directory,
  isThreadRunning,
}: {
  readonly sessionRef: WorkbenchSessionRef;
  readonly directory: string;
  readonly isThreadRunning: boolean;
}): React.ReactElement {
  const { sessionId, workspaceId } = sessionRef;
  const [scope, setScopeState] = React.useState<ChangesScope>(readScope);
  const resource = changesResourceFor(sessionRef, scope);
  const snapshot = useWorkbenchChangesSnapshot(sessionRef, scope, isThreadRunning);
  const appSettings = useAppSettings();
  const theme = useResolvedTheme();

  const files = snapshot.phase === "ready" ? snapshot.files : EMPTY_FILES;
  const diffsPending = snapshot.phase === "ready" ? snapshot.diffsPending : false;
  const filePaths = files.map((file) => file.file);
  const filePathsKey = filePaths.join("\n");

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const [diffStyle, setDiffStyleState] = React.useState<DiffStyle>(readDiffStyle);
  const [railExpanded, setRailExpanded] = React.useState<boolean>(readRailExpanded);
  const viewed = useGitViewedState(directory, filePaths);

  // Files start included; storing only exclusions keeps newly appearing files checked
  // without a seeding effect. Client-side only: there is no git index to persist to.
  const [excludedPaths, setExcludedPaths] = React.useState<ReadonlySet<string>>(() => new Set());
  // The action dispatched from this panel while its run is in flight; null when idle.
  const [pendingAction, setPendingAction] = React.useState<GitAgentActionId | null>(null);
  // Single-file revert passes [path]; Discard All passes every currently included path. One
  // AlertDialog serves both, its copy keyed on the target count.
  const [revertTarget, setRevertTarget] = React.useState<readonly string[] | null>(null);
  // Reverting is a typed `git.discard`, not an agent turn, so it carries its own busy flag.
  const [isDiscarding, setDiscarding] = React.useState(false);

  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());

  // `git.diff` mode "branch" answers [] when the checkout is the default branch, so the
  // row only exists when the two differ.
  const branch = snapshot.phase === "ready" ? snapshot.branch : null;
  const defaultBranch = snapshot.phase === "ready" ? snapshot.defaultBranch : null;
  const branchScopeAvailable =
    branch !== null && defaultBranch !== null && branch !== defaultBranch;

  // The three blocks below adjust state in response to a changed input, so they run
  // during render instead of in effects (React: "You Might Not Need an Effect").

  // A persisted "vs default branch" scope stops being answerable the moment this
  // checkout becomes the default branch; fall back rather than show a false empty.
  if (scope === "branch" && snapshot.phase === "ready" && !branchScopeAvailable) {
    setScopeState("git");
  }

  // Clear the panel's pending action once its session stops running.
  const [wasRunning, setWasRunning] = React.useState(isThreadRunning);
  if (wasRunning !== isThreadRunning) {
    setWasRunning(isThreadRunning);
    if (!isThreadRunning) setPendingAction(null);
  }

  // Seed expand-first once per distinct file set: open the first card for immediacy
  // without clobbering later user expand/collapse actions on the same set.
  const firstFile = files[0]?.file;
  const [seededKey, setSeededKey] = React.useState<string | null>(null);
  if (firstFile !== undefined && seededKey !== filePathsKey) {
    setSeededKey(filePathsKey);
    setExpanded(new Set([firstFile]));
  }

  const setDiffStyle = (next: DiffStyle): void => {
    setDiffStyleState(next);
    try {
      window.localStorage.setItem(DIFF_STYLE_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; a rejected write must not break layout toggling.
    }
  };

  const selectScope = (next: ChangesScope): void => {
    setScopeState(next);
    try {
      window.localStorage.setItem(SCOPE_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; a rejected write must not break scope switching.
    }
  };

  const toggleRail = (): void => {
    const next = !railExpanded;
    setRailExpanded(next);
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, next ? "expanded" : "collapsed");
    } catch {
      // Persistence is best-effort; a rejected write must not break layout toggling.
    }
  };

  const toggleExpand = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectFile = (path: string): void => {
    setSelectedPath(path);
    setExpanded((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    requestAnimationFrame(() => {
      cardRefs.current.get(path)?.scrollIntoView({ block: "nearest" });
    });
  };

  const allExpanded = filePaths.length > 0 && filePaths.every((path) => expanded.has(path));
  const toggleExpandAll = (): void => {
    setExpanded(allExpanded ? new Set() : new Set(filePaths));
  };

  const defaultAction = appSettings.gitAgentDefaultAction;
  const includedFiles = filePaths.filter((path) => !excludedPaths.has(path));
  const actionsBusy = pendingAction !== null || isDiscarding;
  const dispatchDisabled = files.length === 0 || getHonkClient() === null;

  // Master checkbox aggregate: both it and the per-file boxes read the one exclusion set.
  const allIncluded = filePaths.length > 0 && includedFiles.length === filePaths.length;
  const noneIncluded = includedFiles.length === 0;
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  // Row order and gating follow the native "Switch source" dialog. "Uncommitted"
  // always exists; the merge-base row is labelled from the real base rather than
  // "All Changes", which would promise a distinction Honk cannot draw.
  const uncommittedScope = {
    scope: "git" as const,
    label: "Uncommitted",
    icon: IconChanges,
    empty: {
      title: "No uncommitted changes",
      description: "The working tree matches HEAD.",
    },
  };
  const scopeRows = [
    uncommittedScope,
    ...(branchScopeAvailable
      ? [
          {
            scope: "branch" as const,
            label: `vs ${defaultBranch}`,
            icon: IconBranch,
            empty: {
              title: `No changes against ${defaultBranch}`,
              description: "Nothing differs from where this branch diverged.",
            },
          },
        ]
      : []),
    {
      scope: "lastTurn" as const,
      label: "Last Agent Turn",
      icon: IconSummary,
      empty: {
        title: "No changes in the last turn",
        description: "The newest turn recorded no file changes.",
      },
    },
  ];
  const activeScope = scopeRows.find((row) => row.scope === scope) ?? uncommittedScope;

  const isIncluded = (path: string): boolean => !excludedPaths.has(path);
  const toggleIncluded = (path: string): void => {
    setExcludedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  // Toggle-to-opposite: any file still included clears to all-excluded, otherwise re-include all.
  const toggleAllIncluded = (): void => {
    setExcludedPaths(includedFiles.length > 0 ? new Set(filePaths) : new Set());
  };
  const copyBranch = (name: string): void => {
    void navigator.clipboard.writeText(name).then(
      () => {
        toastActions.add({ type: "success", title: "Copied branch name" });
      },
      (cause: unknown) => {
        toastActions.add({
          type: "error",
          title: "Could not copy branch name",
          description: errorMessage(cause),
        });
      },
    );
  };

  const runGitAction = (action: GitAgentActionId, actionFiles: readonly string[]): void => {
    const client = getHonkClient();
    if (client === null) return;
    setPendingAction(action);
    void client.session
      .runGitAction({
        sessionId,
        action,
        ...(actionFiles.length > 0 ? { files: actionFiles } : {}),
      })
      .catch((error: unknown) => {
        setPendingAction(null);
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: `${GIT_AGENT_ACTIONS[action].label} failed`,
          description: message,
          copyableError: message,
          threadKey: sessionId,
        });
      });
  };

  // createBranch never stages files; every other split action sends the included paths.
  const dispatchSplitAction = (action: GitAgentActionId): void => {
    runGitAction(action, action === "createBranch" ? [] : includedFiles);
  };
  const selectDefaultAction = (action: GitAgentActionId): void => {
    setGitAgentDefaultAction(action);
    dispatchSplitAction(action);
  };
  const stopGitAction = (): void => {
    const client = getHonkClient();
    if (client === null) return;
    void client.session.abort({ sessionId }).catch(() => {
      // A failed abort leaves the run going; the busy state clears when it ends.
    });
  };
  // Revert is core's typed `git.discard`: it restores tracked paths from HEAD and
  // refuses untracked ones, whose only copy deletion would destroy.
  const confirmRevert = (): void => {
    const target = revertTarget;
    setRevertTarget(null);
    if (target === null || target.length === 0) return;
    const client = getHonkClient();
    if (client === null) return;
    const [first, ...rest] = target;
    if (first === undefined) return;
    setDiscarding(true);
    void client.git
      .discard({ workspaceId, paths: [first, ...rest] })
      .then((result) => {
        if (result.skipped.length > 0) {
          toastActions.add({
            type: "error",
            title: "Untracked files were kept",
            description: `Reverting would delete the only copy of: ${result.skipped.join(", ")}`,
          });
        }
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Revert failed",
          description: message,
          copyableError: message,
          threadKey: sessionId,
        });
      })
      .finally(() => {
        setDiscarding(false);
        resource.refresh();
      });
  };

  // Which comparison the panel is showing, plus that comparison's live totals. The
  // counts belong on the trigger because they describe the selected scope, not the branch.
  const scopeMenu = (
    <Menu.Root>
      <Menu.Trigger
        render={
          <button
            type="button"
            data-canonical-control-exception="Changes scope trigger: chrome-free icon + truncating label + live counts + chevron; no @honk/ui control renders an inline menu trigger without its own padding and background."
            aria-label={`Changes scope: ${activeScope.label}`}
            {...stylex.props(styles.scopeTrigger)}
          >
            <Icon icon={activeScope.icon} size="sm" />
            <span {...stylex.props(styles.scopeTriggerLabel)}>{activeScope.label}</span>
            {totalAdditions > 0 || totalDeletions > 0 ? (
              <span {...stylex.props(styles.scopeStats)}>
                {totalAdditions > 0 ? (
                  <span {...stylex.props(styles.scopeStatAdd)}>+{totalAdditions}</span>
                ) : null}
                {totalDeletions > 0 ? (
                  <span {...stylex.props(styles.scopeStatDel)}>-{totalDeletions}</span>
                ) : null}
              </span>
            ) : null}
            <Icon icon={IconChevronDownMedium} size="xs" />
          </button>
        }
      />
      <Menu.Popup side="bottom" align="start" aria-label="Changes scope">
        <Menu.RadioGroup
          value={scope}
          onValueChange={(value) => {
            const picked = scopeRows.find((row) => row.scope === value);
            if (picked !== undefined) selectScope(picked.scope);
          }}
        >
          {scopeRows.map((row) => (
            <Menu.RadioItem key={row.scope} value={row.scope}>
              <Menu.ItemIcon>
                <Icon icon={row.icon} size="sm" />
              </Menu.ItemIcon>
              <span {...stylex.props(styles.menuLabel)}>{row.label}</span>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Popup>
    </Menu.Root>
  );

  // The scope control stays mounted through loading and failure so a scope whose
  // fetch is slow or broken is never a dead end.
  if (snapshot.phase === "loading") {
    return (
      <div {...stylex.props(workbenchChangesLayout.root)}>
        <div {...stylex.props(workbenchChangesLayout.toolbar)}>
          {scopeMenu}
          <span {...stylex.props(workbenchChangesLayout.spacer)} />
        </div>
        <div {...stylex.props(workbenchChangesLayout.center)}>
          <Spinner label="Loading changes" tone="muted" />
        </div>
      </div>
    );
  }

  if (snapshot.phase === "error") {
    return (
      <div {...stylex.props(workbenchChangesLayout.root)}>
        <div {...stylex.props(workbenchChangesLayout.toolbar)}>
          {scopeMenu}
          <span {...stylex.props(workbenchChangesLayout.spacer)} />
        </div>
        <div {...stylex.props(workbenchChangesLayout.center)}>
          <Text as="p" size="sm" tone="muted" weight="regular">
            Can't load changes
          </Text>
          <Text as="p" size="xs" tone="faint">
            {snapshot.message}
          </Text>
          <Button size="sm" variant="quiet" onClick={resource.refresh}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const branchChip =
    branch === null ? (
      <span {...stylex.props(styles.branch)}>
        <Icon icon={IconBranch} size="sm" tone="faint" />
        <span {...stylex.props(styles.branchLabel)}>No branch</span>
      </span>
    ) : (
      <span
        role="button"
        tabIndex={0}
        aria-label={`Copy branch name ${branch}`}
        title="Copy branch name"
        onClick={() => {
          copyBranch(branch);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            copyBranch(branch);
          }
        }}
        {...stylex.props(styles.branch, styles.branchCopyable)}
      >
        <Icon icon={IconBranch} size="sm" tone="faint" />
        <span {...stylex.props(styles.branchLabel)}>{branch}</span>
      </span>
    );

  if (files.length === 0) {
    return (
      <div {...stylex.props(workbenchChangesLayout.root)}>
        <div {...stylex.props(workbenchChangesLayout.toolbar)}>
          {scopeMenu}
          {branchChip}
          <span {...stylex.props(workbenchChangesLayout.spacer)} />
          <Button size="sm" variant="quiet" onClick={resource.refresh}>
            Refresh
          </Button>
          <GitActionBar
            defaultAction={defaultAction}
            pendingAction={pendingAction}
            disabled={dispatchDisabled}
            hasIncludedFiles={includedFiles.length > 0}
            onRunDefault={() => {
              dispatchSplitAction(defaultAction);
            }}
            onSelectAction={selectDefaultAction}
            onStop={stopGitAction}
          />
        </div>
        <div {...stylex.props(workbenchChangesLayout.center)}>
          <Text as="p" size="sm" tone="muted" weight="regular">
            {activeScope.empty.title}
          </Text>
          <Text as="p" size="xs" tone="faint">
            {activeScope.empty.description}
          </Text>
        </div>
      </div>
    );
  }

  const cards = files.map((file) => (
    <div
      key={file.file}
      ref={(node) => {
        if (node === null) cardRefs.current.delete(file.file);
        else cardRefs.current.set(file.file, node);
      }}
      {...stylex.props(styles.cardWrap)}
    >
      <WorkbenchChangesCard
        file={file}
        workspaceId={workspaceId}
        patch={snapshot.diffs.get(file.file)?.patch}
        patchPending={diffsPending}
        diffStyle={diffStyle}
        wordWrap={appSettings.diffWordWrap}
        theme={theme}
        isExpanded={expanded.has(file.file)}
        onToggleExpand={() => {
          toggleExpand(file.file);
        }}
        isActive={selectedPath === file.file}
        onSelect={() => {
          setSelectedPath(file.file);
        }}
        isViewed={viewed.isViewed(file.file)}
        onToggleViewed={() => {
          viewed.toggleViewed(file.file);
        }}
        isIncluded={isIncluded(file.file)}
        onToggleInclude={() => {
          toggleIncluded(file.file);
        }}
        onRevert={() => {
          setRevertTarget([file.file]);
        }}
        actionsDisabled={actionsBusy}
      />
    </div>
  ));

  return (
    <div {...stylex.props(workbenchChangesLayout.root)}>
      <div {...stylex.props(workbenchChangesLayout.toolbar)}>
        {scopeMenu}
        {branchChip}
        <span {...stylex.props(workbenchChangesLayout.spacer)} />
        <Menu.Root>
          <Menu.Trigger
            render={
              <IconButton type="button" aria-label="Editor options" size="sm" variant="quiet">
                <Icon icon={IconDotGrid1x3Horizontal} size="sm" />
              </IconButton>
            }
          />
          <Menu.Popup side="bottom" align="end" aria-label="Editor options">
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger>
                <Menu.ItemIcon />
                <span {...stylex.props(styles.menuLabel)}>Layout</span>
                <Menu.ItemMeta>{diffStyle === "split" ? "Split" : "Unified"}</Menu.ItemMeta>
                <Icon icon={IconChevronRightMedium} size="xs" tone="faint" />
              </Menu.SubmenuTrigger>
              <Menu.SubmenuPopup aria-label="Layout">
                <Menu.RadioGroup
                  value={diffStyle}
                  onValueChange={(value) => {
                    setDiffStyle(value === "split" ? "split" : "unified");
                  }}
                >
                  <Menu.RadioItem value="unified">
                    <span {...stylex.props(styles.menuLabel)}>Unified</span>
                  </Menu.RadioItem>
                  <Menu.RadioItem value="split">
                    <span {...stylex.props(styles.menuLabel)}>Split</span>
                  </Menu.RadioItem>
                </Menu.RadioGroup>
              </Menu.SubmenuPopup>
            </Menu.SubmenuRoot>
            <Menu.CheckboxItem
              checked={appSettings.diffWordWrap}
              closeOnClick={false}
              onCheckedChange={setDiffWordWrap}
            >
              <Menu.ItemIcon />
              <span {...stylex.props(styles.menuLabel)}>Word Wrap</span>
            </Menu.CheckboxItem>
            <Menu.Separator />
            {/* One item whose label names the target state, as Cursor does. */}
            <Menu.Item onClick={toggleExpandAll}>
              <Menu.ItemIcon />
              <span {...stylex.props(styles.menuLabel)}>
                {allExpanded ? "Collapse All Files" : "Expand All Files"}
              </span>
            </Menu.Item>
            <Menu.Item onClick={resource.refresh}>
              <Menu.ItemIcon>
                <Icon icon={IconArrowRotateClockwise} size="sm" />
              </Menu.ItemIcon>
              <span {...stylex.props(styles.menuLabel)}>Refresh Changes</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
        <GitActionBar
          defaultAction={defaultAction}
          pendingAction={pendingAction}
          disabled={dispatchDisabled}
          hasIncludedFiles={includedFiles.length > 0}
          onRunDefault={() => {
            dispatchSplitAction(defaultAction);
          }}
          onSelectAction={selectDefaultAction}
          onStop={stopGitAction}
        />
        {/* Cursor keeps the rail dock control as the header's last element. */}
        <IconButton
          type="button"
          size="sm"
          variant="quiet"
          aria-label="Changes Sidebar"
          aria-expanded={railExpanded}
          title={railExpanded ? "Hide file tree" : "Show file tree"}
          onClick={toggleRail}
        >
          <Icon icon={IconSidebarSimpleRightWide} size="sm" />
        </IconButton>
      </div>
      <div {...stylex.props(styles.body)}>
        <div data-honk-scrollport="" {...stylex.props(styles.cardList)}>
          {cards}
        </div>
        {railExpanded ? (
          <div {...stylex.props(styles.treeColumn)}>
            <div data-honk-changes-scope-row="" {...stylex.props(styles.scopeRow)}>
              <Checkbox
                size="sm"
                aria-label="Include all changed files in Git action"
                checked={allIncluded}
                indeterminate={!allIncluded && !noneIncluded}
                disabled={actionsBusy}
                onCheckedChange={toggleAllIncluded}
              />
              <span {...stylex.props(styles.scopeLabel)}>
                <Text as="span" size="base" tone="muted">
                  {files.length} {files.length === 1 ? "File" : "Files"} Changed
                </Text>
              </span>
              <IconButton
                type="button"
                size="sm"
                variant="quiet"
                aria-label="Discard All Changes"
                title="Discard All Changes"
                disabled={includedFiles.length === 0 || actionsBusy}
                onClick={() => {
                  setRevertTarget(includedFiles);
                }}
              >
                <Icon icon={IconArrowRotateCounterClockwise} size="sm" />
              </IconButton>
              <span {...stylex.props(styles.meta)} title="Files marked viewed">
                <Icon icon={IconEyeOpen} size="xs" tone="faint" />
                {viewed.viewedCount}/{files.length}
              </span>
            </div>
            <div data-honk-scrollport="" {...stylex.props(styles.treeScroll)}>
              <WorkbenchChangesFileTree
                files={files}
                selectedPath={selectedPath}
                onSelect={selectFile}
                fileActions={{
                  isIncluded,
                  onToggleInclude: toggleIncluded,
                  onRevert: (path) => {
                    setRevertTarget([path]);
                  },
                  disabled: actionsBusy,
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
      <AlertDialog.Root
        open={revertTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevertTarget(null);
        }}
      >
        <AlertDialog.Popup>
          <AlertDialog.Header>
            <AlertDialog.Title>
              {revertTarget !== null && revertTarget.length === 1
                ? `Revert changes to ${revertTarget[0]}?`
                : `Revert changes to ${revertTarget?.length ?? 0} files?`}
            </AlertDialog.Title>
            <AlertDialog.Description>
              {revertTarget !== null && revertTarget.length === 1
                ? "This discards the working-tree changes for this file and cannot be undone."
                : `This discards the working-tree changes for these ${revertTarget?.length ?? 0} files and cannot be undone.`}
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Close render={<Button variant="quiet" />}>Cancel</AlertDialog.Close>
            <Button variant="destructive" onClick={confirmRevert}>
              {revertTarget !== null && revertTarget.length === 1 ? "Revert file" : "Revert files"}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Root>
    </div>
  );
}

export { WorkbenchChanges };
