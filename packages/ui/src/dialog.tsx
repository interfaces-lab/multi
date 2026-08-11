// Centered modal over a scrim. Unanchored popup grows from its own center.

import { Dialog as Base } from "@base-ui/react/dialog";
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
const DIALOG_MAX_HEIGHT = "calc(100dvh - 32px)";
const DIALOG_MAX_WIDTH = "512px";
const DIALOG_WIDTH = "calc(100% - 32px)";
const RING_BASE = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;

const sx = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: colorVars["--honk-color-scrim"],
    zIndex: zVars["--honk-z-dialog"],
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
  popup: {
    boxSizing: "border-box",
    position: "fixed",
    left: "50%",
    top: "50%",
    // Non-conditional translate avoids StyleX conditional-transform unknown typing.
    transform: "translate(-50%, -50%)",
    // Popup must set the same z-index as the scrim. auto would paint under the scrim.
    zIndex: zVars["--honk-z-dialog"],
    width: DIALOG_WIDTH,
    maxWidth: DIALOG_MAX_WIDTH,
    maxHeight: DIALOG_MAX_HEIGHT,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: `calc(${spaceVars["--honk-space-panel-pad"]} * 2)`,
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
    transformOrigin: "center",
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
  header: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
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

interface DialogPopupProps extends Omit<Base.Popup.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogPopup({ style, children, ...rest }: DialogPopupProps): React.ReactElement {
  return (
    <Base.Portal>
      <Base.Backdrop data-slot="dialog-backdrop" {...stylex.props(sx.backdrop)} />
      <Base.Popup {...rest} data-slot="dialog" {...applyStyle(stylex.props(sx.popup), style)}>
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}

interface DialogTitleProps extends Omit<Base.Title.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogTitle({ style, ...rest }: DialogTitleProps): React.ReactElement {
  return (
    <Base.Title {...rest} data-slot="dialog-title" {...applyStyle(stylex.props(sx.title), style)} />
  );
}

interface DialogDescriptionProps extends Omit<Base.Description.Props, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogDescription({ style, ...rest }: DialogDescriptionProps): React.ReactElement {
  return (
    <Base.Description
      {...rest}
      data-slot="dialog-description"
      {...applyStyle(stylex.props(sx.description), style)}
    />
  );
}

interface DialogHeaderProps extends Omit<React.ComponentProps<"div">, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogHeader({ style, ...rest }: DialogHeaderProps): React.ReactElement {
  return (
    <div {...rest} data-slot="dialog-header" {...applyStyle(stylex.props(sx.header), style)} />
  );
}

interface DialogFooterProps extends Omit<React.ComponentProps<"div">, "className" | "style"> {
  style?: StyleProp<HonkStyle>;
}

function DialogFooter({ style, ...rest }: DialogFooterProps): React.ReactElement {
  return (
    <div {...rest} data-slot="dialog-footer" {...applyStyle(stylex.props(sx.footer), style)} />
  );
}

const Dialog = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Header: DialogHeader,
  Footer: DialogFooter,
  Close: Base.Close,
};

export { Dialog };
export type {
  DialogDescriptionProps,
  DialogFooterProps,
  DialogHeaderProps,
  DialogPopupProps,
  DialogTitleProps,
};
