import { useSyncExternalStore } from "react";
import { Option, Schema } from "effect";

import { WorkbenchToolKindSchema, type WorkbenchToolKind } from "./workbench-tool-tabs";

// The Changes panel composes diff cards + a 220px tree rail (Cursor's model); 400
// starved both columns. Wider default and ceiling let the panel showcase content.
const WORKBENCH_WIDTH_DEFAULT = 560;
const WORKBENCH_WIDTH_MIN = 300;
const WORKBENCH_WIDTH_MAX = 960;
const STORAGE_KEY = "honk:app:workbench:v1";

type WorkbenchState = {
  readonly isRailMinimized: boolean;
  readonly isMaximized: boolean;
  readonly width: number;
  readonly lastTab: WorkbenchToolKind;
};

const PersistedWorkbenchFields = Schema.Struct({
  isRailMinimized: Schema.optionalKey(Schema.Unknown),
  isMaximized: Schema.optionalKey(Schema.Unknown),
  width: Schema.optionalKey(Schema.Unknown),
  lastTab: Schema.optionalKey(Schema.Unknown),
});
const decodePersistedWorkbenchFields = Schema.decodeUnknownOption(PersistedWorkbenchFields);
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);
const decodeNumber = Schema.decodeUnknownOption(Schema.Finite);
const decodeWorkbenchToolKind = Schema.decodeUnknownOption(WorkbenchToolKindSchema);

function clampWorkbenchWidth(width: number): number {
  return Math.min(WORKBENCH_WIDTH_MAX, Math.max(WORKBENCH_WIDTH_MIN, width));
}

// The snapshot is read field by field with a per-field fallback, so the key never needs a version
// bump: a pre-`isMaximized` blob loads with the rest of its fields intact and maximized off. A
// A stored tab that no longer exists falls back to "changes" the same way.
function readPersisted(): WorkbenchState {
  const fallback: WorkbenchState = {
    isRailMinimized: false,
    isMaximized: false,
    width: WORKBENCH_WIDTH_DEFAULT,
    lastTab: "changes",
  };
  if (globalThis.window === undefined) return fallback;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return fallback;
    const parsed = Option.getOrNull(decodePersistedWorkbenchFields(JSON.parse(raw)));
    if (parsed === null) return fallback;
    return {
      isRailMinimized: Option.getOrElse(decodeBoolean(parsed.isRailMinimized), () => false),
      isMaximized: Option.getOrElse(decodeBoolean(parsed.isMaximized), () => false),
      width: clampWorkbenchWidth(
        Option.getOrElse(decodeNumber(parsed.width), () => WORKBENCH_WIDTH_DEFAULT),
      ),
      lastTab: Option.getOrElse(decodeWorkbenchToolKind(parsed.lastTab), () => "changes"),
    };
  } catch {
    return fallback;
  }
}

let state: WorkbenchState = readPersisted();
const listeners = new Set<() => void>();

function setState(next: WorkbenchState): void {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage failure must not clear the in-memory session state.
  }
  for (const listener of listeners) listener();
}

const workbenchActions = {
  rememberTab(tab: WorkbenchToolKind): void {
    setState({ ...state, lastTab: tab });
  },
  setWidth(width: number): void {
    setState({ ...state, width: clampWorkbenchWidth(width) });
  },
  setRailMinimized(isRailMinimized: boolean): void {
    setState({ ...state, isRailMinimized });
  },
  setMaximized(isMaximized: boolean): void {
    if (state.isMaximized === isMaximized) return;
    setState({ ...state, isMaximized });
  },
  toggleMaximized(): void {
    // Away from a chat thread the chord has nothing to maximize; flipping a persisted
    // preference with no visible outcome is worse than ignoring the key. The workbench
    // itself additionally gates rendering on an open panel.
    if (globalThis.window === undefined || !window.location.pathname.startsWith("/chat/")) return;
    setState({ ...state, isMaximized: !state.isMaximized });
  },
};

function useWorkbench<T>(selector: (current: WorkbenchState) => T): T {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => selector(state),
    () => selector(state),
  );
}

export { WORKBENCH_WIDTH_MAX, WORKBENCH_WIDTH_MIN, useWorkbench, workbenchActions };
export type { WorkbenchState };
