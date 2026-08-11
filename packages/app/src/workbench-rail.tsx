import * as stylex from "@stylexjs/stylex";
import { Icon, IconButton, Tooltip, WorkbenchRailRow, type Glyph } from "@honk/ui";
import { IconChevronDoubleLeft, IconChevronDoubleRight } from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { workbenchLayout } from "./workbench-layout.stylex";

const HAIRLINE_WIDTH = "1px";
const RAIL_LABELED_WIDTH = "260px";
const RAIL_COMPACT_WIDTH = "40px";
const RAIL_INSET_SMALL = "4px";
const COMPACT_STRIP_TOP_OFFSET = `calc(${workbenchLayout.headerHeight} + ${spaceVars["--honk-space-panel-pad"]})`;
const COMPACT_STRIP_RING = `inset 0 0 0 ${HAIRLINE_WIDTH} ${colorVars["--honk-color-stroke-tertiary"]}`;

const styles = stylex.create({
  labeledRail: {
    flexShrink: 0,
    width: RAIL_LABELED_WIDTH,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    paddingBlockStart: COMPACT_STRIP_TOP_OFFSET,
    boxSizing: "border-box",
  },
  railCard: {
    "--_rail-options-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
    },
    position: "relative",
    width: RAIL_LABELED_WIDTH,
    maxHeight: "100%",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
  },
  railOptions: {
    position: "absolute",
    insetInlineEnd: spaceVars["--honk-space-panel-pad"],
    insetBlockStart: 0,
    zIndex: 1,
    opacity: "var(--_rail-options-opacity, 0)",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  railScroll: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflowY: "auto",
    marginInlineEnd: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px scroll nudge above rail rows is fixed geometry, no spacing token owns 2px
    paddingBlockStart: "2px",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px rail inset is fixed geometry, no spacing token owns 4px
    paddingBlockEnd: RAIL_INSET_SMALL,
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px rail inset is fixed geometry, no spacing token owns 4px
    paddingInline: RAIL_INSET_SMALL,
  },
  railSection: { display: "flex", flexDirection: "column", minWidth: 0 },
  // oxlint-disable-next-line honk/design-no-raw-values -- 16px section separation is fixed geometry, no spacing token owns 16px
  railSectionSpaced: { marginBlockStart: "16px" },
  railSectionLabel: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    paddingInline: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px rail inset is fixed geometry, no spacing token owns 4px
    paddingBlockEnd: RAIL_INSET_SMALL,
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 15px section-label leading is fixed, no leading token owns 15px
    lineHeight: "15px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  railBadge: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    gap: controlVars["--honk-control-gap"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  },
  railAddition: { color: colorVars["--honk-color-diff-addition"] },
  railDeletion: { color: colorVars["--honk-color-diff-deletion"] },
  railDetail: {
    marginInlineStart: "auto",
    color: colorVars["--honk-color-text-faint"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    fontVariantNumeric: "tabular-nums",
  },
  compactRail: {
    flexShrink: 0,
    width: RAIL_COMPACT_WIDTH,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlockStart: COMPACT_STRIP_TOP_OFFSET,
    boxSizing: "border-box",
  },
  compactStrip: {
    minHeight: 0,
    width: "max-content",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px hairline gap between compact icon buttons is fixed, no spacing token owns 1px
    gap: "1px",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px rail inset is fixed geometry, no spacing token owns 4px
    padding: RAIL_INSET_SMALL,
    marginInlineEnd: spaceVars["--honk-space-gutter"],
    overflowY: "auto",
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: COMPACT_STRIP_RING,
  },
});

type ChangeBadge = { readonly additions: number; readonly deletions: number };

type WorkbenchRailItem = {
  readonly id: string;
  readonly label: string;
  readonly compactLabel?: string | undefined;
  readonly icon: Glyph;
  readonly badge?: ChangeBadge | undefined;
  readonly detail?: string | undefined;
  readonly onOpen: () => void;
};

type WorkbenchRailProps = {
  readonly compact: boolean;
  readonly minimized: boolean;
  readonly responsiveCompact: boolean;
  readonly directory: string;
  readonly openItems: readonly WorkbenchRailItem[];
  readonly toolItems: readonly WorkbenchRailItem[];
  readonly onMinimizedChange: (minimized: boolean) => void;
};

