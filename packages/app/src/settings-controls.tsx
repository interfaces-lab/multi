// Section and row anatomy follows Cursor's settings pane (Glass bundle). Named constants below
// carry the byte-verified source rule so the numbers stay traceable instead of magic.

import * as stylex from "@stylexjs/stylex";
import { Button, Icon, IconButton, Text, Tooltip } from "@honk/ui";
import { IconStepBack } from "@honk/ui/icons";
import { borderVars, colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

// Cursor collapses a row to a stack at 500px, as a container query on the pane duplicated as a
// plain media query. Honk's design floor bans container queries, so only the media arm ships.
const SETTINGS_ROW_STACK_MEDIA = "@media (max-width: 500px)";
// `.cursor-settings-cell{gap:20px}` / `.ui-field-group__entry{gap:var(--cursor-spacing-5)}`.
const SETTINGS_ROW_GAP = "20px";
// `.cursor-settings-cell{padding:12px 14px}` — block pad is honk's panel pad; inline is 14px.
const SETTINGS_ROW_PAD_INLINE = "14px";
// `.cursor-settings-cell-leading-items{gap:1px}` (`--cursor-spacing-0-25`): label and description
// read as one block, so the gap is a hairline rather than a spacing step.
const SETTINGS_ROW_COPY_GAP = "1px";
// `.cursor-settings-section-header{gap:2px}` (`--cursor-spacing-0-5`).
const SETTINGS_SECTION_HEADER_GAP = "2px";
// `.cursor-settings-section-header{padding:0 4px 0 8px}` — the header hangs 4px left of the card's
// 12px inset so the quiet title aligns optically with the row labels.
const SETTINGS_SECTION_HEADER_PAD_INLINE_END = controlVars["--honk-control-menu-pad"];
const SETTINGS_SECTION_HEADER_PAD_INLINE_START = controlVars["--honk-control-pad-sm"];
// `.cursor-settings-cell-divider{left:12px;right:12px}` — hairline inset inside the rounded card.
const SETTINGS_ROW_DIVIDER_INSET = spaceVars["--honk-space-panel-pad"];

const styles = stylex.create({
  section: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    // `.cursor-settings-section{gap:8px}`.
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
  },
  sectionHeader: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px title/description gap is Cursor's section-header intrinsic; the smallest spacing token is the 8px gutter
    gap: SETTINGS_SECTION_HEADER_GAP,
    paddingInlineStart: SETTINGS_SECTION_HEADER_PAD_INLINE_START,
    paddingInlineEnd: SETTINGS_SECTION_HEADER_PAD_INLINE_END,
    minWidth: 0,
  },
  sectionHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    columnGap: spaceVars["--honk-space-gutter"],
    rowGap: controlVars["--honk-control-menu-pad"],
    minWidth: 0,
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    // `.cursor-settings-sub-section-list` — rows sit flush on a tinted card; layer-01 is honk's
    // 4%-equivalent surface and the divider hairlines do the separating.
    backgroundColor: colorVars["--honk-color-layer-01"],
    borderRadius: radiusVars["--honk-radius-window"],
    overflow: "clip",
  },
  row: {
    position: "relative",
    boxSizing: "border-box",
    alignSelf: "stretch",
    display: "flex",
    flexDirection: {
      default: "row",
      [SETTINGS_ROW_STACK_MEDIA]: "column",
    },
    flexWrap: "wrap",
    alignItems: "center",
    gap: {
      // oxlint-disable-next-line honk/design-no-raw-values -- 20px label/control gap is Cursor's cell intrinsic; honk has no 20px spacing token
      default: SETTINGS_ROW_GAP,
      [SETTINGS_ROW_STACK_MEDIA]: spaceVars["--honk-space-panel-pad"],
    },
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 14px inline pad is Cursor's cell intrinsic; honk's nearest tokens are 12px and 10px
    paddingInline: SETTINGS_ROW_PAD_INLINE,
    "::before": {
      content: '""',
      position: "absolute",
      top: 0,
      insetInlineStart: SETTINGS_ROW_DIVIDER_INSET,
      insetInlineEnd: SETTINGS_ROW_DIVIDER_INSET,
      height: borderVars["--honk-border-hairline"],
      backgroundColor: colorVars["--honk-color-border-muted"],
      display: { default: "block", ":first-child": "none" },
    },
  },
  rowCopy: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px label/description gap is Cursor's leading-items intrinsic; the smallest spacing token is the 8px gutter
    gap: SETTINGS_ROW_COPY_GAP,
    flexGrow: { default: 1, [SETTINGS_ROW_STACK_MEDIA]: 0 },
    flexShrink: 1,
    flexBasis: { default: 0, [SETTINGS_ROW_STACK_MEDIA]: "auto" },
    minWidth: 0,
    maxWidth: "100%",
    width: { default: "auto", [SETTINGS_ROW_STACK_MEDIA]: "100%" },
    // Cursor clips this column for label ellipsis. Honk wraps labels instead, and clipping here
    // would cut the reset button's focus ring, so the column stays unclipped.
  },
  rowTitleLine: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-menu-pad"],
    minWidth: 0,
  },
  resetSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: controlVars["--honk-control-h-sm"],
    height: controlVars["--honk-control-h-sm"],
    flexShrink: 0,
  },
  rowControl: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: {
      default: "flex-end",
      [SETTINGS_ROW_STACK_MEDIA]: "flex-start",
    },
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
    flexGrow: { default: 0, [SETTINGS_ROW_STACK_MEDIA]: 1 },
    flexShrink: 0,
    flexBasis: { default: "auto", [SETTINGS_ROW_STACK_MEDIA]: "100%" },
    width: { default: "auto", [SETTINGS_ROW_STACK_MEDIA]: "100%" },
  },
  stepper: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
});

