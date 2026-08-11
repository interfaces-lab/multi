// The recurring onboarding layout: every page splits the window in half — the
// art column on the left, the page's content on the white column at right.
//
// The art is not an asset. It is an abstract gear train written by math: three
// gears drawn only as perfectly circular fans of radial lines. The rule of
// this gear world is that meshing gears sink exactly halfway into each other's
// lines — which makes each ring's midline a true pitch circle, so real gear
// math supplies the rest: center distances are sums of pitch radii, rotation
// speeds are locked to tooth counts, and phases are solved so the lines
// interleave like teeth and never cross.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

// ---------------------------------------------------------------------------
// Gear math
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

type Vec = { readonly x: number; readonly y: number };

/** A fan of radial lines between a hole circle and an outer circle. */
type Ring = {
  readonly outer: number;
  readonly hole: number;
  readonly teeth: number;
};

/** The midline of the band — where this ring meshes with a neighbor. */
const pitchRadius = (ring: Ring): number => (ring.outer + ring.hole) / 2;
const toothSpacing = (ring: Ring): number => 360 / ring.teeth;

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (v: Vec, s: number): Vec => ({ x: v.x * s, y: v.y * s });
const bearingDeg = (from: Vec, to: Vec): number => Math.atan2(to.y - from.y, to.x - from.x) / DEG;
const frac = (v: number): number => ((v % 1) + 1) % 1;

type SpinDir = 1 | -1;

/**
 * Where the contact bearing falls inside a ring's tooth cycle, as a fraction
 * of one tooth. Two meshed rings interleave — teeth arriving at the contact
 * point strictly alternately — exactly when their fractions differ by ½.
 */
export function toothFraction(
  bearing: number,
  phase: number,
  spin: SpinDir,
  spacing: number,
): number {
  return frac((spin * (bearing - phase)) / spacing);
}

/** Solve the driven ring's phase so its fraction sits ½ from the driver's. */
export function meshedPhase(
  bearing: number,
  spin: SpinDir,
  spacing: number,
  driverFraction: number,
): number {
  return bearing - spin * spacing * (driverFraction + 0.5);
}

// ---------------------------------------------------------------------------
// The train
// ---------------------------------------------------------------------------

// Every ring is dialed by two circles: its hole and its outer edge. The holes
// are large on purpose — a thin band between them reads as gear, not sun.
// Tooth counts keep one shared circular pitch (pitchRadius / teeth = 3 for
// every ring); that shared pitch is what lets the whole train mesh.
const S_RING: Ring = { outer: 70, hole: 50, teeth: 20 }; // pitch 60
const M_OUTER: Ring = { outer: 108, hole: 84, teeth: 32 }; // pitch 96
const M_INNER: Ring = { outer: 56, hole: 40, teeth: 16 }; // pitch 48
const L_RING: Ring = { outer: 156, hole: 132, teeth: 48 }; // pitch 144

const VIEW: { readonly w: number; readonly h: number } = { w: 640, h: 800 };

// The large gear is the rightmost: its outer circle stops 96 in from the edge.
const L_EDGE_INSET = 96;
const L_CENTER: Vec = { x: VIEW.w - L_EDGE_INSET - L_RING.outer, y: 470 };

// Unit directions choose the diagonal composition; the distances between
// centers are not composition choices — they are sums of pitch radii, which
// is the halfway-overlap rule.
const L_TO_M: Vec = { x: -Math.sqrt(3) / 2, y: -1 / 2 }; // 30° above horizontal
const M_TO_S: Vec = { x: -3 / 5, y: -4 / 5 }; // steeper, a 3-4-5 slope

const M_CENTER = add(L_CENTER, scale(L_TO_M, pitchRadius(L_RING) + pitchRadius(M_INNER)));
const S_CENTER = add(M_CENTER, scale(M_TO_S, pitchRadius(M_OUTER) + pitchRadius(S_RING)));

// The middle double gear drives both neighbors, so neighbors counter-rotate.
// Periods are locked to pitch radii: every meshed pair moves at the same
// pitch-line speed, so a mesh that interleaves at t = 0 interleaves forever.
// These numbers are mirrored as literals in the animation styles below.
const SPIN_M: SpinDir = 1;
const SPIN_S: SpinDir = -1;
const SPIN_L: SpinDir = -1;
export const M_PERIOD_S = 48;
export const S_PERIOD_S = (M_PERIOD_S * pitchRadius(S_RING)) / pitchRadius(M_OUTER); // 30
export const L_PERIOD_S = (M_PERIOD_S * pitchRadius(L_RING)) / pitchRadius(M_INNER); // 144

