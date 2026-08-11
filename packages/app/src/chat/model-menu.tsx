// The chat surfaces' model picker: effort up top and models in a
// hover-revealed submenu. Hover only reveals; every mutation is a click.
//
// Configured providers' models are plain radio rows. An unconfigured
// provider's models stay listed for discovery, but cannot become the active
// choice; each row holds a connect card naming what to do about it.

import { Button, Icon, IconButton, Menu, PreviewCard, Text, Tooltip } from "@honk/ui";
import {
  IconChevronRightMedium,
  IconClawd,
  IconGlobe,
  IconKimi,
  IconOpenaiCodex,
  IconSparklesSoft,
  IconZai,
} from "@honk/ui/icons";
import { controlVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { Models } from "@honk/core/models";
import type { Session } from "@honk/core/session";

import { usePreviewPanelHold } from "../composer/preview-panel-hold";
import { actions as settingsActions } from "../settings-store";
import type { ModelChoice } from "./chat-controller";
import { FUSION_STOPS, THINKING_LEVELS } from "./chat-model";
import { useCatalogPhase } from "./model-catalog";
import { decodeFusionStop, decodeThinkingLevel, type ModelSelection } from "./selection";

const CARD_TEXT_STYLE: React.CSSProperties = { margin: 0 };
const MODEL_PREVIEW_WIDTH = "236px";

export const THINKING_LEVEL_LABELS: Record<Session.ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

export const FUSION_STOP_LABELS: Record<Session.FusionStop, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  ultra: "Ultra",
  claw: "Claw",
};

/** Entering Fusion without a remembered stop starts here, production's default. */
export const DEFAULT_FUSION_STOP: Session.FusionStop = "medium";

const styles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    width: MODEL_PREVIEW_WIDTH,
  },
  cardHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: controlVars["--honk-control-gap"],
  },
  cardActions: {
    display: "flex",
    marginTop: controlVars["--honk-control-gap"],
  },
});

/** One selectable row, resolved from the provider catalog. */
export interface ModelRow {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly configured: boolean;
  /** The curated copy shown in the row's hover card; absent for extras. */
  readonly description?: string;
}

// The composer ships a small, deliberate list (spec/core.md section 11); the
// full catalog belongs to Settings. Each entry names the models it covers so
// the row survives id drift across providers offering the same family.
interface CuratedModel {
  readonly title: string;
  readonly matches: RegExp;
  readonly description: string;
}

const CURATED: readonly CuratedModel[] = [
  {
    title: "Fable 5",
    matches: /fable/i,
    description: "Anthropic's flagship model for deep, multi-step engineering work.",
  },
  {
    title: "Opus 5",
    matches: /opus[- ]?5\b/i,
    description: "Anthropic's Opus line, deliberate and thorough on hard changes.",
  },
  {
    title: "Sol",
    matches: /\bsol\b/i,
    description: "OpenAI's fast, capable model for everyday coding.",
  },
  {
    title: "Kimi K3",
    matches: /kimi[- ]?k3\b/i,
    description: "Moonshot's open model, served through a shared gateway.",
  },
];

// A curated family present on several providers resolves to one row: a
// configured provider beats an unconfigured one, and the direct provider
// beats a gateway reselling the same family.
const PREFERRED_PROVIDERS = ["anthropic", "openai-codex", "openai"];

const providerRank = (provider: Models.ProviderSummary): number => {
  const direct = PREFERRED_PROVIDERS.indexOf(provider.id);
  return (provider.configured ? 0 : 10) + (direct === -1 ? PREFERRED_PROVIDERS.length : direct);
};

/**
 * What core's default policy resolves when nothing is chosen: the first
 * configured provider's first model (spec/core.md section 11's fallback).
 * The picker shows this instead of a placeholder, so the thinking level is
 * never attached to nothing.
 */
export const defaultModelChoice = (
  providers: readonly Models.ProviderSummary[],
): ModelChoice | null => {
  for (const provider of providers) {
    const first = provider.models[0];
    if (provider.configured && first !== undefined) {
      return { providerId: provider.id, modelId: first.id };
    }
  }
  return null;
};

/**
 * The fixed picker list: one row per curated family the catalog can satisfy,
 * plus the session's current model when it is not curated — the row never
 * renames or hides what is already running.
 */
