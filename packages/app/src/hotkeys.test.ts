// The chords the strip, the keyboard, and the context menu share. The pinned
// rules: ⌘1 is Home and ⌘2-9 index the tabs after it, ⌘W closes the topmost
// overlay before it closes a tab, and every command reaches the tab store
// rather than the router.

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { UseNavigateResult } from "@tanstack/react-router";

import {
  resolveShellHotkeys,
  SHELL_KEYBINDING_DEFAULTS,
  type ShellKeybindingCommand,
} from "./hotkeys";

const tabMocks = vi.hoisted(
  (): {
    readonly tabs: { current: string[] };
    readonly activate: Mock<(id: string) => void>;
    readonly closeActive: Mock<() => void>;
    readonly reopen: Mock<() => void>;
  } => ({
    tabs: { current: [] },
    activate: vi.fn(),
    closeActive: vi.fn(),
    reopen: vi.fn(),
  }),
);

const overlayMocks = vi.hoisted(() => ({
  commandMenuOpen: { current: false },
  settingsOpen: { current: false },
  closeCommandMenu: vi.fn(),
  closeSettings: vi.fn(),
}));

vi.mock("./tab-store", () => ({
  actions: {
    activate: tabMocks.activate,
    closeActive: tabMocks.closeActive,
    reopen: tabMocks.reopen,
  },
  getSnapshot: () => ({ tabs: tabMocks.tabs.current }),
}));

vi.mock("./command-menu-store", () => ({
  actions: {
    close: overlayMocks.closeCommandMenu,
    openCommand: vi.fn(),
    openThreads: vi.fn(),
  },
  getSnapshot: () => ({ open: overlayMocks.commandMenuOpen.current }),
}));

vi.mock("./settings-store", () => ({
  actions: {
    close: overlayMocks.closeSettings,
    open: vi.fn(),
    toggle: vi.fn(),
  },
  getSnapshot: () => ({ open: overlayMocks.settingsOpen.current }),
}));

vi.mock("./workbench-controller", () => ({
  workbenchActions: { toggleMaximized: vi.fn() },
}));

const navigate: UseNavigateResult<string> = vi.fn();

/** Fires the binding the table assigns to a command, by its resolved chord. */
function press(command: ShellKeybindingCommand): void {
  const chord = SHELL_KEYBINDING_DEFAULTS[command];
  const binding = resolveShellHotkeys(navigate).find((entry) => entry.hotkey === chord);
  if (binding === undefined) throw new Error("no binding registered for command");
  // The dispatch reads neither the event nor the match context.
  const invoke: Function = binding.callback;
  Reflect.apply(invoke, undefined, [{ preventDefault: () => undefined }, {}]);
}

beforeEach(() => {
  vi.clearAllMocks();
  tabMocks.tabs.current = [];
  overlayMocks.commandMenuOpen.current = false;
  overlayMocks.settingsOpen.current = false;
});

describe("the shell keybinding table", () => {
  it("binds the tab chords the titlebar advertises", () => {
    expect(SHELL_KEYBINDING_DEFAULTS["navigation.close"]).toBe("Mod+W");
    expect(SHELL_KEYBINDING_DEFAULTS["tab.reopen"]).toBe("Mod+Shift+T");
    expect(SHELL_KEYBINDING_DEFAULTS["tab.jump.1"]).toBe("Mod+1");
    expect(SHELL_KEYBINDING_DEFAULTS["tab.jump.9"]).toBe("Mod+9");
    // Every command in the table registers exactly one binding.
    const bindings = resolveShellHotkeys(navigate);
    expect(bindings).toHaveLength(Object.keys(SHELL_KEYBINDING_DEFAULTS).length);
    expect(new Set(bindings.map((entry) => entry.hotkey)).size).toBe(bindings.length);
  });

  it("takes an override without losing the rest of the table", () => {
    const bindings = resolveShellHotkeys(navigate, { "tab.reopen": "Mod+Alt+T" });
    expect(bindings.some((entry) => entry.hotkey === "Mod+Alt+T")).toBe(true);
    expect(bindings.some((entry) => entry.hotkey === "Mod+Shift+T")).toBe(false);
    expect(bindings.some((entry) => entry.hotkey === "Mod+W")).toBe(true);
  });
});

describe("the tab jump chords", () => {
  it("gives ⌘1 to Home and offsets ⌘2-9 past it", () => {
    tabMocks.tabs.current = ["ses_a", "ses_b", "ses_c"];

    press("tab.jump.1");
    expect(tabMocks.activate).toHaveBeenLastCalledWith("home");

    // The off-by-one that matters: ⌘2 is the first session, not the second.
    press("tab.jump.2");
    expect(tabMocks.activate).toHaveBeenLastCalledWith("ses_a");

    press("tab.jump.3");
    expect(tabMocks.activate).toHaveBeenLastCalledWith("ses_b");
  });

  it("does nothing when the chord points past the open tabs", () => {
    tabMocks.tabs.current = ["ses_a"];
    press("tab.jump.9");
    expect(tabMocks.activate).not.toHaveBeenCalled();
  });
});

describe("the close chord", () => {
  it("closes the command menu before the settings panel before the tab", () => {
    overlayMocks.commandMenuOpen.current = true;
    overlayMocks.settingsOpen.current = true;
    press("navigation.close");
    expect(overlayMocks.closeCommandMenu).toHaveBeenCalledTimes(1);
    expect(overlayMocks.closeSettings).not.toHaveBeenCalled();
    expect(tabMocks.closeActive).not.toHaveBeenCalled();

    overlayMocks.commandMenuOpen.current = false;
    press("navigation.close");
    expect(overlayMocks.closeSettings).toHaveBeenCalledTimes(1);
    expect(tabMocks.closeActive).not.toHaveBeenCalled();

    overlayMocks.settingsOpen.current = false;
    press("navigation.close");
    expect(tabMocks.closeActive).toHaveBeenCalledTimes(1);
  });

  it("reopens the last closed tab through the store, never the router", () => {
    press("tab.reopen");
    expect(tabMocks.reopen).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});
