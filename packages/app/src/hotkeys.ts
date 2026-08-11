// Shell hotkey registry. Shell mounts it once; leaf routes do not bind shell
// chords. Tab chords go through the tab store, so the strip, the keyboard,
// and the context menu change one selection.

import { useHotkeys } from "@tanstack/react-hotkeys";
import type { RegisterableHotkey, UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { useNavigate, type UseNavigateResult } from "@tanstack/react-router";

import {
  actions as commandMenuActions,
  getSnapshot as getCommandMenuSnapshot,
} from "./command-menu-store";
import { actions as settingsActions, getSnapshot as getSettingsSnapshot } from "./settings-store";
import { HOME_TAB_KEY } from "./tab-presentation";
import { actions as tabActions, getSnapshot as getTabsSnapshot } from "./tab-store";
import { workbenchActions } from "./workbench-controller";

export type ShellKeybindingCommand =
  | "navigation.close"
  | "navigation.newChat"
  | "tab.reopen"
  | "tab.jump.1"
  | "tab.jump.2"
  | "tab.jump.3"
  | "tab.jump.4"
  | "tab.jump.5"
  | "tab.jump.6"
  | "tab.jump.7"
  | "tab.jump.8"
  | "tab.jump.9"
  | "commandMenu.toggle"
  | "commandMenu.openThreads"
  | "settings.toggle"
  | "workbench.toggleMaximized";

export type ShellKeybindingDefaults = Readonly<Record<ShellKeybindingCommand, RegisterableHotkey>>;

export const SHELL_KEYBINDING_DEFAULTS: ShellKeybindingDefaults = {
  "navigation.close": "Mod+W",
  "navigation.newChat": "Mod+N",
  "tab.reopen": "Mod+Shift+T",
  "tab.jump.1": "Mod+1",
  "tab.jump.2": "Mod+2",
  "tab.jump.3": "Mod+3",
  "tab.jump.4": "Mod+4",
  "tab.jump.5": "Mod+5",
  "tab.jump.6": "Mod+6",
  "tab.jump.7": "Mod+7",
  "tab.jump.8": "Mod+8",
  "tab.jump.9": "Mod+9",
  "commandMenu.toggle": "Mod+K",
  "commandMenu.openThreads": "Mod+O",
  "settings.toggle": "Mod+,",
  "workbench.toggleMaximized": "Mod+Shift+M",
};

const SHELL_COMMANDS: readonly ShellKeybindingCommand[] = [
  "navigation.close",
  "navigation.newChat",
  "tab.reopen",
  "tab.jump.1",
  "tab.jump.2",
  "tab.jump.3",
  "tab.jump.4",
  "tab.jump.5",
  "tab.jump.6",
  "tab.jump.7",
  "tab.jump.8",
  "tab.jump.9",
  "commandMenu.toggle",
  "commandMenu.openThreads",
  "settings.toggle",
  "workbench.toggleMaximized",
];

const JUMP_COMMANDS = [
  "tab.jump.1",
  "tab.jump.2",
  "tab.jump.3",
  "tab.jump.4",
  "tab.jump.5",
  "tab.jump.6",
  "tab.jump.7",
  "tab.jump.8",
  "tab.jump.9",
] satisfies readonly ShellKeybindingCommand[];

type HotkeyBinding = UseHotkeyDefinition;
type Navigate = UseNavigateResult<string>;

function bind(hotkey: RegisterableHotkey, callback: () => void): HotkeyBinding {
  return { hotkey, callback, options: { preventDefault: true, ignoreInputs: false } };
}

/** ⌘1 is Home; ⌘2–9 jump across the projected tab order after it. */
function activateIndex(index: number): void {
  if (index === 0) {
    tabActions.activate(HOME_TAB_KEY);
    return;
  }
  const id = getTabsSnapshot().tabs[index - 1];
  if (id !== undefined) tabActions.activate(id);
}

function dispatch(command: ShellKeybindingCommand, navigate: Navigate): void {
  switch (command) {
    case "navigation.close":
      // Close the topmost overlay first. A modal sits over the task, not instead of it.
      if (getCommandMenuSnapshot().open) {
        commandMenuActions.close();
      } else if (getSettingsSnapshot().open) {
        settingsActions.close();
      } else {
        tabActions.closeActive();
      }
      return;
    case "navigation.newChat":
      void navigate({ to: "/chat" });
      return;
    case "tab.reopen":
      tabActions.reopen();
      return;
    case "tab.jump.1":
    case "tab.jump.2":
    case "tab.jump.3":
    case "tab.jump.4":
    case "tab.jump.5":
    case "tab.jump.6":
    case "tab.jump.7":
    case "tab.jump.8":
    case "tab.jump.9": {
      const index = JUMP_COMMANDS.indexOf(command);
      if (index >= 0) activateIndex(index);
      return;
    }
    case "commandMenu.toggle":
      settingsActions.close();
      commandMenuActions.openCommand();
      return;
    case "commandMenu.openThreads":
      settingsActions.close();
      commandMenuActions.openThreads();
      return;
    case "settings.toggle":
      commandMenuActions.close();
      settingsActions.toggle();
      return;
    case "workbench.toggleMaximized":
      workbenchActions.toggleMaximized();
      return;
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

export function resolveShellHotkeys(
  navigate: Navigate,
  overrides?: Partial<ShellKeybindingDefaults>,
): HotkeyBinding[] {
  const resolved: ShellKeybindingDefaults = {
    ...SHELL_KEYBINDING_DEFAULTS,
    ...overrides,
  };
  return SHELL_COMMANDS.map((command) =>
    bind(resolved[command], () => {
      dispatch(command, navigate);
    }),
  );
}

export function useShellHotkeys(
  overrides?: Partial<ShellKeybindingDefaults>,
  enabled = true,
): void {
  const navigate = useNavigate();
  useHotkeys(resolveShellHotkeys(navigate, overrides), { enabled });
}