export function SettingResetButton(props: {
  readonly label: string;
  readonly onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip label="Reset to default">
      <IconButton
        size="sm"
        variant="quiet"
        aria-label={`Reset ${props.label} to default`}
        onClick={(event) => {
          event.stopPropagation();
          props.onClick();
        }}
      >
        <Icon icon={IconStepBack} size="sm" />
      </IconButton>
    </Tooltip>
  );
}

export function SettingsRow(props: {
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly control?: React.ReactNode;
  readonly resetAction?: React.ReactNode;
  // Retained for call-site compatibility. Rows draw their own inset top hairline, so the last row
  // no longer needs to suppress a trailing divider.
  readonly isLast?: boolean;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.rowCopy)}>
        <div {...stylex.props(styles.rowTitleLine)}>
          <Text size="base" weight="regular">
            {props.title}
          </Text>
          {props.resetAction === undefined ? null : (
            <span {...stylex.props(styles.resetSlot)}>{props.resetAction}</span>
          )}
        </div>
        {props.description === undefined ? null : (
          // Cursor keeps the description at the label's 13px and separates it by tone alone.
          <Text size="base" tone="muted">
            {props.description}
          </Text>
        )}
      </div>
      {props.control === undefined ? null : (
        <div {...stylex.props(styles.rowControl)}>{props.control}</div>
      )}
    </div>
  );
}

export function SettingsRows(props: { readonly children: React.ReactNode }): React.ReactElement {
  return <div {...stylex.props(styles.rows)}>{props.children}</div>;
}

export function SettingsSection(props: {
  // Optional: a panel's first section drops the title when it would repeat the page header
  // rendered by the settings dialog, keeping one loud title per page.
  readonly title?: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const hasHeader =
    props.title !== undefined || props.description !== undefined || props.action !== undefined;
  return (
    <section {...stylex.props(styles.section)}>
      {hasHeader ? (
        <div {...stylex.props(styles.sectionHeader)}>
          <div {...stylex.props(styles.sectionHeaderRow)}>
            {/* Cursor's section title is deliberately quieter than the row labels it groups:
                12px/16px regular in the secondary tone, not a heading. */}
            {props.title === undefined ? null : (
              <Text as="p" size="sm" weight="regular" tone="muted">
                {props.title}
              </Text>
            )}
            {props.action}
          </div>
          {props.description === undefined ? null : (
            <Text as="p" size="sm" tone="faint">
              {props.description}
            </Text>
          )}
        </div>
      ) : null}
      {props.children}
    </section>
  );
}

export function NumberStepper(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.stepper)} role="group" aria-label={props.label}>
      <Button
        size="sm"
        variant="neutral"
        aria-label={`Decrease ${props.label}`}
        disabled={props.value <= props.min}
        onClick={() => {
          props.onChange(props.value - 1);
        }}
      >
        −
      </Button>
      <Text size="sm" family="mono" style={{ minWidth: "2ch", textAlign: "center" }}>
        {props.value}
      </Text>
      <Button
        size="sm"
        variant="neutral"
        aria-label={`Increase ${props.label}`}
        disabled={props.value >= props.max}
        onClick={() => {
          props.onChange(props.value + 1);
        }}
      >
        +
      </Button>
    </div>
  );
}