function workspaceName(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, "");
  const [name = "workspace"] = trimmed.split(/[\\/]/).slice(-1);
  return name.trim().length > 0 ? name : "workspace";
}

function RailChangeBadge({ badge }: { readonly badge: ChangeBadge }): React.ReactElement | null {
  if (badge.additions <= 0 && badge.deletions <= 0) return null;
  return (
    <span {...stylex.props(styles.railBadge)}>
      {badge.additions > 0 ? (
        <span {...stylex.props(styles.railAddition)}>+{badge.additions}</span>
      ) : null}
      {badge.deletions > 0 ? (
        <span {...stylex.props(styles.railDeletion)}>-{badge.deletions}</span>
      ) : null}
    </span>
  );
}

function LabeledRailRow({ item }: { readonly item: WorkbenchRailItem }): React.ReactElement {
  return (
    <WorkbenchRailRow onClick={item.onOpen}>
      <Icon icon={item.icon} size="md" />
      <WorkbenchRailRow.Label>{item.label}</WorkbenchRailRow.Label>
      {item.badge === undefined ? null : <RailChangeBadge badge={item.badge} />}
      {item.detail === undefined ? null : (
        <span {...stylex.props(styles.railDetail)}>{item.detail}</span>
      )}
    </WorkbenchRailRow>
  );
}

function CompactRail({
  items,
  minimized,
  responsiveCompact,
  onMinimizedChange,
}: {
  readonly items: readonly WorkbenchRailItem[];
  readonly minimized: boolean;
  readonly responsiveCompact: boolean;
  readonly onMinimizedChange: (minimized: boolean) => void;
}): React.ReactElement {
  return (
    <div aria-label="Apps" {...stylex.props(styles.compactRail)}>
      <div data-honk-scrollport="" {...stylex.props(styles.compactStrip)}>
        {items.map((item) => (
          <Tooltip key={item.id} label={item.compactLabel ?? item.label}>
            <IconButton
              type="button"
              aria-label={item.compactLabel ?? item.label}
              aria-pressed={false}
              size="md"
              variant="quiet"
              onClick={item.onOpen}
            >
              <Icon icon={item.icon} size="md" />
            </IconButton>
          </Tooltip>
        ))}
        {minimized && !responsiveCompact ? (
          <Tooltip label="Expand">
            <IconButton
              type="button"
              aria-label="Expand"
              size="md"
              variant="quiet"
              onClick={() => {
                onMinimizedChange(false);
              }}
            >
              <Icon icon={IconChevronDoubleLeft} size="md" />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

function WorkbenchRail({
  compact,
  minimized,
  responsiveCompact,
  directory,
  openItems,
  toolItems,
  onMinimizedChange,
}: WorkbenchRailProps): React.ReactElement {
  if (compact) {
    return (
      <CompactRail
        items={toolItems}
        minimized={minimized}
        responsiveCompact={responsiveCompact}
        onMinimizedChange={onMinimizedChange}
      />
    );
  }

  return (
    <div aria-label="Apps" {...stylex.props(styles.labeledRail)}>
      <div {...stylex.props(styles.railCard)}>
        <div {...stylex.props(styles.railOptions)}>
          <Tooltip label="Collapse">
            <IconButton
              type="button"
              aria-label="Collapse"
              size="sm"
              variant="quiet"
              onClick={() => {
                onMinimizedChange(true);
              }}
            >
              <Icon icon={IconChevronDoubleRight} size="sm" />
            </IconButton>
          </Tooltip>
        </div>
        <div data-honk-scrollport="" {...stylex.props(styles.railScroll)}>
          {openItems.length > 0 ? (
            <div {...stylex.props(styles.railSection)}>
              <div {...stylex.props(styles.railSectionLabel)}>Open Tabs</div>
              {openItems.map((item) => (
                <LabeledRailRow key={item.id} item={item} />
              ))}
            </div>
          ) : null}
          <div
            {...stylex.props(styles.railSection, openItems.length > 0 && styles.railSectionSpaced)}
          >
            <div {...stylex.props(styles.railSectionLabel)}>On {workspaceName(directory)}</div>
            {toolItems.map((item) => (
              <LabeledRailRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { WorkbenchRail };
export type { ChangeBadge, WorkbenchRailItem, WorkbenchRailProps };
