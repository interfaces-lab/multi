// The turn's single status organ (spec/conversation.md §5–§6). One surface
// that never unmounts, two states: while the turn runs it is a fixed-height
// ticker whose label swaps in place — outgoing floats up and fades, incoming
// rises in, and a finished tool stamps a ✓ before its label leaves. When the
// turn settles the same surface becomes the header: "Worked for 5m 16s", or
// "Stopped" / "Failed" when only the label tells the truth.

import { Icon, toolCallShimmer } from "@honk/ui";
import { IconCheckmark1 } from "@honk/ui/icons";
import { colorVars, conversationVars, fontVars, motionVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { TickerState, TurnView } from "./chat-model";

export const PLANNING_LABEL = "Planning next move";
const SLOW_LABEL = "Still working";

/**
 * A wait shorter than this is not worth naming: between two tools the window
 * would otherwise flash "Planning next move" for a frame and swap straight
 * back. Nothing shows until the pause is long enough to be a pause.
 */
export const PLANNING_REVEAL_MS = 200;
/** Past this the wait is the news, so the window says so and counts. */
export const PLANNING_SLOW_MS = 15_000;
/** How often the slow readout re-reads the clock. */
const SLOW_TICK_MS = 1_000;

// The label swap rides the expand motion token; SWAP_MS is the JS mirror that
// retires the outgoing label — it must match `--honk-motion-duration-expand`.
const SWAP_MS = 200;
// The ✓ beat is pure timing, no CSS: how long a finished tool's check holds
// the window before the next label enters.
const BEAT_MS = 260;
const FLOAT_DISTANCE = "7px";

const labelEnter = stylex.keyframes({
  from: { opacity: 0, transform: `translateY(${FLOAT_DISTANCE})` },
  to: { opacity: 1, transform: "translateY(0)" },
});

const labelLeave = stylex.keyframes({
  from: { opacity: 1, transform: "translateY(0)" },
  to: { opacity: 0, transform: `translateY(calc(-1 * ${FLOAT_DISTANCE}))` },
});

const styles = stylex.create({
  // The window is fixed height and clips: only text ever moves (spec §6).
  window: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    minHeight: conversationVars["--honk-conversation-row-min-h"],
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    paddingInline: conversationVars["--honk-conversation-inset"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
  },
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: conversationVars["--honk-conversation-row-gap"],
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: colorVars["--honk-color-fg-secondary"],
  },
  entering: {
    animationName: { default: labelEnter, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: {
      default: motionVars["--honk-motion-duration-expand"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
    animationFillMode: "backwards",
  },
  // The outgoing label overlays the incoming one so the window never grows.
  leaving: {
    position: "absolute",
    insetInlineStart: conversationVars["--honk-conversation-inset"],
    animationName: { default: labelLeave, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: {
      default: motionVars["--honk-motion-duration-expand"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
    animationFillMode: "forwards",
    pointerEvents: "none",
  },
  settled: {
    color: colorVars["--honk-color-fg-tertiary"],
  },
  stamp: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    color: colorVars["--honk-color-fg-secondary"],
  },
});

/**
 * The ticker's one line of text, or null when the window should hold its last
 * label — prose streams outside the window as ordinary markdown (spec §5).
 *
 * `waitedMs` is how long the planning pause has lasted, or null when there is
 * no epoch to measure from: a turn's opening thought is legitimately long and
 * says so at once, where a pause between two tools has to earn its label.
 */
export const tickerText = (ticker: TickerState, waitedMs: number | null = null): string | null => {
  switch (ticker.kind) {
    case "planning":
      if (waitedMs === null) return PLANNING_LABEL;
      if (waitedMs < PLANNING_REVEAL_MS) return null;
      return waitedMs >= PLANNING_SLOW_MS
        ? `${SLOW_LABEL} · ${formatWorkedFor(waitedMs)}`
        : PLANNING_LABEL;
    case "step":
      return ticker.detail === null ? ticker.verb : `${ticker.verb} ${ticker.detail}`;
    case "rollup":
      return `Read ${String(ticker.count)} files`;
    case "writing":
    case "idle":
      return null;
  }
};

/** "5m 16s" — the settled header's clock, whole seconds. */
export const formatWorkedFor = (durationMs: number): string => {
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(seconds)}s`;
};

/** A stopped or failed turn collapses like a finished one; only the label tells. */
export const settledLabel = (outcome: TurnView["outcome"], durationMs: number | null): string => {
  if (outcome === "stopped") return "Stopped";
  if (outcome === "failed") return "Failed";
  return durationMs === null ? "Done" : `Worked for ${formatWorkedFor(durationMs)}`;
};

// What the label on screen was showing: only a finished tool earns the ✓ beat.
type SlotKind = "planning" | "step" | "settled";

interface Slot {
  readonly key: number;
  readonly text: string;
  readonly kind: SlotKind;
}

export interface TurnStatusProps {
  readonly phase: "running" | "settled";
  readonly ticker: TickerState;
  readonly outcome: TurnView["outcome"];
  readonly durationMs: number | null;
}

export function TurnStatus({
  phase,
  ticker,
  outcome,
  durationMs,
}: TurnStatusProps): React.ReactElement {
  // The wait's own clock: it only runs while a planning pause is being
  // measured, and it stops as soon as the next label takes the window.
  const since = phase === "running" && ticker.kind === "planning" ? ticker.since : null;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (since === null) return;
    const reveal = window.setTimeout(() => {
      setNow(Date.now());
    }, PLANNING_REVEAL_MS);
    const tick = window.setInterval(() => {
      setNow(Date.now());
    }, SLOW_TICK_MS);
    return () => {
      window.clearTimeout(reveal);
      window.clearInterval(tick);
    };
  }, [since]);

  const targetText =
    phase === "settled"
      ? settledLabel(outcome, durationMs)
      : tickerText(ticker, since === null ? null : Math.max(0, now - since));
  const targetKind: SlotKind =
    phase === "settled"
      ? "settled"
      : ticker.kind === "step" || ticker.kind === "rollup"
        ? "step"
        : "planning";

  const [slots, setSlots] = React.useState<{
    readonly current: Slot;
    readonly leaving: Slot | null;
  }>(() => ({
    current: { key: 0, text: targetText ?? PLANNING_LABEL, kind: targetKind },
    leaving: null,
  }));
  const [stamped, setStamped] = React.useState(false);

  // Latest wins: a label arriving mid-beat is what the pending swap lands on.
  const pending = React.useRef({ text: targetText, kind: targetKind });
  pending.current = { text: targetText, kind: targetKind };

  const shownText = slots.current.text;
  const shownKind = slots.current.kind;
  React.useEffect(() => {
    if (targetText === null || targetText === shownText) return;
    const timers: number[] = [];
    const swap = () => {
      setStamped(false);
      setSlots(({ current }) => ({
        current: {
          key: current.key + 1,
          text: pending.current.text ?? current.text,
          kind: pending.current.kind,
        },
        leaving: current,
      }));
      timers.push(
        window.setTimeout(() => {
          setSlots((state) => (state.leaving === null ? state : { ...state, leaving: null }));
        }, SWAP_MS),
      );
    };
    if (shownKind === "step") {
      // The ✓ beat: the finished tool's shimmer stops and a check stamps
      // before the next label enters. Progress is shown, not implied (§6).
      setStamped(true);
      timers.push(window.setTimeout(swap, BEAT_MS));
    } else {
      swap();
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [targetText, targetKind, shownText, shownKind]);

  const settledNow = slots.current.kind === "settled";
  return (
    <div role="status" aria-label={slots.current.text} {...stylex.props(styles.window)}>
      {slots.leaving !== null && (
        <span
          key={slots.leaving.key}
          aria-hidden={true}
          {...stylex.props(
            styles.label,
            styles.leaving,
            slots.leaving.kind === "settled" && styles.settled,
          )}
        >
          {slots.leaving.text}
        </span>
      )}
      <span
        key={slots.current.key}
        aria-hidden={true}
        {...stylex.props(
          styles.label,
          slots.current.key > 0 && styles.entering,
          settledNow && styles.settled,
          !settledNow && !stamped && toolCallShimmer,
        )}
      >
        {stamped && (
          <span {...stylex.props(styles.stamp)}>
            <Icon icon={IconCheckmark1} size="xs" />
          </span>
        )}
        {slots.current.text}
      </span>
    </div>
  );
}
