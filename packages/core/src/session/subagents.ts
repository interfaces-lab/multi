// The subagent catalog: who a session may delegate to, on what arm, with
// which role prompt. Capability data only — the delegation mechanism lives
// in `./delegation`, the fusion pairing policy in `./fusion`, and the
// effectful wiring in `./service`.
//
// Every preset is read-only by rule, not by table: its harness is
// constructed with read-shaped tools and nothing else (spec/honk-built-ins.md
// section 9, "Capability by construction"). The one writing subagent is
// fusion's sidekick, which is not a preset — it has no role of its own
// beyond the pairing that names its arm.

import type { Models } from "../models";
import type { ThinkingLevel } from "./contract";

/** One model seat: which model, thinking how hard. */
export interface Arm {
  readonly model: Models.ModelRef;
  readonly thinkingLevel: ThinkingLevel;
}

export type PresetName = "review" | "search" | "oracle" | "opus" | "librarian";

/**
 * An invocable helper with a pinned arm and a role prompt — never a
 * user-selectable model. The description doubles as the delegation prompt's
 * teaching row, so it is written for the model, not for chrome.
 */
export interface Preset {
  readonly name: PresetName;
  readonly label: string;
  readonly description: string;
  readonly arm: Arm;
  /** Constructed into the child harness as its system prompt. */
  readonly prompt: string;
}

/**
 * The shipped catalog. Arms are policy data resolved against the live
 * catalog at use — a preset whose model the catalog cannot resolve is
 * absent from the delegation list rather than present and broken
 * (spec/honk-built-ins.md section 9).
 */
export const PRESETS: readonly Preset[] = [
  {
    name: "review",
    label: "Review",
    description: "Bug identification and code-review assistance.",
    arm: {
      model: { providerId: "openai-codex", modelId: "gpt-5.5" },
      thinkingLevel: "medium",
    },
    prompt:
      "Review the referenced code for bugs, regressions, and risky patterns. Verify each finding against the actual code before reporting it, cite file references with severity, and do not edit files.",
  },
  {
    name: "search",
    label: "Search",
    description: "Fast investigation and analysis across code and documentation.",
    arm: {
      model: { providerId: "openai-codex", modelId: "gpt-5.6-luna" },
      thinkingLevel: "max",
    },
    prompt:
      "Investigate the delegated problem using the repository and available research tools. Trace the relevant files, symbols, call sites, behavior, and documentation; analyze what they imply; and return a concise answer with precise references. Do not edit files.",
  },
  {
    name: "oracle",
    label: "Oracle",
    description: "Complex reasoning and planning on code.",
    arm: {
      model: { providerId: "openai-codex", modelId: "gpt-5.6-sol" },
      thinkingLevel: "high",
    },
    prompt:
      "Reason deeply about the referenced code. Produce plans, trade-off analyses, and design guidance grounded in what the code actually does. Do not edit files.",
  },
  {
    name: "opus",
    label: "Opus",
    description: "Frontier second opinion on hard or ambiguous problems.",
    arm: { model: { providerId: "anthropic", modelId: "claude-opus-5" }, thinkingLevel: "high" },
    prompt:
      "Give a rigorous second opinion on the referenced problem. Check the reasoning against what the code actually does, state where you disagree and why, and call out the assumptions the answer rests on. Do not edit files.",
  },
  {
    name: "librarian",
    label: "Librarian",
    description: "Large-scale retrieval and research on external code.",
    arm: {
      model: { providerId: "openai-codex", modelId: "gpt-5.6-sol" },
      thinkingLevel: "medium",
    },
    prompt:
      "Research external code and documentation at scale. Summarize findings with sources and exact references. Do not edit files.",
  },
];

/** The writing sidekick's role prompt, constructed into its harness. */
export const SIDEKICK_PROMPT =
  "Execute the delegated task end to end with repository tools. Do not delegate, preserve unrelated changes, and verify the result. Work in reviewable increments, never stop to ask a question — state the assumption and proceed — and finish with a report of changed files, checks run, and anything left incomplete.";

/**
 * The system-prompt paragraph that teaches the catalog. The task tool's
 * description is static and cannot enumerate targets, so this text is the
 * discovery mechanism — the same static-surface, dynamic-knowledge pattern
 * as the MCP proxy. Only resolvable presets appear; a fusion session adds
 * its sidekick line.
 */
export const delegationPrompt = (available: readonly Preset[], sidekick: boolean): string =>
  [
    "Delegation: the task tool runs one of these subagents. Valid subagent_type values:",
    ...available.map((preset) => `- ${preset.name}: ${preset.description}`),
    ...(sidekick
      ? [
          "- sidekick: your paired executor. Delegate implementation work to it by default; keep the plan, the interpretation of ambiguity, and the final review.",
        ]
      : []),
  ].join("\n");
