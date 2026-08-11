// The onboarding window, router-free: main.tsx renders this straight from its
// own chunk on first run, before the application graph exists. The routed
// /setup replay wraps it in onboarding.tsx.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { OnboardingLayout } from "./onboarding-layout";

// Only the titlebar strip drags: a full-window drag region hands every pointer
// event to the OS, and index.css's no-drag opt-outs assume a strip.
const DRAG_STRIP_HEIGHT = "40px";

const styles = stylex.create({
  canvas: {
    position: "fixed",
    inset: 0,
    overflow: "hidden",
    colorScheme: "light",
    outline: "none",
  },
  dragStrip: {
    position: "absolute",
    insetBlockStart: 0,
    insetInline: 0,
    height: DRAG_STRIP_HEIGHT,
  },
});

export function OnboardingCanvas(props: {
  /** Escape leaves through this; undefined on first run, which has no exit yet. */
  readonly onEscape?: (() => void) | undefined;
}): React.ReactElement {
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const { onEscape } = props;

  // Nothing on the canvas can hold focus yet, so the canvas takes it — without
  // this, Escape on a replay would land on <body> and never reach the handler.
  React.useEffect(() => {
    canvasRef.current?.focus();
  }, []);

  return (
    <div
      ref={canvasRef}
      tabIndex={-1}
      {...stylex.props(styles.canvas)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && onEscape !== undefined) {
          event.preventDefault();
          onEscape();
        }
      }}
    >
      <OnboardingLayout />
      <div aria-hidden={true} data-shell-drag-region="" {...stylex.props(styles.dragStrip)} />
    </div>
  );
}
