// The pure delegation domains: target resolution, the result budget, link
// metadata, and the fusion marker fold. The effectful runner and the task
// tool are exercised in later slices; everything here is data in, decision
// out.

import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import { clipResult, linkOf, resolveTarget, RESULT_BUDGET } from "../../src/session/delegation";
import { fusionOf, PAIRINGS, seatingOf } from "../../src/session/fusion";
import { delegationPrompt, PRESETS, type Arm } from "../../src/session/subagents";

const marker = (id: string, data: unknown): SessionTreeEntry => ({
  type: "custom",
  id,
  parentId: null,
  timestamp: "2026-08-05T10:00:00.000Z",
  customType: "honk.fusion",
  data,
});

const userEntry = (id: string): SessionTreeEntry => ({
  type: "message",
  id,
  parentId: null,
  timestamp: "2026-08-05T10:00:00.000Z",
  message: { role: "user", content: "hi", timestamp: 0 },
});

describe("target resolution", () => {
  it("a preset name resolves to that preset from any primary", () => {
    const single = resolveTarget("oracle", { pairing: null, available: PRESETS });
    const fusion = resolveTarget("oracle", { pairing: PAIRINGS.high, available: PRESETS });
    for (const resolution of [single, fusion]) {
      expect("target" in resolution && resolution.target.kind).toBe("preset");
    }
  });

  it("fusion resolves sidekick to the stop's executor arm", () => {
    const resolution = resolveTarget("sidekick", { pairing: PAIRINGS.low, available: PRESETS });
    if (!("target" in resolution) || resolution.target.kind !== "sidekick") {
      throw new Error("expected a sidekick target");
    }
    expect(resolution.target.arm).toEqual(PAIRINGS.low.sidekick);
    expect(resolution.coercedFrom).toBeUndefined();
  });

  it("fusion coerces an invented name to the sidekick, and says so", () => {
    const resolution = resolveTarget("general", { pairing: PAIRINGS.ultra, available: PRESETS });
    if (!("target" in resolution)) throw new Error("expected a coerced target");
    expect(resolution.target.kind).toBe("sidekick");
    expect(resolution.coercedFrom).toBe("general");
  });

  it("a single-model primary's unknown name is refused with the valid list", () => {
    const resolution = resolveTarget("general", { pairing: null, available: PRESETS });
    if (!("refusal" in resolution)) throw new Error("expected a refusal");
    expect(resolution.refusal).toContain('unknown subagent_type "general"');
    for (const preset of PRESETS) expect(resolution.refusal).toContain(preset.name);
  });

  it("sidekick outside fusion is an unknown name, not a target", () => {
    const resolution = resolveTarget("sidekick", { pairing: null, available: PRESETS });
    expect("refusal" in resolution).toBe(true);
  });
});

describe("result budget", () => {
  it("returns an in-budget answer untouched", () => {
    expect(clipResult("done")).toBe("done");
  });

  it("clips an over-budget answer and points at the surviving transcript", () => {
    const clipped = clipResult("x".repeat(RESULT_BUDGET + 1));
    expect(clipped).toContain("x".repeat(100));
    expect(clipped).toContain("full transcript remains in its session");
    expect(clipped.length).toBeLessThan(RESULT_BUDGET + 200);
  });
});

describe("fusion marker fold", () => {
  it("the last marker wins", () => {
    const entries = [
      marker("f1", { stop: "low" }),
      userEntry("u1"),
      marker("f2", { stop: "ultra" }),
    ];
    expect(fusionOf(entries)).toBe("ultra");
  });

  it("an exit marker and no marker read the same", () => {
    expect(fusionOf([marker("f1", { stop: "high" }), marker("f2", { stop: null })])).toBeNull();
    expect(fusionOf([userEntry("u1")])).toBeNull();
  });

  it("an undecodable marker reads as exited, never a guess", () => {
    expect(fusionOf([marker("f1", { stop: "turbo" })])).toBeNull();
    expect(fusionOf([marker("f1", "junk")])).toBeNull();
  });

  it("two stops share one orchestrator arm, so the marker is authoritative", () => {
    const { low, medium } = PAIRINGS;
    expect(low.main).toEqual(medium.main);
    expect(low.sidekick).not.toEqual(medium.sidekick);
    expect(Object.keys(PAIRINGS)).toHaveLength(5);
  });
});

describe("seating", () => {
  it("routes pinned GPT arms through ChatGPT OAuth, not the Platform API", () => {
    const fusionArms = Object.values(PAIRINGS).flatMap((pairing) => [
      pairing.main,
      pairing.sidekick,
    ]);
    const gptArms = [...fusionArms, ...PRESETS.map((preset) => preset.arm)].filter((arm) =>
      arm.model.modelId.startsWith("gpt-"),
    );
    expect(gptArms.length).toBeGreaterThan(0);
    expect(gptArms.every((arm) => arm.model.providerId === "openai-codex")).toBe(true);
  });

  it("overlays per-stop overrides on the shipped seating, staying total", () => {
    const arm: Arm = {
      model: { providerId: "faux", modelId: "faux-model" },
      thinkingLevel: "low",
    };
    const seated = seatingOf([{ stop: "low", main: arm, sidekick: arm }]);
    expect(seated.low.main).toEqual(arm);
    expect(seated.medium).toBe(PAIRINGS.medium);
    expect(Object.keys(seated)).toHaveLength(5);
    expect(seatingOf(undefined)).toBe(PAIRINGS);
  });
});

describe("link metadata", () => {
  it("round-trips a delegation link and refuses everything else", () => {
    expect(linkOf({ delegationOf: "session-1", role: "sidekick" })).toEqual({
      delegationOf: "session-1",
      role: "sidekick",
    });
    expect(linkOf(undefined)).toBeNull();
    expect(linkOf({ delegationOf: "", role: "sidekick" })).toBeNull();
    expect(linkOf({ role: "sidekick" })).toBeNull();
  });
});

describe("delegation prompt", () => {
  it("teaches only the available presets, plus the sidekick under fusion", () => {
    const single = delegationPrompt(PRESETS.slice(0, 2), false);
    expect(single).toContain("- review:");
    expect(single).toContain("- search:");
    expect(single).not.toContain("- oracle:");
    expect(single).not.toContain("sidekick");

    const fusion = delegationPrompt(PRESETS, true);
    expect(fusion).toContain("- sidekick:");
  });
});
