// Fixed command-menu ranking: Start-new → threads → commands. A command-verb match may float
// Commands within its band. Nothing else reorders bands. Dev entries stay out of SHIPPING_COMMANDS.

import type { Session } from "@honk/core/session";
import { basename } from "@honk/shared/paths";

import type { CommandMenuDoor, CommandMenuSubmenuFrame } from "./command-menu-store";

/** Core session inventory row used by the command menu. */
export type CommandMenuThread = Session.SessionSummary;
export type CommandMenuThreadStatus = "idle" | "working";

export type CommandMenuItemKind = "start-new" | "thread" | "command" | "submenu" | "header";

export type CommandMenuItem =
  | {
      readonly kind: "header";
      readonly id: string;
      readonly label: string;
    }
  | {
      readonly kind: "start-new";
      readonly id: "start-new";
      readonly title: string;
      readonly queryPreview: string;
      readonly searchTerms: readonly string[];
    }
  | {
      readonly kind: "thread";
      readonly id: string;
      readonly sessionId: string;
      readonly title: string;
      readonly status: CommandMenuThreadStatus;
      readonly searchTerms: readonly string[];
    }
  | {
      readonly kind: "command";
      readonly id: string;
      readonly title: string;
      readonly shortcut?: string;
      readonly searchTerms: readonly string[];
      readonly run: CommandMenuCommandId;
    }
  | {
      readonly kind: "submenu";
      readonly id: string;
      readonly title: string;
      readonly searchTerms: readonly string[];
      readonly frame: CommandMenuSubmenuFrame;
    };

/** Shipping command ids. Run handlers live in the surface, not this model. */
export type CommandMenuCommandId =
  | "new-thread"
  | "open-settings"
  | "replay-onboarding"
  | "toggle-performance-monitor";

export type ShippingCommand = {
  readonly id: string;
  readonly title: string;
  readonly searchTerms: readonly string[];
  readonly shortcut?: string;
  readonly run: CommandMenuCommandId;
  /** Start-new primary row. Not listed under Commands. */
  readonly isStartNew?: boolean;
};

// Shipping registry only. Dev commands stay in DEVELOPMENT_COMMANDS.
export const SHIPPING_COMMANDS: readonly ShippingCommand[] = Object.freeze([
  {
    id: "start-new",
    title: "Start new chat",
    searchTerms: Object.freeze(["start new chat", "new thread", "new chat"]),
    shortcut: "⏎",
    run: "new-thread",
    isStartNew: true,
  },
  {
    id: "new-thread",
    title: "New thread",
    searchTerms: Object.freeze(["new thread", "new chat", "start"]),
    shortcut: "⌘N",
    run: "new-thread",
  },
  {
    id: "open-settings",
    title: "Open settings",
    searchTerms: Object.freeze(["open settings", "settings", "preferences", "appearance"]),
    shortcut: "⌘,",
    run: "open-settings",
  },
]);

/** Development-only commands. Callers decide whether the current runtime may expose them. */
export const DEVELOPMENT_COMMANDS: readonly ShippingCommand[] = Object.freeze([
  {
    id: "replay-onboarding",
    title: "Replay onboarding",
    searchTerms: Object.freeze(["replay onboarding", "show onboarding", "first run", "setup"]),
    run: "replay-onboarding",
  },
  {
    id: "toggle-performance-monitor",
    title: "Hide performance monitor",
    searchTerms: Object.freeze([
      "hide performance monitor",
      "show performance monitor",
      "dismiss performance monitor",
      "dev toolbar",
      "fps",
      "perf",
    ]),
    run: "toggle-performance-monitor",
  },
]);

export const RECENT_THREAD_LIMIT = 12;

/** Core's phase vocabulary folded onto the status-dot one: any open run is working. */
function threadStatus(thread: CommandMenuThread): CommandMenuThreadStatus {
  return thread.phase === "idle" ? "idle" : "working";
}

export function statusDotTone(_status: CommandMenuThreadStatus): "neutral" {
  return "neutral";
}

export function statusDotPulse(status: CommandMenuThreadStatus): boolean {
  return status === "working";
}

export type RankCommandMenuInput = {
  readonly query: string;
  readonly door: CommandMenuDoor;
  /** Home inline hides the Commands band at rest. */
  readonly hideCommandsAtRest?: boolean;
  readonly threads: readonly CommandMenuThread[];
  readonly commands?: readonly ShippingCommand[];
  readonly submenuStack?: readonly CommandMenuSubmenuFrame[];
};

/**
 * Flat ranked list for the surface. Headers are non-selectable.
 * Store selection indices address selectable rows only via `selectableItems`.
 */
