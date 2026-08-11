import * as stylex from "@stylexjs/stylex";
import { IconButton, Text } from "@honk/ui";
import {
  colorVars,
  controlVars,
  elevationVars,
  iconVars,
  radiusVars,
  spaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import {
  actions as toastActions,
  shouldRenderToast,
  useToasts,
  type ToastItem,
} from "./toast-store";

const DeferredToastViewport = React.lazy(() =>
  import("./toast").then((module) => ({ default: module.ToastViewport })),
);

// The visual viewport and its fallback share the same permanent 340px line-length cap.
const TOAST_VIEWPORT_MAX_WIDTH = "340px";

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
  },
  icon: {
    width: iconVars["--honk-icon-size-sm"],
    height: iconVars["--honk-icon-size-sm"],
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
    flexGrow: 1,
  },
});

function ToastViewportHost(): React.ReactElement | null {
  const { toasts } = useToasts();
  const activeSessionId = useRouterState({
    select: (state) =>
      state.location.pathname.startsWith("/chat/")
        ? state.location.pathname.slice("/chat/".length)
        : null,
  });
  const visible = toasts.filter((toast) => shouldRenderToast(toast, activeSessionId));

  if (visible.length === 0) return null;
  return (
    <React.Suspense fallback={<ToastViewportLoading toasts={visible} />}>
      <DeferredToastViewport />
    </React.Suspense>
  );
}

function ToastViewportLoading(props: {
  readonly toasts: readonly ToastItem[];
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.viewport)} data-slot="toast-viewport" aria-live="polite">
      {props.toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          data-toast-type={toast.type}
          {...stylex.props(styles.toast)}
        >
          <span aria-hidden="true" {...stylex.props(styles.icon)} />
          <div {...stylex.props(styles.body)}>
            <Text as="span" size="sm" weight="regular">
              {toast.title}
            </Text>
            {toast.description !== undefined && toast.description.length > 0 ? (
              <Text as="span" size="xs" tone="muted">
                {toast.description}
              </Text>
            ) : null}
          </div>
          <IconButton
            size="sm"
            variant="quiet"
            aria-label="Dismiss notification"
            title="Dismiss"
            onClick={() => toastActions.dismiss(toast.id)}
          >
            <span aria-hidden="true" {...stylex.props(styles.icon)} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

export { ToastViewportHost };
