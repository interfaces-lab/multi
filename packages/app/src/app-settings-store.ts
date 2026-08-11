// App-wide rendering and notification preferences.

import {
  ConversationDensity,
  DEFAULT_CONVERSATION_DENSITY,
} from "@honk/shared/conversation-density";
import { DEFAULT_CURSOR_POINTER_ON_BUTTONS } from "@honk/shared/client-settings";
import { Schema } from "effect";
import { setEnabled } from "cuelume";
import { useSyncExternalStore } from "react";

import {
  DEFAULT_ALERT_SOUND,
  isAlertSoundSelection,
  type AlertSoundSelection,
} from "./alert-sound-model";
import {
  GIT_AGENT_DEFAULT_ACTION,
  gitAgentActionIdOf,
  type GitAgentActionId,
} from "./lib/git-agent-actions";

export type DefaultThreadEnvironment = "local" | "worktree";

export type AppSettings = {
  /** Absolute path for new threads. null asks on the start surface. */
  readonly defaultProjectDirectory: string | null;
  readonly defaultThreadEnvironment: DefaultThreadEnvironment;
  readonly conversationDensity: ConversationDensity;
  readonly alertSoundsEnabled: boolean;
  readonly alertSoundSelection: AlertSoundSelection;
  readonly customAlertSoundFileName: string | null;
  readonly cursorPointerOnButtons: boolean;
  readonly diffWordWrap: boolean;
  readonly homeProjectOrder: readonly string[];
  readonly notifyWhenThreadFinishes: boolean;
  readonly notifyWhenThreadNeedsInput: boolean;
  /** Default action for the workbench Changes split button. */
  readonly gitAgentDefaultAction: GitAgentActionId;
};

const STORAGE_KEY = "honk:app:app-settings";
const DEFAULT_SNAPSHOT: AppSettings = Object.freeze({
  defaultProjectDirectory: null,
  defaultThreadEnvironment: "local",
  conversationDensity: DEFAULT_CONVERSATION_DENSITY,
  alertSoundsEnabled: true,
  alertSoundSelection: DEFAULT_ALERT_SOUND,
  customAlertSoundFileName: null,
  cursorPointerOnButtons: DEFAULT_CURSOR_POINTER_ON_BUTTONS,
  diffWordWrap: false,
  homeProjectOrder: Object.freeze([]),
  notifyWhenThreadFinishes: true,
  notifyWhenThreadNeedsInput: true,
  gitAgentDefaultAction: GIT_AGENT_DEFAULT_ACTION,
});

const listeners = new Set<() => void>();

let snapshot = hydrate();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): AppSettings {
  return snapshot;
}

export function getServerSnapshot(): AppSettings {
  return DEFAULT_SNAPSHOT;
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useDefaultProjectDirectory(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.defaultProjectDirectory,
    () => DEFAULT_SNAPSHOT.defaultProjectDirectory,
  );
}

export function useConversationDensity(): ConversationDensity {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.conversationDensity,
    () => DEFAULT_SNAPSHOT.conversationDensity,
  );
}

export function setHomeProjectOrder(homeProjectOrder: readonly string[]): void {
  if (
    homeProjectOrder.length === snapshot.homeProjectOrder.length &&
    homeProjectOrder.every((key, index) => key === snapshot.homeProjectOrder[index])
  ) {
    return;
  }
  publish({ ...snapshot, homeProjectOrder: Object.freeze([...homeProjectOrder]) });
}

export function setGitAgentDefaultAction(gitAgentDefaultAction: GitAgentActionId): void {
  if (gitAgentDefaultAction === snapshot.gitAgentDefaultAction) {
    return;
  }
  publish({ ...snapshot, gitAgentDefaultAction });
}

// Reachable from both Settings > Appearance and the Changes panel's overflow menu,
// so it is a named export rather than only an `actions` member.
export function setDiffWordWrap(diffWordWrap: boolean): void {
  if (diffWordWrap === snapshot.diffWordWrap) {
    return;
  }
  publish({ ...snapshot, diffWordWrap });
}

