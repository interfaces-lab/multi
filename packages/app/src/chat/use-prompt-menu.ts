// The one driver behind the composer's `/` and `@` menus.
//
// Both composers mount this hook, which is the point: the start card and the
// thread reply differ in what they can *do* with a pick, not in how the menu
// behaves, so the trigger rule, the drill-down state, the keyboard contract,
// and the acceptance decision live here once. The composer surface contract
// forbids forking the two menus into separate editor implementations, and a
// second copy of this hook would be that fork wearing a different name.
//
// Everything decidable is decided in `./prompt-menu-model`, which has no
// React in it. What is left here is the asking: catalogs to load, a file
// index to search, and the state a menu keeps between keystrokes.

import * as React from "react";

import type { Workspace } from "@honk/core/workspace";

import type { ComposerEditorHandle } from "./composer-editor";
import { useHonkCore } from "./client";
import type { PromptMenuAnchor, PromptMenuItem } from "./prompt-menu";
import { acceptanceOf, commandItemsOf, fileItemsOf, promptTriggerOf } from "./prompt-menu-model";
import { useMentionResults, usePromptCatalog } from "./prompt-menu-resources";

const TRUNCATED_FOOTER = "More matches than shown — keep typing to narrow";

/** What the composer hands the hook. */
export interface PromptMenuHost {
  /** The editor's plain text, as `$getRoot().getTextContent()` reports it. */
  readonly draft: string;
  readonly caret: number;
  readonly workspaceId: Workspace.WorkspaceId | null;
  /**
   * The editor this menu edits.
   *
   * A handle rather than a draft setter, because accepting a row inserts a
   * *node*. The chip is the reference, so there is nothing for the composer to
   * remember alongside its text and nothing to reconcile at submit.
   */
  readonly editor: React.RefObject<ComposerEditorHandle | null>;
}

export interface PromptMenuState {
  readonly open: boolean;
  readonly items: readonly PromptMenuItem[];
  readonly selectedIndex: number;
  readonly anchor: PromptMenuAnchor | null;
  readonly emptyLabel: string;
  readonly footer: string | undefined;
  readonly isLoading: boolean;
  readonly listboxId: string;
  readonly isKeyboardNavigation: boolean;
  readonly accept: (item: PromptMenuItem) => void;
  readonly highlight: (index: number) => void;
  readonly moveSelection: (delta: number) => void;
  readonly acceptHighlighted: () => void;
  readonly dismiss: () => void;
  /** Call whenever the draft text changes, so a dismissal does not stick. */
  readonly noteEdit: () => void;
}

export function usePromptMenu(host: PromptMenuHost): PromptMenuState {
  const { draft, caret, workspaceId } = host;
  const core = useHonkCore();
  const client = core.status === "ready" ? core.client : null;
  const catalog = usePromptCatalog(client, workspaceId);
  const listboxId = React.useId();

  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [isKeyboardNavigation, setKeyboardNavigation] = React.useState(true);
  // The first Escape closes the menu for this token; typing reopens it.
  const [dismissedAt, setDismissedAt] = React.useState<number | null>(null);

  const detected = promptTriggerOf(draft, caret);
  // A `/` with nothing to offer must not open: typing a path like `/usr/bin`
  // should not put an empty menu over the composer on every keystroke. A `@`
  // needs a workspace to search at all.
  const available =
    detected === null
      ? null
      : detected.kind === "command"
        ? catalog.skills.length > 0 || catalog.commands.length > 0
        : workspaceId !== null;
  const trigger =
    available === true && detected !== null && detected.start !== dismissedAt ? detected : null;

  // Files are the only rows that need a round trip; the resource lists are
  // already in memory.
  const fileQuery = trigger?.kind === "mention" ? trigger.query : null;
  const fileSnapshot = useMentionResults(client, workspaceId, fileQuery);

  const items = ((): readonly PromptMenuItem[] => {
    if (trigger === null) return [];
    if (trigger.kind === "command") {
      return commandItemsOf({
        skills: catalog.skills,
        commands: catalog.commands,
        query: trigger.query,
      });
    }
    return fileSnapshot.phase === "ready" ? fileItemsOf(fileSnapshot.results.entries) : [];
  })();

  // A mention with no answer yet is loading, not empty: rendering "no matching
  // files" for the moment before the index replies would flash a wrong answer
  // on every keystroke.
  const isLoading = trigger?.kind === "mention" && fileSnapshot.phase === "loading";
  const open = trigger !== null && (trigger.kind === "command" || fileSnapshot.phase === "ready");

  // The selection resets whenever the list is rebuilt around a new question.
  const listKey = `${trigger?.kind ?? ""}:${trigger?.query ?? ""}`;
  const resetKeyRef = React.useRef(listKey);
  if (resetKeyRef.current !== listKey) {
    // Assigning during render rather than in an effect keeps the highlight and
    // the rows it indexes in the same commit.
    resetKeyRef.current = listKey;
    setSelectedIndex(0);
  }
  const clampedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));

  const triggerStart = trigger?.start ?? null;
  // React Compiler keeps this anchor stable until the trigger moves, so the
  // positioner sees a new object only when it needs to measure again.
  const anchor: PromptMenuAnchor | null =
    triggerStart === null
      ? null
      : {
          getBoundingClientRect: () =>
            host.editor.current?.triggerRect(triggerStart) ?? new DOMRect(),
        };

  const accept = (item: PromptMenuItem): void => {
    const editor = host.editor.current;
    if (editor === null || trigger === null) return;
    const range = { start: trigger.start, end: caret };
    const acceptance = acceptanceOf(item, catalog.commands);
    switch (acceptance.type) {
      case "mention":
        editor.insertMention(range, acceptance.path);
        return;
      case "skill":
        editor.insertResource(range, "skill", acceptance.name);
        return;
      case "command":
        // A template with placeholders is a prefix the user is still writing.
        // The chip goes in either way, and the caret lands after it, so the
        // arguments are typed beside the chip rather than into its name.
        editor.insertResource(range, "command", acceptance.name);
        return;
    }
  };

  return {
    open,
    items,
    selectedIndex: clampedIndex,
    anchor,
    emptyLabel: trigger?.kind === "command" ? "No matching commands" : "No matching files",
    footer:
      fileSnapshot.phase === "ready" && fileSnapshot.results.truncated
        ? TRUNCATED_FOOTER
        : undefined,
    isLoading,
    listboxId,
    isKeyboardNavigation,
    accept,
    highlight: (index) => {
      setKeyboardNavigation(false);
      setSelectedIndex(index);
    },
    moveSelection: (delta) => {
      setKeyboardNavigation(true);
      setSelectedIndex(Math.min(Math.max(clampedIndex + delta, 0), Math.max(0, items.length - 1)));
    },
    acceptHighlighted: () => {
      const item = items[clampedIndex];
      if (item === undefined) setDismissedAt(trigger?.start ?? null);
      else accept(item);
    },
    dismiss: () => {
      setDismissedAt(trigger?.start ?? null);
    },
    noteEdit: () => {
      setDismissedAt(null);
    },
  };
}
