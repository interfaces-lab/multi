// Fusion policy: which arms fill the two seats at each stop, and the
// transcript marker that makes a session's fusion state durable. Every stop
// is the same machine — one main that orchestrates, one sidekick that
// executes — differing only in its arms (spec/honk-built-ins.md section 9;
// Devin Fusion is the published reference for the posture and the
// economics). The delegation mechanism lives in `./delegation`; this module
// is pure policy.

import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { Option, Schema } from "effect";

import { FusionStop } from "./contract";
import type { Arm } from "./subagents";

/** The wire vocabulary lives in the contract; this module owns the seating. */
export type Stop = FusionStop;

/** One stop's seating: the orchestrator arm and the executor arm. */
export interface Pairing {
  readonly stop: Stop;
  readonly main: Arm;
  readonly sidekick: Arm;
}

const sol = (thinkingLevel: Arm["thinkingLevel"]): Arm => ({
  model: { providerId: "openai-codex", modelId: "gpt-5.6-sol" },
  thinkingLevel,
});
const fable = (thinkingLevel: Arm["thinkingLevel"]): Arm => ({
  model: { providerId: "anthropic", modelId: "claude-fable-5" },
  thinkingLevel,
});

/**
 * The pairing catalog, total over {@link Stop} so a decoded stop always has
 * a seating and no caller carries a "stop without a pairing" branch. Two
 * stops share one orchestrator arm (low and medium both run Sol · high),
 * which is exactly why the fusion marker is authoritative on restore — the
 * stop cannot be recovered from the recorded model and level.
 */
export const PAIRINGS: Readonly<Record<Stop, Pairing>> = {
  low: {
    stop: "low",
    main: sol("high"),
    sidekick: {
      model: { providerId: "opencode-zen", modelId: "glm-5.2" },
      thinkingLevel: "medium",
    },
  },
  medium: { stop: "medium", main: sol("high"), sidekick: sol("medium") },
  high: { stop: "high", main: fable("high"), sidekick: sol("xhigh") },
  ultra: { stop: "ultra", main: fable("xhigh"), sidekick: sol("xhigh") },
  claw: {
    stop: "claw",
    main: fable("xhigh"),
    sidekick: {
      model: { providerId: "anthropic", modelId: "claude-opus-5" },
      thinkingLevel: "high",
    },
  },
};

/**
 * The host's seating: {@link PAIRINGS} with per-stop overrides applied.
 * Total by construction — an override replaces a stop's arms, never removes
 * the stop — so tests inject faux arms for the stops they exercise and every
 * other stop keeps the shipped seating (whose arms simply fail to resolve on
 * a host that cannot run them).
 */
export const seatingOf = (overrides?: readonly Pairing[]): Readonly<Record<Stop, Pairing>> =>
  overrides === undefined || overrides.length === 0
    ? PAIRINGS
    : {
        ...PAIRINGS,
        ...Object.fromEntries(overrides.map((pairing) => [pairing.stop, pairing])),
      };

/** The transcript record of fusion state. `stop: null` means fusion exited. */
export const MARKER = "honk.fusion";

const MarkerData = Schema.Struct({ stop: Schema.NullOr(FusionStop) });

/**
 * The transcript's fusion record: the last `honk.fusion` marker wins,
 * exactly as the model and thinking-level folds work. No marker and an
 * exited marker read the same — not a fusion session. A marker this build
 * cannot decode reads as exited rather than a guess: running an orchestrator
 * without its sidekick would be a silent substitution.
 */
export const fusionOf = (entries: readonly SessionTreeEntry[]): Stop | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "custom" && entry.customType === MARKER) {
      return Option.getOrNull(
        Option.map(Schema.decodeUnknownOption(MarkerData)(entry.data), (marker) => marker.stop),
      );
    }
  }
  return null;
};