export const curatedModelRows = (
  providers: readonly Models.ProviderSummary[],
  current: ModelChoice | null,
): readonly ModelRow[] => {
  const ranked = [...providers].sort((a, b) => providerRank(a) - providerRank(b));
  const rows: ModelRow[] = [];
  for (const entry of CURATED) {
    for (const provider of ranked) {
      const model = provider.models.find(
        (candidate) => entry.matches.test(candidate.id) || entry.matches.test(candidate.name),
      );
      if (model === undefined) continue;
      rows.push({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelName: entry.title,
        configured: provider.configured,
        description: entry.description,
      });
      break;
    }
  }
  if (
    current !== null &&
    !rows.some((row) => row.providerId === current.providerId && row.modelId === current.modelId)
  ) {
    const provider = providers.find((candidate) => candidate.id === current.providerId);
    // The catalog can name a model whose provider row is absent — the load
    // window, or a provider id the catalog doesn't list — so any provider
    // carrying the same model id supplies the display name over the raw id.
    const model =
      provider?.models.find((candidate) => candidate.id === current.modelId) ??
      providers
        .flatMap((candidate) => candidate.models)
        .find((candidate) => candidate.id === current.modelId);
    rows.push({
      providerId: current.providerId,
      providerName: provider?.name ?? current.providerId,
      modelId: current.modelId,
      modelName: model?.name ?? current.modelId,
      configured: provider?.configured ?? false,
    });
  }
  return rows;
};

const rowKey = (row: ModelChoice): string => `${row.providerId}/${row.modelId}`;

/**
 * Glyphs follow the production rule: the model id decides first (Kimi and GLM
 * ride shared gateways), then the provider, then the globe for anything the
 * app has no mark for.
 */
const modelGlyph = (choice: ModelChoice) => {
  if (choice.modelId.includes("kimi")) return IconKimi;
  if (choice.modelId.includes("glm")) return IconZai;
  if (choice.providerId === "anthropic") return IconClawd;
  if (choice.providerId === "openai" || choice.providerId === "openai-codex") {
    return IconOpenaiCodex;
  }
  return IconGlobe;
};

function ModelIcon({ choice }: { readonly choice: ModelChoice }): React.ReactElement {
  return <Icon icon={modelGlyph(choice)} size="sm" tone="muted" />;
}

/** The trigger's text: the catalog's name for the model, else its raw id. */
export const modelDisplayName = (model: ModelChoice | null, rows: readonly ModelRow[]): string => {
  if (model === null) return "Model";
  const row = rows.find(
    (candidate) => candidate.providerId === model.providerId && candidate.modelId === model.modelId,
  );
  return row?.modelName ?? model.modelId;
};

// Read-only side card: what this model is, and — when its provider is not
// configured — how to unlock it. Its only interactive element is the
// Settings link on gated rows.
function ModelCard({ row }: { readonly row: ModelRow }): React.ReactElement {
  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHeader)}>
        <Text size="sm" weight="semibold">
          {row.modelName}
        </Text>
        <Text size="xs" tone="faint">
          {row.providerName}
        </Text>
      </div>
      {row.description === undefined ? null : (
        <Text as="p" size="xs" tone="muted" style={CARD_TEXT_STYLE}>
          {row.description}
        </Text>
      )}
      {row.configured ? null : (
        <>
          <Text as="p" size="xs" tone="warn" style={CARD_TEXT_STYLE}>
            {`Connect ${row.providerName} in Settings to use ${row.modelName}.`}
          </Text>
          <div {...stylex.props(styles.cardActions)}>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                settingsActions.open("providers");
              }}
            >
              Open Settings
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One menu owns both selection, Cursor-style: thinking level up top, the model
 * list as a hover-revealed submenu. Both act live — Pi buffers mid-run
 * changes until the turn settles — so nothing here needs a run gate beyond
 * the caller's `disabled`.
 */
type CoreModelSelectorProps =
  | {
      readonly mode: "create";
      readonly selection: ModelSelection;
      readonly disabled?: boolean;
      readonly onSelectionChange: (selection: ModelSelection) => void;
    }
  | {
      readonly mode: "session";
      readonly selection: ModelSelection;
      readonly disabled?: boolean;
      readonly onModelChange: (choice: ModelChoice) => void;
      readonly onThinkingLevel: (level: Session.ThinkingLevel) => void;
    }
  | {
      readonly mode: "edit";
      readonly selection: ModelSelection;
      readonly disabled?: boolean;
      readonly onSelectionChange: (selection: ModelSelection) => void;
    };