// Phases: the middle gear is the reference at phase 0; each neighbor is solved
// so its teeth pass the contact point exactly between the driver's.
const PHASE_M = 0;
const PHASE_S = meshedPhase(
  bearingDeg(S_CENTER, M_CENTER),
  SPIN_S,
  toothSpacing(S_RING),
  toothFraction(bearingDeg(M_CENTER, S_CENTER), PHASE_M, SPIN_M, toothSpacing(M_OUTER)),
);
const PHASE_L = meshedPhase(
  bearingDeg(L_CENTER, M_CENTER),
  SPIN_L,
  toothSpacing(L_RING),
  toothFraction(bearingDeg(M_CENTER, L_CENTER), PHASE_M, SPIN_M, toothSpacing(M_INNER)),
);

type TrainRing = Ring & { readonly phase: number };
type Gear = {
  readonly center: Vec;
  readonly spin: SpinDir;
  readonly periodS: number;
  readonly rings: readonly TrainRing[];
};

/** The whole scene as data, exported so tests can hold the math to its rules. */
export const TRAIN: { readonly s: Gear; readonly m: Gear; readonly l: Gear } = {
  s: {
    center: S_CENTER,
    spin: SPIN_S,
    periodS: S_PERIOD_S,
    rings: [{ ...S_RING, phase: PHASE_S }],
  },
  m: {
    center: M_CENTER,
    spin: SPIN_M,
    periodS: M_PERIOD_S,
    rings: [
      { ...M_OUTER, phase: PHASE_M },
      { ...M_INNER, phase: PHASE_M },
    ],
  },
  l: {
    center: L_CENTER,
    spin: SPIN_L,
    periodS: L_PERIOD_S,
    rings: [{ ...L_RING, phase: PHASE_L }],
  },
};

/** Which ring meshes with which, for tests: [gear, ring index] pairs. */
type GearRing = readonly [gear: "s" | "m" | "l", ringIndex: number];
type GearMesh = { readonly a: GearRing; readonly b: GearRing };

export const MESHES: readonly GearMesh[] = [
  { a: ["m", 0], b: ["s", 0] },
  { a: ["m", 1], b: ["l", 0] },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// The art panel's palette is deliberately not Honk's: drafting paper and ink.
const PAPER = "#f2eee3";
const INK = "#26221a";
const LINE_WIDTH = 1.5;

// Floating-panel variant (picker scaffolding): the white canvas as a card over
// full-bleed art, capped so it never touches the window edges.
const FLOAT_CARD_WIDTH = "min(560px, calc(100% - 96px))";
const FLOAT_CARD_HEIGHT = "min(640px, calc(100% - 96px))";

const spinCw = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const spinCcw = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(-360deg)" },
});

