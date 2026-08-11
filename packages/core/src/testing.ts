// Deterministic session fixtures on Pi's own faux provider: the real
// AgentHarness and transcript machinery with only the LLM call faked. Shared
// by core, desktop, and app tests; never imported by production paths.

import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MessageEntry, SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import type { FauxModelDefinition, FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { Effect, Layer } from "effect";

import { Commands } from "./commands";
import { Git } from "./git";
import { Mcp } from "./mcp";
import { Models } from "./models";
import { createNodeExecutionEnv } from "./node";
import { Resources } from "./resources";
import { Session } from "./session";
import { Skills } from "./skills";
import { Workspace } from "./workspace";

// Tests run in Node, so they use Pi's real Node environment rather than a
// stub: file and git built-ins are only meaningfully tested against a real
// filesystem.
export const createExecutionEnv = createNodeExecutionEnv;

// A fresh host data directory per call: persistence tests get isolation for
// free, and nothing leaks between suites through a shared store.
export const createTestStorage = () =>
  createExecutionEnv(mkdtempSync(join(tmpdir(), "honk-data-")));

/** Offline title generator for host tests whose faux queue is reserved for conversation turns. */
export const generatePromptSessionTitle = Session.generatePromptSessionTitle;

export const makeFauxSessionLayer = (
  options: {
    readonly presets?: "faux";
    readonly models?: readonly FauxModelDefinition[];
    readonly generateTitle?: Session.GenerateSessionTitle;
  } = {},
) => {
  const faux = fauxProvider(options.models === undefined ? {} : { models: [...options.models] });
  const collection = createModels();
  collection.setProvider(faux.provider);
  const storage = createTestStorage();
  // Delegation tests need presets whose arms the faux catalog resolves; the
  // shipped catalog's arms do not, so by default sessions get no task tool
  // and every existing fixture behaves exactly as before.
  const fauxModel = faux.getModel();
  const fauxArm: Session.Arm = {
    model: { providerId: fauxModel.provider, modelId: fauxModel.id },
    thinkingLevel: "low",
  };
  // Two faux stops sharing one orchestrator arm, so restore tests can prove
  // the marker is authoritative where the arms cannot be.
  const pairings: readonly Session.Pairing[] | undefined =
    options.presets === "faux"
      ? [
          { stop: "low", main: fauxArm, sidekick: { ...fauxArm, thinkingLevel: "medium" } },
          { stop: "medium", main: fauxArm, sidekick: { ...fauxArm, thinkingLevel: "high" } },
        ]
      : undefined;
  const presets: readonly Session.Preset[] | undefined =
    options.presets === "faux"
      ? [
          {
            name: "review",
            label: "Review",
            description: "Reviews code without editing.",
            arm: fauxArm,
            prompt: "Review only. Do not edit files.",
          },
          {
            name: "oracle",
            label: "Oracle",
            description: "Reasons about code without editing.",
            arm: fauxArm,
            prompt: "Reason only. Do not edit files.",
          },
        ]
      : undefined;
  // The faux provider's auth always resolves, so it is "configured" with an
  // empty credential store — default model resolution lands on it with no
  // setup, exactly as a credentialed provider would in production.
  const credentials = Models.credentialStore(storage);
  const modelsLayer = Models.layer({ collection, credentials });
  // Session snapshots settled turns through Git.Service, so the session
  // layer needs it even in tests that never read a diff.
  // An empty directory stands in for ~/.config/mcp so fixtures never read
  // the developer's real global MCP configuration.
  const mcpLayer = Mcp.defaultLayer({
    storage,
    globalConfigDirectory: mkdtempSync(join(tmpdir(), "honk-mcp-global-")),
  });
  const sessionLayer = Session.layer({
    storage,
    generateTitle: options.generateTitle ?? Session.generatePromptSessionTitle,
    ...(presets === undefined ? {} : { presets }),
    ...(pairings === undefined ? {} : { pairings }),
  }).pipe(
    Layer.provide(Git.defaultLayer),
    Layer.provide(modelsLayer),
    Layer.provide(mcpLayer),
    // A fixture workspace usually has no .agents/skills, so this scans
    // nothing and arms the harness with two empty lists — which is exactly
    // what a workspace without skills does in production. One layer value, so
    // Effect memoizes it into the single scan the skills and commands
    // services below also read.
    Layer.provide(Resources.defaultLayer),
  );
  // Self-contained app layer: one workspace instance shared by the session
  // layer and the test program, so ids minted by trust are findable.
  const appLayer = Layer.mergeAll(
    sessionLayer,
    Skills.layer.pipe(Layer.provide(Resources.defaultLayer)),
    Commands.layer.pipe(Layer.provide(Resources.defaultLayer)),
  ).pipe(Layer.provideMerge(Workspace.defaultLayer({ createExecutionEnv, storage })));
  // `createModels` is what a host test passes to createHonkCore; the
  // pre-built layers stay for tests that provide services directly.
  return {
    faux,
    collection,
    model: faux.getModel(),
    createModels: () => collection,
    createExecutionEnv,
    modelsLayer,
    sessionLayer,
    appLayer,
  };
};

// Sessions bind to trusted workspaces only, so nearly every session test
// starts by walking the real trust flow. Trust canonicalizes through the real
// filesystem, so the fixture directory is created first.
export const openTrustedWorkspace = (directory: string) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => mkdir(directory, { recursive: true }));
    const workspace = yield* Workspace.Service;
    yield* workspace.trust({ directory });
    const opened = yield* workspace.open({ directory });
    if (!Workspace.OpenResult.guards.ready(opened)) {
      return yield* Effect.die(new Error("expected a ready workspace after trust"));
    }
    return opened;
  });

// A response the test releases explicitly, so "while the run is active" is a
// deterministic program point instead of a sleep. Honors Pi's abort signal
// like a real provider: an aborted call returns immediately and the faux
// stream marks the message aborted.
export const gatedResponse = (text: string) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const response: FauxResponseStep = async (_context, options) => {
    const signal = options?.signal;
    if (signal !== undefined) {
      const aborted = new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await Promise.race([gate, aborted]);
    } else {
      await gate;
    }
    return fauxAssistantMessage(text);
  };
  return { release, response };
};

export const messageEntries = (entries: readonly SessionTreeEntry[]): MessageEntry[] =>
  entries.filter((entry): entry is MessageEntry => entry.type === "message");

export const textOf = (entry: MessageEntry | undefined): string | undefined => {
  const message = entry?.message;
  if (message?.role !== "user" && message?.role !== "assistant") return undefined;
  if (typeof message.content === "string") return message.content;
  const block = message.content.find((part) => part.type === "text");
  return block?.type === "text" ? block.text : undefined;
};