export function CoreModelSelector(props: CoreModelSelectorProps): React.ReactElement {
  const phase = useCatalogPhase();
  const catalog = phase.status === "ready" ? phase.providers : [];
  const { selection } = props;
  const selectedModel = selection.kind === "model" ? selection.model : null;
  // Nothing chosen still runs something: core's default policy. Show that
  // model when the ready catalog can resolve it.
  const fallback = defaultModelChoice(catalog);
  const effective = selectedModel ?? fallback;
  const rows = curatedModelRows(catalog, effective);
  const [submenuOpen, setSubmenuOpen] = React.useState(false);
  const hold = usePreviewPanelHold<string>();

  const activeTitle = modelDisplayName(effective, rows);
  const level = selection.kind === "model" ? (selection.thinkingLevel ?? "off") : "off";
  const label =
    selection.kind === "fusion"
      ? `Fusion · ${FUSION_STOP_LABELS[selection.stop]}`
      : level === "off"
        ? activeTitle
        : `${activeTitle} · ${THINKING_LEVEL_LABELS[level]}`;
  const editControl = props.mode === "edit" ? { "data-message-edit-control": "" } : {};
  const trigger =
    props.mode === "edit" ? (
      <Tooltip label={label}>
        <Menu.Trigger
          render={
            <IconButton
              type="button"
              size="sm"
              aria-label={`Model: ${label}`}
              disabled={props.disabled ?? false}
            >
              <Icon
                icon={
                  selection.kind === "fusion"
                    ? IconSparklesSoft
                    : effective === null
                      ? IconGlobe
                      : modelGlyph(effective)
                }
                size="sm"
                tone="muted"
              />
            </IconButton>
          }
        />
      </Tooltip>
    ) : (
      <Menu.Trigger
        render={
          <Button
            type="button"
            size="sm"
            variant="quiet"
            disabled={props.disabled ?? false}
            aria-label={`Model: ${label}`}
            {...(selection.kind === "fusion" || effective === null
              ? {}
              : { iconStart: <ModelIcon choice={effective} /> })}
          />
        }
      >
        {label}
      </Menu.Trigger>
    );

  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (!open) {
          setSubmenuOpen(false);
          hold.reset();
        }
      }}
    >
      {trigger}
      <Menu.Popup side="bottom" align="start" sideOffset={4} {...editControl}>
        {/* The top section edits the active pick, production-style: the stop
            ladder while Fusion runs, the thinking level otherwise. A running
            session's stop cannot move (core has no mid-session stop change),
            so the ladder renders only where the stop is still a choice. */}
        {selection.kind === "fusion" && props.mode === "create" ? (
          <Menu.Group>
            <Menu.GroupLabel>Thinking level</Menu.GroupLabel>
            <Menu.RadioGroup
              value={selection.stop}
              onValueChange={(value) => {
                const stop = decodeFusionStop(value);
                if (stop !== null) props.onSelectionChange({ kind: "fusion", stop });
              }}
            >
              {FUSION_STOPS.map((stop) => (
                <Menu.RadioItem key={stop} value={stop} closeOnClick={false}>
                  {FUSION_STOP_LABELS[stop]}
                  {stop === DEFAULT_FUSION_STOP ? <Menu.ItemMeta>Default</Menu.ItemMeta> : null}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Group>
        ) : selection.kind === "fusion" ? null : (
          <Menu.Group>
            <Menu.GroupLabel>Thinking level</Menu.GroupLabel>
            <Menu.RadioGroup
              value={level}
              onValueChange={(value) => {
                const thinkingLevel = decodeThinkingLevel(value);
                if (thinkingLevel === null) return;
                if (props.mode === "create" || props.mode === "edit") {
                  props.onSelectionChange({ ...selection, thinkingLevel });
                } else {
                  props.onThinkingLevel(thinkingLevel);
                }
              }}
            >
              {THINKING_LEVELS.map((stop) => (
                <Menu.RadioItem key={stop} value={stop} closeOnClick={false}>
                  {THINKING_LEVEL_LABELS[stop]}
                  {stop === "off" ? <Menu.ItemMeta>Default</Menu.ItemMeta> : null}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Group>
        )}
        <>
          {selection.kind === "fusion" && props.mode !== "create" ? null : <Menu.Separator />}
          <Menu.Group>
            <Menu.GroupLabel>Model</Menu.GroupLabel>
            {/*
              Controlled for the same reason as the production picker: a
              held connect card lives in its own FloatingTree, so the
              submenu's safe-polygon check cannot see it. Veto hover-closes
              while a card is held.
            */}
            <Menu.SubmenuRoot
              open={submenuOpen}
              onOpenChange={(open) => {
                if (!open && hold.isActive()) return;
                setSubmenuOpen(open);
                if (!open) hold.reset();
              }}
            >
              <Menu.SubmenuTrigger>
                {selection.kind === "fusion" ? "Fusion" : activeTitle}
                <Menu.ItemMeta>
                  <Icon icon={IconChevronRightMedium} size="xs" tone="faint" />
                </Menu.ItemMeta>
              </Menu.SubmenuTrigger>
              <Menu.SubmenuPopup aria-label="Model" {...editControl}>
                <Menu.RadioGroup
                  value={
                    selection.kind === "fusion"
                      ? props.mode === "create"
                        ? "fusion"
                        : ""
                      : effective === null
                        ? ""
                        : rowKey(effective)
                  }
                  onValueChange={(value) => {
                    if (value === "fusion") {
                      if (props.mode === "create") {
                        props.onSelectionChange({
                          kind: "fusion",
                          stop: selection.kind === "fusion" ? selection.stop : DEFAULT_FUSION_STOP,
                        });
                      }
                      return;
                    }
                    const row = rows.find((candidate) => rowKey(candidate) === value);
                    if (row === undefined || !row.configured) return;
                    const choice = { providerId: row.providerId, modelId: row.modelId };
                    if (props.mode === "create" || props.mode === "edit") {
                      props.onSelectionChange({
                        kind: "model",
                        model: choice,
                        thinkingLevel: selection.kind === "model" ? selection.thinkingLevel : null,
                      });
                    } else {
                      props.onModelChange(choice);
                    }
                  }}
                >
                  {/* A Fusion row exists only on creation surfaces, where its
                      click can change the stop. Session Fusion is transcript
                      truth, so it cannot become a dead radio control. */}
                  {props.mode === "create" && (
                    <Menu.RadioItem value="fusion" closeOnClick={false}>
                      Fusion
                      <Menu.ItemMeta>
                        {
                          FUSION_STOP_LABELS[
                            selection.kind === "fusion" ? selection.stop : DEFAULT_FUSION_STOP
                          ]
                        }
                      </Menu.ItemMeta>
                    </Menu.RadioItem>
                  )}
                  {rows.map((row) => (
                    <PreviewCard.Root
                      key={rowKey(row)}
                      open={hold.openId === rowKey(row)}
                      onOpenChange={(open) => {
                        hold.handleOpenChange(rowKey(row), open);
                      }}
                    >
                      <PreviewCard.Trigger
                        render={
                          <Menu.RadioItem
                            value={rowKey(row)}
                            closeOnClick={false}
                            ref={hold.rowRef(rowKey(row))}
                          />
                        }
                      >
                        <Menu.ItemIcon>
                          <ModelIcon choice={row} />
                        </Menu.ItemIcon>
                        {row.modelName}
                        <Menu.ItemMeta>
                          {selectedModel === null &&
                          fallback !== null &&
                          rowKey(row) === rowKey(fallback)
                            ? `${row.providerName} · Default`
                            : row.providerName}
                        </Menu.ItemMeta>
                      </PreviewCard.Trigger>
                      {/* The card continues the cascade outward, past the
                          submenu. Opening it inline-start would drop it back
                          onto the parent popup, burying the thinking level the
                          menu just asked about. */}
                      <PreviewCard.Popup
                        ref={hold.panelRef}
                        side="inline-end"
                        align="start"
                        aria-label={`About ${row.modelName}`}
                        {...editControl}
                        style={hold.panelStyle}
                      >
                        <ModelCard row={row} />
                      </PreviewCard.Popup>
                    </PreviewCard.Root>
                  ))}
                </Menu.RadioGroup>
                <Menu.Separator />
                {/* This item also gives an empty catalog a real destination;
                    the menu never opens onto a blank popup. */}
                <Menu.Item
                  onClick={() => {
                    settingsActions.open("providers");
                  }}
                >
                  More models in Settings…
                </Menu.Item>
              </Menu.SubmenuPopup>
            </Menu.SubmenuRoot>
          </Menu.Group>
        </>
      </Menu.Popup>
    </Menu.Root>
  );
}