export function rankCommandMenuItems(input: RankCommandMenuInput): readonly CommandMenuItem[] {
  const commands = input.commands ?? SHIPPING_COMMANDS;
  const stack = input.submenuStack ?? [];
  const needle = input.query.trim().toLowerCase().replace(/\s+/g, " ");

  // Submenu replaces root ranking. Empty stub shows the frame title until pickers land.
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      return Object.freeze([]);
    }
    return Object.freeze([
      {
        kind: "header" as const,
        id: `submenu:${top.id}`,
        label: top.title,
      },
    ]);
  }

  const startNew = commands.find((c) => c.isStartNew);
  const commandBand = commands.filter((c) => !c.isStartNew);

  // Delegation-owned sessions stay out of top-level lists.
  const activeThreads = input.threads
    .filter((thread) => thread.delegation === undefined)
    .slice()
    .sort((a, b) => {
      const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
      return byUpdated === 0 ? String(a.id).localeCompare(String(b.id)) : byUpdated;
    });

  // Threads door: threads only. Keep Start-new when the query is empty so Enter still starts.
  if (input.door === "threads") {
    return Object.freeze(
      buildList({
        queryText: needle,
        startNew: needle.length === 0 ? startNew : undefined,
        threads: filterAndRankThreads(activeThreads, needle),
        commands: [],
        forceThreadHeader: true,
      }),
    );
  }

  const rankedThreads = filterAndRankThreads(activeThreads, needle).slice(
    0,
    needle.length === 0 ? RECENT_THREAD_LIMIT : undefined,
  );
  const rankedCommands =
    needle.length === 0 && input.hideCommandsAtRest
      ? []
      : filterAndRankCommands(commandBand, needle);

  return Object.freeze(
    buildList({
      queryText: needle,
      startNew,
      threads: rankedThreads,
      commands: rankedCommands,
      forceThreadHeader: false,
    }),
  );
}

/** Selectable rows only. ArrowUp/Down and Enter address this list. */
export function selectableItems(
  items: readonly CommandMenuItem[],
): readonly Exclude<CommandMenuItem, { kind: "header" }>[] {
  return items.filter(
    (item): item is Exclude<CommandMenuItem, { kind: "header" }> => item.kind !== "header",
  );
}

function buildList(input: {
  queryText: string;
  startNew: ShippingCommand | undefined;
  threads: readonly CommandMenuThread[];
  commands: readonly ShippingCommand[];
  forceThreadHeader: boolean;
}): CommandMenuItem[] {
  const items: CommandMenuItem[] = [];

  if (input.startNew !== undefined) {
    // Start-new always leads when present. Typed query is preview only; never filtered out.
    items.push({
      kind: "start-new",
      id: "start-new",
      title: input.startNew.title,
      queryPreview: input.queryText,
      searchTerms: input.startNew.searchTerms,
    });
  }

  if (input.threads.length > 0) {
    items.push({
      kind: "header",
      id: "header:threads",
      label: input.forceThreadHeader || input.queryText.length > 0 ? "Threads" : "Jump back in",
    });
    for (const thread of input.threads) {
      items.push(threadItem(thread));
    }
  }

  if (input.commands.length > 0) {
    items.push({
      kind: "header",
      id: "header:commands",
      label: "Commands",
    });
    for (const command of input.commands) {
      const row: Extract<CommandMenuItem, { kind: "command" }> = {
        kind: "command",
        id: command.id,
        title: command.title,
        searchTerms: command.searchTerms,
        run: command.run,
        ...(command.shortcut !== undefined ? { shortcut: command.shortcut } : {}),
      };
      items.push(row);
    }
  }

  return items;
}

function threadItem(thread: CommandMenuThread): CommandMenuItem {
  return {
    kind: "thread",
    id: thread.id,
    sessionId: thread.id,
    title: thread.title ?? basename(thread.directory),
    status: threadStatus(thread),
    searchTerms: threadSearchTerms(thread),
  };
}

function threadSearchTerms(thread: CommandMenuThread): readonly string[] {
  return [
    ...(thread.title === undefined ? [] : [thread.title]),
    basename(thread.directory),
    thread.directory,
    String(thread.id),
  ];
}

function filterAndRankThreads(
  threads: readonly CommandMenuThread[],
  needle: string,
): CommandMenuThread[] {
  if (needle.length === 0) {
    return [...threads];
  }

  return threads
    .map((thread, index) => ({
      thread,
      index,
      rank: bestFieldRank(threadSearchTerms(thread), needle),
    }))
    .filter((entry) => entry.rank > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((entry) => entry.thread);
}

function filterAndRankCommands(
  commands: readonly ShippingCommand[],
  needle: string,
): ShippingCommand[] {
  if (needle.length === 0) {
    return [...commands];
  }

  return commands
    .map((command, index) => ({
      command,
      index,
      rank: bestFieldRank(command.searchTerms, needle),
    }))
    .filter((entry) => entry.rank > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((entry) => entry.command);
}

/** Exact > prefix > includes. Earlier fields win ties. */
function bestFieldRank(fields: readonly string[], needle: string): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const [index, field] of fields.entries()) {
    const rank = rankField(field, needle);
    if (rank === Number.NEGATIVE_INFINITY) {
      continue;
    }
    const weighted = 1_000 - index * 100 + rank;
    if (weighted > best) {
      best = weighted;
    }
  }
  return best;
}

function rankField(field: string, needle: string): number {
  const haystack = field.trim().toLowerCase().replace(/\s+/g, " ");
  if (haystack.length === 0 || !haystack.includes(needle)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (haystack === needle) {
    return 3;
  }
  if (haystack.startsWith(needle)) {
    return 2;
  }
  // Boost matches that start after a space.
  if (haystack.includes(` ${needle}`)) {
    return 1.5;
  }
  return 1;
}
