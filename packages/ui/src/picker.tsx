import { Select as Base } from "@base-ui/react/select";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconCheckmark1, IconChevronDownMedium } from "./icons";
import type {
  PickerCompound,
  PickerGroupLabelProps,
  PickerGroupProps,
  PickerOptionProps,
  PickerPopupProps,
  PickerRootProps,
  PickerSize,
  PickerTriggerProps,
} from "./picker.types";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  zVars,
} from "./tokens.stylex";

const PICKER_GUTTER = 4;
// A popup flush against the viewport edge looks cut off, so it holds the panel pad away from every
// edge. `--available-height` shrinks by the same amount and the list scrolls inside it.
const PICKER_COLLISION_PADDING = 12;
// The popup ceiling preserves enough viewport context around an anchored picker.
const PICKER_POPUP_MAX_HEIGHT = "min(360px, var(--available-height))";
const POPUP_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;
const DIALOG_CHILD_Z_INDEX = `calc(${zVars["--honk-z-dialog"]} + 1)`;
const PICKER_FIELD_MIN_WIDTH = "120px";

const sx = stylex.create({
  trigger: {
    appearance: "none",
    position: "relative",
    isolation: "isolate",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    maxWidth: controlVars["--honk-control-picker-max-w"],
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: "transparent",
    paddingInline: controlVars["--honk-control-pad-md"],
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    opacity: { default: 1, ":disabled": controlVars["--honk-control-disabled-opacity"] },
    transitionProperty: "background-color, box-shadow, color, opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    "::before": {
      content: '""',
      position: "absolute",
      inset: 0,
      zIndex: -2,
      borderRadius: "inherit",
      pointerEvents: "none",
    },
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      zIndex: -1,
      borderRadius: "inherit",
      pointerEvents: "none",
      transitionProperty: "background-color, box-shadow",
      transitionDuration: {
        default: motionVars["--honk-motion-duration-hover"],
        "@media (prefers-reduced-motion: reduce)": "0s",
      },
      transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    },
  },
  triggerNeutral: {
    minWidth: PICKER_FIELD_MIN_WIDTH,
    boxShadow: {
      default: elevationVars["--honk-elevation-button-neutral"],
      ":disabled": "none",
    },
    "::before": {
      backgroundColor: colorVars["--honk-color-bg-base"],
    },
    "::after": {
      backgroundColor: {
        default: "transparent",
        ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
        ":active": colorVars["--honk-color-state-press"],
        "[data-popup-open]": colorVars["--honk-color-state-hover"],
      },
      boxShadow: {
        default: elevationVars["--honk-elevation-button-highlight"],
        ":disabled": "none",
      },
    },
  },
  triggerQuiet: {
    "::before": {
      backgroundColor: {
        default: "transparent",
        ":hover": {
          "@media (hover: hover)": colorVars["--honk-color-state-hover"],
        },
        ":active": colorVars["--honk-color-state-press"],
        "[data-popup-open]": colorVars["--honk-color-state-hover"],
      },
    },
  },
  triggerSm: { height: controlVars["--honk-control-h-sm"] },
  triggerMd: { height: controlVars["--honk-control-h-md"] },
  triggerContent: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    gap: controlVars["--honk-control-gap"],
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  triggerChevron: {
    display: "inline-flex",
    flexShrink: 0,
    color: colorVars["--honk-color-text-muted"],
    transitionProperty: "transform",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    "[data-popup-open] &": { transform: "rotate(180deg)" },
  },
  positioner: {
    zIndex: zVars["--honk-z-menu"],
    minWidth: "var(--anchor-width)",
    maxWidth: "var(--available-width)",
  },
  positionerDialog: {
    zIndex: DIALOG_CHILD_Z_INDEX,
  },
  popup: {
    boxSizing: "border-box",
    maxWidth: controlVars["--honk-control-picker-max-w"],
    maxHeight: PICKER_POPUP_MAX_HEIGHT,
    padding: controlVars["--honk-control-menu-pad"],
    borderRadius: radiusVars["--honk-radius-menu"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${elevationVars["--honk-elevation-floating"]}, ${POPUP_RING}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    outline: "none",
    overflowY: "auto",
    transformOrigin: "var(--transform-origin)",
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    scale: {
      default: 1,
      "[data-starting-style]": motionVars["--honk-motion-scale-overlay"],
      "[data-ending-style]": motionVars["--honk-motion-scale-overlay"],
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity, scale",
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  popupTriggerWidth: {
    width: "max-content",
    minWidth: "var(--anchor-width)",
  },
  popupWide: { width: controlVars["--honk-control-picker-max-w"] },
  list: { outline: "none" },
  option: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    minHeight: controlVars["--honk-control-h-sm"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    borderRadius: radiusVars["--honk-radius-control"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: 1,
    userSelect: "none",
    outline: "none",
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--honk-color-state-hover"],
      "[data-selected]": colorVars["--honk-color-control-selected"],
    },
    color: colorVars["--honk-color-text-primary"],
    opacity: {
      default: 1,
      "[data-disabled]": controlVars["--honk-control-disabled-opacity"],
    },
  },
  // Two-line rows grow to fit; block padding, not a magic min-height, sets the rhythm.
  optionRich: { paddingBlock: controlVars["--honk-control-gap"] },
  optionLeading: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  optionContent: {
    display: "flex",
    minWidth: 0,
    flexGrow: 1,
    flexDirection: "column",
  },
  optionLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  optionDescription: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  optionMetadata: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  indicator: {
    display: "inline-flex",
    flexShrink: 0,
    marginInlineStart: "auto",
    color: colorVars["--honk-color-accent"],
  },
  groupLabel: {
    paddingInline: controlVars["--honk-control-pad-sm"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px is the compact transient-menu group-label inset; no spacing or control-padding token owns it
    paddingBlock: "3px",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    userSelect: "none",
  },
});

const triggerSizeStyles: Record<PickerSize, stylex.StyleXStyles> = {
  sm: sx.triggerSm,
  md: sx.triggerMd,
};

function PickerRoot({
  children,
  value,
  onValueChange,
  disabled,
  name,
}: PickerRootProps): React.ReactElement {
  return (
    <Base.Root
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={disabled}
      name={name}
    >
      {children}
    </Base.Root>
  );
}

function PickerTrigger({
  children,
  accessibilityLabel,
  size = "md",
  tone = "neutral",
  title,
}: PickerTriggerProps): React.ReactElement {
  return (
    <Base.Trigger
      aria-label={accessibilityLabel}
      title={title}
      data-slot="picker-trigger"
      {...stylex.props(
        sx.trigger,
        triggerSizeStyles[size],
        tone === "neutral" ? sx.triggerNeutral : sx.triggerQuiet,
      )}
    >
      <span {...stylex.props(sx.triggerContent)}>{children}</span>
      <span {...stylex.props(sx.triggerChevron)}>
        <Icon icon={IconChevronDownMedium} size="sm" />
      </span>
    </Base.Trigger>
  );
}

function PickerPopup({
  children,
  label,
  width = "trigger",
  layer = "menu",
  side = "bottom",
  align = "start",
}: PickerPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Positioner
        side={side}
        align={align}
        sideOffset={PICKER_GUTTER}
        collisionPadding={PICKER_COLLISION_PADDING}
        alignItemWithTrigger={false}
        {...stylex.props(sx.positioner, layer === "dialog" && sx.positionerDialog)}
      >
        <Base.Popup
          aria-label={label}
          data-slot="picker-popup"
          {...stylex.props(sx.popup, width === "wide" ? sx.popupWide : sx.popupTriggerWidth)}
        >
          <Base.List {...stylex.props(sx.list)}>{children}</Base.List>
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

function PickerOption({
  value,
  label,
  description,
  leading,
  metadata,
  disabled,
}: PickerOptionProps): React.ReactElement {
  return (
    <Base.Item
      value={value}
      label={label}
      disabled={disabled}
      data-slot="picker-option"
      {...stylex.props(sx.option, description !== undefined && sx.optionRich)}
    >
      {leading === undefined ? null : <span {...stylex.props(sx.optionLeading)}>{leading}</span>}
      <span {...stylex.props(sx.optionContent)}>
        <Base.ItemText {...stylex.props(sx.optionLabel)}>{label}</Base.ItemText>
        {description === undefined ? null : (
          <span {...stylex.props(sx.optionDescription)}>{description}</span>
        )}
      </span>
      {metadata === undefined ? null : <span {...stylex.props(sx.optionMetadata)}>{metadata}</span>}
      <Base.ItemIndicator {...stylex.props(sx.indicator)}>
        <Icon icon={IconCheckmark1} size="xs" />
      </Base.ItemIndicator>
    </Base.Item>
  );
}

function PickerGroup({ children }: PickerGroupProps): React.ReactElement {
  return <Base.Group>{children}</Base.Group>;
}

function PickerGroupLabel({ children }: PickerGroupLabelProps): React.ReactElement {
  return <Base.GroupLabel {...stylex.props(sx.groupLabel)}>{children}</Base.GroupLabel>;
}

const Picker: PickerCompound = {
  Root: PickerRoot,
  Trigger: PickerTrigger,
  Popup: PickerPopup,
  Option: PickerOption,
  Group: PickerGroup,
  GroupLabel: PickerGroupLabel,
};

export { Picker };
export type {
  PickerGroupLabelProps,
  PickerGroupProps,
  PickerOptionProps,
  PickerPopupLayer,
  PickerPopupProps,
  PickerPopupWidth,
  PickerRootProps,
  PickerSize,
  PickerTone,
  PickerTriggerProps,
} from "./picker.types";
