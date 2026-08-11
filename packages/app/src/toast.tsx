// App toast viewport. No Toast primitive in @honk/ui yet.

import * as stylex from "@stylexjs/stylex";
import { Button, Icon, IconButton, Spinner, Text } from "@honk/ui";
import {
  colorVars,
  controlVars,
  elevationVars,
  motionVars,
  radiusVars,
  spaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";
import {
  IconCheckmark1,
  IconCircleCheck,
  IconClipboard,
  IconCrossSmall,
  IconExclamationCircle,
} from "@honk/ui/icons";
import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import {
  actions as toastActions,
  shouldRenderToast,
  useToasts,
  type ToastItem,
  type ToastType,
} from "./toast-store";

// Entrance slide offset. Motion geometry, not a spacing token.
const TOAST_ENTER_OFFSET = "12px";
// Caps the toast stack at a readable line length.
const TOAST_VIEWPORT_MAX_WIDTH = "340px";
// Copy confirmation hold. Interaction timing, not a motion token.
const COPY_CONFIRM_MS = 1500;

const enter = stylex.keyframes({
  from: {
    opacity: 0,
    transform: `translateY(${TOAST_ENTER_OFFSET})`,
  },
  to: {
    opacity: 1,
    transform: "translateY(0)",
  },
});

const styles = stylex.create({
  viewport: {
    position: "fixed",
    right: spaceVars["--honk-space-panel-pad"],
    bottom: spaceVars["--honk-space-panel-pad"],
    zIndex: zVars["--honk-z-toast"],
    display: "flex",
    flexDirection: "column-reverse",
    gap: spaceVars["--honk-space-gutter"],
    width: "100%",
    maxWidth: TOAST_VIEWPORT_MAX_WIDTH,
    pointerEvents: "none",
  },
  toast: {
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    width: "100%",
    padding: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: elevationVars["--honk-elevation-floating"],
    animationName: enter,
    animationDuration: motionVars["--honk-motion-duration-base"],
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
    animationFillMode: "both",
    "@media (prefers-reduced-motion: reduce)": {
      animationName: "none",
      animationDuration: "0s",
    },
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
    flexGrow: 1,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
  },
  iconSlot: {
    flexShrink: 0,
  },
  toneError: {
    color: colorVars["--honk-color-err-fg"],
  },
  toneSuccess: {
    color: colorVars["--honk-color-ok-fg"],
  },
  toneWarning: {
    color: colorVars["--honk-color-warn-fg"],
  },
  toneInfo: {
    color: colorVars["--honk-color-info-fg"],
  },
  toneLoading: {
    color: colorVars["--honk-color-text-muted"],
  },
});

function toneStyle(type: ToastType) {
  switch (type) {
    case "error":
      return styles.toneError;
    case "success":
      return styles.toneSuccess;
    case "warning":
      return styles.toneWarning;
    case "info":
      return styles.toneInfo;
    case "loading":
      return styles.toneLoading;
  }
}

function ToastTypeIcon(props: { type: ToastType }): React.ReactElement {
  const tone = toneStyle(props.type);
  if (props.type === "loading") {
    return (
      <span {...stylex.props(styles.iconSlot, tone)}>
        <Spinner size="sm" tone="muted" />
      </span>
    );
  }
  if (props.type === "success") {
    return (
      <span {...stylex.props(styles.iconSlot, tone)}>
        <Icon icon={IconCircleCheck} size="sm" tone="ok" />
      </span>
    );
  }
  if (props.type === "error") {
    return (
      <span {...stylex.props(styles.iconSlot, tone)}>
        <Icon icon={IconExclamationCircle} size="sm" tone="err" />
      </span>
    );
  }
  if (props.type === "warning") {
    // Curated set has no triangle glyph. Exclamation circle with warn tone.
    return (
      <span {...stylex.props(styles.iconSlot, tone)}>
        <Icon icon={IconExclamationCircle} size="sm" tone="warn" />
      </span>
    );
  }
  return (
    <span {...stylex.props(styles.iconSlot, tone)}>
      <Icon icon={IconExclamationCircle} size="sm" tone="info" />
    </span>
  );
}

// Copy confirmation is event-driven local state (click → setCopied), not an effect.
function CopyErrorButton(props: { text: string }): React.ReactElement {
  const [isCopied, setCopied] = React.useState(false);
  // Cleared on the next click so rapid copies do not leave a stale timeout.
  const timerRef = React.useRef<number | null>(null);

  return (
    <IconButton
      size="sm"
      variant="quiet"
      aria-label={isCopied ? "Copied" : "Copy error"}
      title={isCopied ? "Copied" : "Copy error"}
      onClick={() => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
        }
        void navigator.clipboard.writeText(props.text).then(
          () => {
            setCopied(true);
            timerRef.current = window.setTimeout(() => {
              setCopied(false);
              timerRef.current = null;
            }, COPY_CONFIRM_MS);
          },
          () => {
            setCopied(false);
          },
        );
      }}
    >
      <Icon
        icon={isCopied ? IconCheckmark1 : IconClipboard}
        size="sm"
        tone={isCopied ? "ok" : "muted"}
      />
    </IconButton>
  );
}

function ToastCard(props: { toast: ToastItem }): React.ReactElement {
  const { toast } = props;
  const copyText = toast.copyableError ?? (toast.type === "error" ? toast.description : undefined);

  return (
    <div {...stylex.props(styles.toast)} role="status" data-toast-type={toast.type}>
      <ToastTypeIcon type={toast.type} />
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.titleRow)}>
          <Text as="span" size="sm" weight="regular">
            {toast.title}
          </Text>
          {copyText !== undefined && copyText.length > 0 ? (
            <CopyErrorButton text={copyText} />
          ) : null}
        </div>
        {toast.description !== undefined && toast.description.length > 0 ? (
          <Text as="span" size="xs" tone="muted">
            {toast.description}
          </Text>
        ) : null}
        {toast.action !== undefined ? (
          <div {...stylex.props(styles.actions)}>
            <Button
              size="sm"
              variant="neutral"
              onClick={() => {
                toastActions.invokeAction(toast.id);
              }}
            >
              {toast.action.label}
            </Button>
          </div>
        ) : null}
      </div>
      <IconButton
        size="sm"
        variant="quiet"
        aria-label="Dismiss notification"
        title="Dismiss"
        onClick={() => {
          toastActions.dismiss(toast.id);
        }}
      >
        <Icon icon={IconCrossSmall} size="sm" tone="muted" />
      </IconButton>
    </div>
  );
}

function ToastViewport(): React.ReactElement | null {
  const { toasts } = useToasts();
  const activeSessionId = useRouterState({
    select: (state) =>
      state.location.pathname.startsWith("/chat/")
        ? state.location.pathname.slice("/chat/".length)
        : null,
  });
  const visible = toasts.filter((toast) => shouldRenderToast(toast, activeSessionId));

  if (visible.length === 0) {
    return null;
  }

  return (
    <div {...stylex.props(styles.viewport)} data-slot="toast-viewport" aria-live="polite">
      {visible.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

export { ToastViewport };