export const actions = {
  setDefaultProjectDirectory(directory: string | null): void {
    const next = directory === null || directory.trim().length === 0 ? null : directory;
    if (next === snapshot.defaultProjectDirectory) {
      return;
    }
    publish({ ...snapshot, defaultProjectDirectory: next });
  },

  setDefaultThreadEnvironment(defaultThreadEnvironment: DefaultThreadEnvironment): void {
    if (defaultThreadEnvironment === snapshot.defaultThreadEnvironment) {
      return;
    }
    publish({ ...snapshot, defaultThreadEnvironment });
  },

  resetDefaultThreadEnvironment(): void {
    if (snapshot.defaultThreadEnvironment === DEFAULT_SNAPSHOT.defaultThreadEnvironment) {
      return;
    }
    publish({ ...snapshot, defaultThreadEnvironment: DEFAULT_SNAPSHOT.defaultThreadEnvironment });
  },

  clearDefaultProjectDirectory(): void {
    if (snapshot.defaultProjectDirectory === null) {
      return;
    }
    publish({ ...snapshot, defaultProjectDirectory: null });
  },

  setConversationDensity(conversationDensity: ConversationDensity): void {
    if (conversationDensity === snapshot.conversationDensity) {
      return;
    }
    publish({ ...snapshot, conversationDensity });
  },

  resetConversationDensity(): void {
    if (snapshot.conversationDensity === DEFAULT_CONVERSATION_DENSITY) {
      return;
    }
    publish({ ...snapshot, conversationDensity: DEFAULT_CONVERSATION_DENSITY });
  },

  setCursorPointerOnButtons(cursorPointerOnButtons: boolean): void {
    if (cursorPointerOnButtons === snapshot.cursorPointerOnButtons) {
      return;
    }
    publish({ ...snapshot, cursorPointerOnButtons });
  },

  setAlertSoundsEnabled(alertSoundsEnabled: boolean): void {
    if (alertSoundsEnabled === snapshot.alertSoundsEnabled) {
      return;
    }
    publish({ ...snapshot, alertSoundsEnabled });
  },

  setAlertSoundSelection(alertSoundSelection: AlertSoundSelection): void {
    if (
      alertSoundSelection === snapshot.alertSoundSelection ||
      (alertSoundSelection === "custom" && snapshot.customAlertSoundFileName === null)
    ) {
      return;
    }
    publish({ ...snapshot, alertSoundSelection });
  },

  selectCustomAlertSound(customAlertSoundFileName: string): void {
    if (
      snapshot.alertSoundSelection === "custom" &&
      snapshot.customAlertSoundFileName === customAlertSoundFileName
    ) {
      return;
    }
    publish({ ...snapshot, alertSoundSelection: "custom", customAlertSoundFileName });
  },

  clearCustomAlertSound(): void {
    if (
      snapshot.alertSoundSelection === DEFAULT_ALERT_SOUND &&
      snapshot.customAlertSoundFileName === null
    ) {
      return;
    }
    publish({
      ...snapshot,
      alertSoundSelection: DEFAULT_ALERT_SOUND,
      customAlertSoundFileName: null,
    });
  },

  setDiffWordWrap,

  resetDiffWordWrap(): void {
    if (snapshot.diffWordWrap === DEFAULT_SNAPSHOT.diffWordWrap) {
      return;
    }
    publish({ ...snapshot, diffWordWrap: DEFAULT_SNAPSHOT.diffWordWrap });
  },

  setNotifyWhenThreadFinishes(notifyWhenThreadFinishes: boolean): void {
    if (notifyWhenThreadFinishes === snapshot.notifyWhenThreadFinishes) {
      return;
    }
    publish({ ...snapshot, notifyWhenThreadFinishes });
  },

  setNotifyWhenThreadNeedsInput(notifyWhenThreadNeedsInput: boolean): void {
    if (notifyWhenThreadNeedsInput === snapshot.notifyWhenThreadNeedsInput) {
      return;
    }
    publish({ ...snapshot, notifyWhenThreadNeedsInput });
  },
} as const;

function publish(next: AppSettings): void {
  snapshot = Object.freeze({ ...next });
  persist(snapshot);
  applyAppSettings(snapshot);
  for (const listener of listeners) {
    listener();
  }
}

