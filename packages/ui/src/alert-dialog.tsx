// Confirm interrupt. Same modal surface as Dialog.

import { AlertDialog as Base } from "@base-ui/react/alert-dialog";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import {
  colorVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
  zVars,
} from "./tokens.stylex";

const DIALOG_ACTIONS_WIDE = "@media (min-width: 480px)";
const DIALOG_MAX_WIDTH = "512px";
const DIALOG_MAX_HEIGHT = "calc(100dvh - 32px)";
const DIALOG_WIDTH = "calc(100% - 32px)";

const RING_BASE = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;

const sx = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: zVars["--honk-z-dialog"],
    backgroundColor: colorVars["--honk-color-scrim"],
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    transitionProperty: "opacity",
    transitionTimingFunction: {
      default: motionVars["--honk-motion-ease-out"],
      "[data-ending-style]": motionVars["--honk-motion-ease-in"],
    },
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  // Plain-string translate avoids StyleX conditional-transform unknown typing.
  popup: {
    boxSizing: "border-box",
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    transformOrigin: "center",
    zIndex: zVars["--honk-z-dialog"],
    display: "flex",
    flexDirection: "column",
    rowGap: `calc(${spaceVars["--honk-space-panel-pad"]} * 2)`,
    width: DIALOG_WIDTH,
    maxWidth: DIALOG_MAX_WIDTH,
    maxHeight: DIALOG_MAX_HEIGHT,
    overflowY: "auto",
    padding: `calc(${spaceVars["--honk-space-panel-pad"]} * 2)`,
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${RING_BASE}, ${elevationVars["--honk-elevation-overlay"]}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    outline: "none",
    willChange: "transform, opacity",
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
    transitionTimingFunction: {
      default: motionVars["--honk-motion-ease-out"],
      "[data-ending-style]": motionVars["--honk-motion-ease-in"],
    },
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  header: {
    display: "flex",
    flexDirection: "column",
    rowGap: spaceVars["--honk-space-gutter"],
  },
  title: {
    margin: 0,
    fontSize: fontVars["--honk-text-heading"],
    lineHeight: fontVars["--honk-leading-heading"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
    color: colorVars["--honk-color-text-primary"],
  },
  description: {
    margin: 0,
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    color: colorVars["--honk-color-text-muted"],
  },
  footer: {
    display: "flex",
    flexDirection: {
      default: "column-reverse",
      [DIALOG_ACTIONS_WIDE]: "row",
    },
    alignItems: {
      default: "stretch",
      [DIALOG_ACTIONS_WIDE]: "center",
    },
    justifyContent: "flex-end",
    gap: spaceVars["--honk-space-panel-pad"],
  },
});

interface AlertDialogPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogPopup({ style, children, ...rest }: AlertDialogPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Backdrop data-slot="alert-dialog-backdrop" {...stylex.props(sx.backdrop)} />
      <Base.Popup {...rest} data-slot="alert-dialog" {...applyStyle(stylex.props(sx.popup), style)}>
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}

interface AlertDialogTitleProps extends Omit<Base.Title.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogTitle({ style, ...rest }: AlertDialogTitleProps): React.ReactElement {
  return (
    <Base.Title
      {...rest}
      data-slot="alert-dialog-title"
      {...applyStyle(stylex.props(sx.title), style)}
    />
  );
}

interface AlertDialogDescriptionProps extends Omit<Base.Description.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogDescription({
  style,
  ...rest
}: AlertDialogDescriptionProps): React.ReactElement {
  return (
    <Base.Description
      {...rest}
      data-slot="alert-dialog-description"
      {...applyStyle(stylex.props(sx.description), style)}
    />
  );
}

interface AlertDialogHeaderProps extends Omit<
  React.ComponentPropsWithoutRef<"div">,
  "className" | "style"
> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogHeader({ style, ...rest }: AlertDialogHeaderProps): React.ReactElement {
  return (
    <div
      {...rest}
      data-slot="alert-dialog-header"
      {...applyStyle(stylex.props(sx.header), style)}
    />
  );
}

interface AlertDialogFooterProps extends Omit<
  React.ComponentPropsWithoutRef<"div">,
  "className" | "style"
> {
  style?: StyleProp<HonkStyle>;
}

function AlertDialogFooter({ style, ...rest }: AlertDialogFooterProps): React.ReactElement {
  return (
    <div
      {...rest}
      data-slot="alert-dialog-footer"
      {...applyStyle(stylex.props(sx.footer), style)}
    />
  );
}

const AlertDialog = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: AlertDialogPopup,
  Title: AlertDialogTitle,
  Description: AlertDialogDescription,
  Header: AlertDialogHeader,
  Footer: AlertDialogFooter,
  Close: Base.Close,
};

export { AlertDialog };
export type {
  AlertDialogDescriptionProps,
  AlertDialogFooterProps,
  AlertDialogHeaderProps,
  AlertDialogPopupProps,
  AlertDialogTitleProps,
};
