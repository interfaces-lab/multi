// The chat surfaces' localStorage boundary: the last chat's model selection
// and the recent directories, validated on the way back in. Every guard for
// stored values lives here, so a stale or hand-edited entry reads as no
// memory instead of reaching the create codec as a value it would reject.

import type { Models } from "@honk/core/models";
import { Session } from "@honk/core/session";
import { Option, Schema } from "effect";

import type { ModelChoice } from "./chat-controller";

const SELECTION_KEY = "honk.chat.last-selection";
const RECENT_KEY = "honk.chat.recent-directories";
const RECENT_LIMIT = 8;

/** What the start surface remembers between visits: one model or one Fusion stop. */
export type ModelSelection =
  | {
      readonly kind: "model";
      readonly model: ModelChoice | null;
      readonly thinkingLevel: Session.ThinkingLevel | null;
    }
  | { readonly kind: "fusion"; readonly stop: Session.FusionStop };

export const NO_SELECTION: ModelSelection = Object.freeze({
  kind: "model",
  model: null,
  thinkingLevel: null,
});

/**
 * Reconciles a remembered model with the live provider catalog.
 *
 * Provider ids are credential routes in Pi, not aliases. Keep an exact
 * configured route. If that route cannot run the model, return to core's
 * default instead of translating the choice to another provider.
 */
export const reconcileModelSelection = (
  selection: ModelSelection,
  providers: readonly Models.ProviderSummary[],
): ModelSelection => {
  if (selection.kind === "fusion" || selection.model === null || providers.length === 0) {
    return selection;
  }
  const exact = providers.find((provider) => provider.id === selection.model?.providerId);
  if (
    exact?.configured === true &&
    exact.models.some((model) => model.id === selection.model?.modelId)
  ) {
    return selection;
  }
  return { ...selection, model: null };
};

const StoredFusion = Schema.Struct({
  kind: Schema.Literal("fusion"),
  stop: Session.FusionStop,
});
const StoredModelTag = Schema.Struct({ kind: Schema.Literal("model") });
const StoredModel = Schema.Struct({
  model: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        providerId: Schema.NonEmptyString,
        modelId: Schema.NonEmptyString,
      }),
    ),
  ),
});
const StoredThinkingLevel = Schema.Struct({
  thinkingLevel: Schema.optionalKey(Schema.NullOr(Session.ThinkingLevel)),
});

const decodeFusion = Schema.decodeUnknownOption(StoredFusion);
const decodeModelTag = Schema.decodeUnknownOption(StoredModelTag);
const decodeModel = Schema.decodeUnknownOption(StoredModel);
const decodeStoredThinkingSelection = Schema.decodeUnknownOption(StoredThinkingLevel);
const decodeStoredFusionStop = Schema.decodeUnknownOption(Session.FusionStop);
const decodeStoredThinkingLevelValue = Schema.decodeUnknownOption(Session.ThinkingLevel);
const decodeRecentDirectories = Schema.decodeUnknownOption(Schema.Array(Schema.String));

export const decodeFusionStop = (value: unknown): Session.FusionStop | null =>
  Option.getOrNull(decodeStoredFusionStop(value));

export const decodeThinkingLevel = (value: unknown): Session.ThinkingLevel | null =>
  Option.getOrNull(decodeStoredThinkingLevelValue(value));

/**
 * Validates the discriminated union at the storage boundary. A bad field in
 * the model variant costs only that field; an invalid variant reads as no
 * remembered choice.
 */
export const selectionOf = (value: unknown): ModelSelection => {
  return Option.match(decodeFusion(value), {
    onSome: (fusion) => fusion,
    onNone: () =>
      Option.match(decodeModelTag(value), {
        onNone: () => NO_SELECTION,
        onSome: () => ({
          kind: "model",
          model: Option.getOrUndefined(decodeModel(value))?.model ?? null,
          thinkingLevel:
            Option.getOrUndefined(decodeStoredThinkingSelection(value))?.thinkingLevel ?? null,
        }),
      }),
  });
};

export const readModelSelection = (): ModelSelection => {
  try {
    return selectionOf(JSON.parse(window.localStorage.getItem(SELECTION_KEY) ?? "null"));
  } catch {
    return NO_SELECTION;
  }
};

export const rememberSelection = (selection: ModelSelection): void => {
  try {
    window.localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
  } catch {
    // The remembered selection is a convenience; losing it is fine.
  }
};

/** Shared with the start surface as fallback history after its configured default. */
export const readRecent = (): readonly string[] => {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Option.getOrElse(decodeRecentDirectories(parsed), () => []);
  } catch {
    return [];
  }
};

export const resolveStartDirectory = (
  defaultDirectory: string | null,
  recentDirectories: readonly string[],
): string | null => defaultDirectory ?? recentDirectories[0] ?? null;

export const rememberRecent = (directory: string): readonly string[] => {
  const next = [directory, ...readRecent().filter((item) => item !== directory)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recents are a convenience; losing them is fine.
  }
  return next;
};