function hydrate(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SNAPSHOT;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_SNAPSHOT;
    }
    const parsed = JSON.parse(raw) as Partial<{
      defaultProjectDirectory: unknown;
      defaultThreadEnvironment: unknown;
      conversationDensity: unknown;
      alertSoundsEnabled: unknown;
      alertSoundSelection: unknown;
      customAlertSoundFileName: unknown;
      // Legacy names from when this preference controlled a single completion sound.
      soundEffectsEnabled: unknown;
      completionSoundEnabled: unknown;
      completionSoundFileName: unknown;
      cursorPointerOnButtons: unknown;
      diffWordWrap: unknown;
      homeProjectOrder: unknown;
      notifyWhenThreadFinishes: unknown;
      notifyWhenThreadNeedsInput: unknown;
      gitAgentDefaultAction: unknown;
    }>;
    const directory =
      typeof parsed.defaultProjectDirectory === "string" &&
      parsed.defaultProjectDirectory.trim().length > 0
        ? parsed.defaultProjectDirectory
        : null;
    const customAlertSoundFileName =
      typeof parsed.customAlertSoundFileName === "string" &&
      parsed.customAlertSoundFileName.trim().length > 0
        ? parsed.customAlertSoundFileName
        : typeof parsed.completionSoundFileName === "string" &&
            parsed.completionSoundFileName.trim().length > 0
          ? parsed.completionSoundFileName
          : null;
    const alertSoundSelection = isAlertSoundSelection(parsed.alertSoundSelection)
      ? parsed.alertSoundSelection === "custom" && customAlertSoundFileName === null
        ? DEFAULT_ALERT_SOUND
        : parsed.alertSoundSelection
      : customAlertSoundFileName === null
        ? DEFAULT_ALERT_SOUND
        : "custom";
    return Object.freeze({
      defaultProjectDirectory: directory,
      defaultThreadEnvironment:
        parsed.defaultThreadEnvironment === "worktree" ? "worktree" : "local",
      conversationDensity: decodeConversationDensity(parsed.conversationDensity),
      alertSoundsEnabled:
        typeof parsed.alertSoundsEnabled === "boolean"
          ? parsed.alertSoundsEnabled
          : typeof parsed.soundEffectsEnabled === "boolean"
            ? parsed.soundEffectsEnabled
            : typeof parsed.completionSoundEnabled === "boolean"
              ? parsed.completionSoundEnabled
              : DEFAULT_SNAPSHOT.alertSoundsEnabled,
      alertSoundSelection,
      customAlertSoundFileName,
      cursorPointerOnButtons:
        typeof parsed.cursorPointerOnButtons === "boolean"
          ? parsed.cursorPointerOnButtons
          : DEFAULT_CURSOR_POINTER_ON_BUTTONS,
      diffWordWrap:
        typeof parsed.diffWordWrap === "boolean"
          ? parsed.diffWordWrap
          : DEFAULT_SNAPSHOT.diffWordWrap,
      homeProjectOrder: decodeStringList(parsed.homeProjectOrder),
      notifyWhenThreadFinishes:
        typeof parsed.notifyWhenThreadFinishes === "boolean"
          ? parsed.notifyWhenThreadFinishes
          : DEFAULT_SNAPSHOT.notifyWhenThreadFinishes,
      notifyWhenThreadNeedsInput:
        typeof parsed.notifyWhenThreadNeedsInput === "boolean"
          ? parsed.notifyWhenThreadNeedsInput
          : DEFAULT_SNAPSHOT.notifyWhenThreadNeedsInput,
      gitAgentDefaultAction:
        gitAgentActionIdOf(parsed.gitAgentDefaultAction) ?? GIT_AGENT_DEFAULT_ACTION,
    });
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

// The shared schema owns the value set AND the legacy migration ("verbose" →
// "detailed", "minimal" → "compact-all-grouped", …), so an old stored value
// converges instead of silently resetting to the default.
const decodeStoredConversationDensity = Schema.decodeUnknownSync(ConversationDensity);
function decodeConversationDensity(value: unknown): ConversationDensity {
  try {
    return decodeStoredConversationDensity(value);
  } catch {
    return DEFAULT_CONVERSATION_DENSITY;
  }
}

function decodeStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return DEFAULT_SNAPSHOT.homeProjectOrder;
  }
  return Object.freeze([...new Set(value)]);
}

function persist(next: AppSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage failure must not break settings.
  }
}

function applyAppSettings(next: AppSettings): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.toggleAttribute(
    "data-cursor-pointer-on-buttons",
    next.cursorPointerOnButtons,
  );
  setEnabled(next.alertSoundsEnabled);
}

if (typeof document !== "undefined") {
  applyAppSettings(snapshot);
}
