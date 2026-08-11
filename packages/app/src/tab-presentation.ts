// Projects tab state and the live inventory into TabStrip descriptors. Core's
// generated title wins once inventory resolves; the workspace name covers a
// fresh session before its first prompt and the brief hydration gap at boot.
// Status stays flat on purpose: `working` while the phase is not idle, plain
// `idle` otherwise; done/failed/needs-you wait for core to grow those states.

import type { Session } from "@honk/core/session";
import { basename } from "@honk/shared/paths";
import type { TabDescriptor } from "@honk/ui";

import type { TabState } from "./tab-model";

export const HOME_TAB_KEY = "home";

const LOADING_TITLE = "Loading session";

export const tabDescriptors = (
  state: TabState,
  sessions: readonly Session.SessionSummary[],
): readonly TabDescriptor[] => {
  const summaries = new Map(sessions.map((session) => [session.id, session]));
  const home: TabDescriptor = Object.freeze({
    key: HOME_TAB_KEY,
    title: "Home",
    kind: "home",
    status: "idle",
  });
  return Object.freeze([
    home,
    ...state.tabs.map((id): TabDescriptor => {
      const summary = summaries.get(id);
      const directory = summary?.directory ?? state.info[id]?.directory;
      const descriptor: TabDescriptor = {
        key: id,
        title: summary?.title ?? (directory === undefined ? LOADING_TITLE : basename(directory)),
        kind: "thread",
        status: summary !== undefined && summary.phase !== "idle" ? "working" : "idle",
        repository:
          directory === undefined
            ? { state: "loading" }
            : { state: "ready", label: basename(directory) },
        ...(directory === undefined ? {} : { path: directory }),
      };
      return Object.freeze(descriptor);
    }),
  ]);
};
