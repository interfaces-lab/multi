// The root decides only which renderer owns the current route. Honk Core owns
// backend readiness and each core-backed surface renders its own state.

import * as stylex from "@stylexjs/stylex";
import { Button, Shell, Text } from "@honk/ui";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import {
  Outlet,
  useNavigate,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import * as React from "react";

import { useAppearanceTheme } from "./appearance-store";
import { reportDesktopAuthenticatedPaint, shouldUseDesktopGlass } from "./desktop-bridge";
import { ONBOARDING_PATH } from "./onboarding";
import { AppShell } from "./shell";

const schemeStyles: Record<"system" | "light" | "dark", React.CSSProperties> = {
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
};

const styles = stylex.create({
  status: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"],
    padding: spaceVars["--honk-space-panel-pad"],
    minHeight: 0,
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
  },
  statusCopy: {
    display: "grid",
    gap: spaceVars["--honk-space-gutter"],
  },
  details: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "auto",
    margin: 0,
    padding: 0,
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-caption"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
    alignItems: "center",
  },
});

export function RootGate(): React.ReactElement {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  React.useEffect(() => {
    reportDesktopAuthenticatedPaint();
  }, []);

  // Onboarding owns its whole canvas. Product routes render inside the one
  // application shell.
  if (pathname === ONBOARDING_PATH) {
    return <Outlet />;
  }
  return <AppShell />;
}

function errorDetails(error: unknown): string {
  const fallback = "No additional error details are available.";
  if (error instanceof Error) {
    const details = error.stack ?? error.message;
    return details.trim().length > 0 ? details : fallback;
  }
  const text = String(error);
  if (error === text) {
    return text.trim().length > 0 ? text : fallback;
  }
  try {
    const details = JSON.stringify(error, null, 2);
    return details !== undefined && details.trim().length > 0 ? details : fallback;
  } catch {
    return fallback;
  }
}

function StatusFrame(props: {
  readonly title: string;
  readonly description: string;
  readonly details?: string;
  readonly actions: React.ReactNode;
}): React.ReactElement {
  const theme = useAppearanceTheme();
  return (
    <Shell material={shouldUseDesktopGlass() ? "glass" : "solid"} style={schemeStyles[theme]}>
      <Shell.TitleBar />
      <Shell.Stage>
        <Shell.Sheet>
          <div {...stylex.props(styles.status)}>
            <div {...stylex.props(styles.statusCopy)}>
              <Text size="base" weight="semibold">
                {props.title}
              </Text>
              <Text size="sm" tone="muted">
                {props.description}
              </Text>
            </div>
            {props.details === undefined ? null : (
              <pre {...stylex.props(styles.details)}>{props.details}</pre>
            )}
            <div {...stylex.props(styles.actions)}>{props.actions}</div>
          </div>
        </Shell.Sheet>
      </Shell.Stage>
    </Shell>
  );
}

export function RootErrorView({ error }: ErrorComponentProps): React.ReactElement {
  const details = errorDetails(error);
  const [copyStatus, setCopyStatus] = React.useState<"idle" | "copied" | "failed">("idle");

  return (
    <StatusFrame
      title="Honk couldn't open this view"
      description="Reload the window. If it fails again, copy the error details for support."
      details={details}
      actions={
        <>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(details).then(
                () => setCopyStatus("copied"),
                () => setCopyStatus("failed"),
              );
            }}
          >
            {copyStatus === "copied"
              ? "Copied"
              : copyStatus === "failed"
                ? "Copy failed"
                : "Copy error details"}
          </Button>
        </>
      }
    />
  );
}

export function RootNotFoundView(): React.ReactElement {
  const navigate = useNavigate();
  return (
    <StatusFrame
      title="Page not found"
      description="This address doesn't belong to a Honk view."
      actions={
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void navigate({ to: "/" })}
        >
          Go home
        </Button>
      }
    />
  );
}