const styles = stylex.create({
  root: {
    position: "absolute",
    inset: 0,
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
  },
  art: {
    overflow: "hidden",
    // oxlint-disable-next-line honk/design-no-raw-values -- the art column is drafting paper by design direction, deliberately outside Honk's themed surface ramp
    backgroundColor: PAPER,
  },
  artSvg: {
    display: "block",
    width: "100%",
    height: "100%",
  },
  content: {
    position: "relative",
    overflow: "auto",
    // oxlint-disable-next-line honk/design-no-raw-values -- the content column is the literal white canvas the new onboarding is designed on, outside the themed surface ramp
    backgroundColor: "#fff",
  },
  // Layout-variant styles below are ui.sh picker scaffolding; the unselected
  // ones are removed once a layout is chosen.
  rootRail: {
    gridTemplateColumns: "2fr 3fr",
  },
  artFill: {
    position: "absolute",
    inset: 0,
  },
  floatRoot: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
  },
  floatCard: {
    position: "relative",
    overflow: "auto",
    width: FLOAT_CARD_WIDTH,
    height: FLOAT_CARD_HEIGHT,
    // oxlint-disable-next-line honk/design-no-raw-values -- picker variant scaffolding: the floating panel is the same literal white canvas, removed if unselected
    backgroundColor: "#fff",
    // oxlint-disable-next-line honk/design-no-raw-values -- picker variant scaffolding: bespoke panel radius pending layout selection
    borderRadius: "16px",
    // oxlint-disable-next-line honk/design-no-raw-values -- picker variant scaffolding: bespoke panel shadow pending layout selection
    boxShadow: "0 24px 64px rgba(38, 34, 26, 0.22)",
  },
  spin: {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  gearS: {
    animationName: {
      default: spinCcw,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    // oxlint-disable-next-line honk/design-no-raw-values -- gear-train period, ratio-locked to S_PERIOD_S so the mesh never drifts; an ambient film far past the interaction ramp
    animationDuration: "30s",
  },
  gearM: {
    animationName: {
      default: spinCw,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    // oxlint-disable-next-line honk/design-no-raw-values -- gear-train period, ratio-locked to M_PERIOD_S so the mesh never drifts; an ambient film far past the interaction ramp
    animationDuration: "48s",
  },
  gearL: {
    animationName: {
      default: spinCcw,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    // oxlint-disable-next-line honk/design-no-raw-values -- gear-train period, ratio-locked to L_PERIOD_S so the mesh never drifts; an ambient film far past the interaction ramp
    animationDuration: "144s",
  },
});

function RingLines({ ring }: { readonly ring: TrainRing }): React.ReactElement {
  const spacing = toothSpacing(ring);
  return (
    <>
      {Array.from({ length: ring.teeth }, (_, k) => {
        const angle = (ring.phase + k * spacing) * DEG;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return (
          <line
            key={k}
            x1={ring.hole * cos}
            y1={ring.hole * sin}
            x2={ring.outer * cos}
            y2={ring.outer * sin}
          />
        );
      })}
    </>
  );
}

function GearGroup({
  gear,
  spinStyle,
}: {
  readonly gear: Gear;
  readonly spinStyle: stylex.StyleXStyles;
}): React.ReactElement {
  return (
    <g transform={`translate(${gear.center.x} ${gear.center.y})`}>
      <g {...stylex.props(styles.spin, spinStyle)}>
        {gear.rings.map((ring, index) => (
          <RingLines key={index} ring={ring} />
        ))}
      </g>
    </g>
  );
}

function GearTrain({
  ink = INK,
  opacity = 1,
}: {
  readonly ink?: string;
  readonly opacity?: number;
}): React.ReactElement {
  return (
    <svg
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      preserveAspectRatio="xMidYMid slice"
      {...stylex.props(styles.artSvg)}
    >
      <g stroke={ink} strokeWidth={LINE_WIDTH} strokeLinecap="round" opacity={opacity}>
        <GearGroup gear={TRAIN.s} spinStyle={styles.gearS} />
        <GearGroup gear={TRAIN.m} spinStyle={styles.gearM} />
        <GearGroup gear={TRAIN.l} spinStyle={styles.gearL} />
      </g>
    </svg>
  );
}

function ArtPanel({ fill }: { readonly fill?: boolean }): React.ReactElement {
  return (
    <div aria-hidden={true} {...stylex.props(styles.art, fill === true && styles.artFill)}>
      <GearTrain />
    </div>
  );
}

/**
 * The recurring onboarding frame: the generative art plus the white canvas the
 * pages render on. Currently annotated with ui.sh picker options to choose the
 * arrangement; the wrappers are plain because every variant root positions
 * itself absolutely, so they cannot affect layout.
 */
export function OnboardingLayout({
  children,
}: {
  readonly children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div data-uidotsh-pick="Onboarding layout">
      <div data-uidotsh-option="Split — art left (current)">
        <div {...stylex.props(styles.root)}>
          <ArtPanel />
          <div {...stylex.props(styles.content)}>{children}</div>
        </div>
      </div>
      <div data-uidotsh-option="Split — art right" hidden>
        <div {...stylex.props(styles.root)}>
          <div {...stylex.props(styles.content)}>{children}</div>
          <ArtPanel />
        </div>
      </div>
      <div data-uidotsh-option="Art rail — narrower art, wider canvas" hidden>
        <div {...stylex.props(styles.root, styles.rootRail)}>
          <ArtPanel />
          <div {...stylex.props(styles.content)}>{children}</div>
        </div>
      </div>
      <div data-uidotsh-option="Full-bleed art — floating white panel" hidden>
        <div {...stylex.props(styles.floatRoot)}>
          <ArtPanel fill={true} />
          <div {...stylex.props(styles.floatCard)}>{children}</div>
        </div>
      </div>
    </div>
  );
}
