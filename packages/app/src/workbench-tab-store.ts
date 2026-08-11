import type { Session } from "@honk/core/session";
import { normalizePathSeparators } from "@honk/shared/paths";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import type { WorkbenchToolKind } from "./workbench-tool-tabs";

// Tabs are keyed per workspace and owned by the core chat session that opened
// them: the owner is what scopes a browser surface's desktop resources, and a
// Changes tab follows the session whose thread sits beside it.

type WorkbenchChangesTab = {
  readonly id: "changes";
  readonly kind: "changes";
  readonly owner: Session.SessionId;
};

/** The workspace tree. One per workspace, so its ID is the kind. */
type WorkbenchFilesTab = {
  readonly id: "files";
  readonly kind: "files";
};

// One read-only viewer per path. Separate from "files" because `reusableToolTab` matches by kind,
// which would collapse every opened file into a single tab.
type WorkbenchFileTab = {
  readonly id: string;
  readonly kind: "file";
  readonly filePath: string;
};

// Terminals are workspace-scoped, not owner-scoped: an agent-started job keeps
// its tab when the workbench parent changes, so only the terminal id is kept.
type WorkbenchTerminalTab = {
  readonly id: string;
  readonly kind: "terminal";
  readonly terminalID: string;
};

type WorkbenchBrowserTab = {
  readonly id: string;
  readonly kind: "browser";
  readonly owner: Session.SessionId;
  readonly browserID: string;
};

type WorkbenchTab =
  | WorkbenchChangesTab
  | WorkbenchFilesTab
  | WorkbenchFileTab
  | WorkbenchTerminalTab
  | WorkbenchBrowserTab;

type WorkbenchWorkspaceTabs = {
  readonly tabs: readonly WorkbenchTab[];
  readonly activeTabID: string | null;
  readonly expanded: boolean;
};

type WorkbenchTabStoreSnapshot = {
  readonly byWorkspace: Readonly<Record<string, WorkbenchWorkspaceTabs>>;
};

type WorkbenchTabStoreOptions = {
  readonly createID?: () => string;
};

type WorkbenchTabCloseResult = {
  readonly closed: WorkbenchTab | null;
  readonly activeTabID: string | null;
};

type WorkbenchTabStore = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WorkbenchTabStoreSnapshot;
  readonly getWorkspace: (workspaceKey: string) => WorkbenchWorkspaceTabs;
  readonly actions: {
    readonly openTool: (
      workspaceKey: string,
      kind: WorkbenchToolKind,
      owner: Session.SessionId,
      options?: { readonly newInstance?: boolean },
    ) => WorkbenchTab;
    readonly openFile: (workspaceKey: string, filePath: string) => WorkbenchFileTab;
    readonly activate: (workspaceKey: string, tabID: string) => WorkbenchTab | null;
    readonly setExpanded: (workspaceKey: string, expanded: boolean) => void;
    readonly close: (workspaceKey: string, tabID: string) => WorkbenchTabCloseResult;
  };
};

const EMPTY_WORKSPACE: WorkbenchWorkspaceTabs = Object.freeze({
  tabs: Object.freeze([]),
  activeTabID: null,
  expanded: false,
});

function createWorkbenchTabStore(options: WorkbenchTabStoreOptions = {}): WorkbenchTabStore {
  const listeners = new Set<() => void>();
  const createID = options.createID ?? randomID;
  let snapshot = freezeSnapshot({});

  const publishWorkspace = (workspaceKey: string, workspace: WorkbenchWorkspaceTabs): void => {
    const current = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
    if (workspace === current) return;
    snapshot = freezeSnapshot({ ...snapshot.byWorkspace, [workspaceKey]: workspace });
    for (const listener of listeners) listener();
  };

  const actions: WorkbenchTabStore["actions"] = {
    openTool(workspaceKey, kind, owner, actionOptions) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const result = openToolTab(
        workspace,
        kind,
        owner,
        actionOptions?.newInstance === true,
        createID,
      );
      publishWorkspace(workspaceKey, result.workspace);
      return result.tab;
    },
    openFile(workspaceKey, filePath) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const tab = createFileTab(filePath);
      const open = workspace.tabs.find(
        (candidate): candidate is WorkbenchFileTab =>
          candidate.kind === "file" && candidate.filePath === tab.filePath,
      );
      if (open !== undefined) {
        publishWorkspace(workspaceKey, activateTab(workspace, open.id));
        return open;
      }
      publishWorkspace(workspaceKey, freezeWorkspace([...workspace.tabs, tab], tab.id, true));
      return tab;
    },
    activate(workspaceKey, tabID) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const tab = workspace.tabs.find((candidate) => candidate.id === tabID) ?? null;
      if (tab === null) return null;
      publishWorkspace(workspaceKey, activateTab(workspace, tabID));
      return tab;
    },
    setExpanded(workspaceKey, expanded) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      if (workspace.expanded === expanded) return;
      publishWorkspace(
        workspaceKey,
        freezeWorkspace(workspace.tabs, workspace.activeTabID, expanded),
      );
    },
    close(workspaceKey, tabID) {
      const workspace = snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE;
      const index = workspace.tabs.findIndex((tab) => tab.id === tabID);
      const closed = index < 0 ? null : (workspace.tabs[index] ?? null);
      if (closed === null) {
        return Object.freeze({ closed: null, activeTabID: workspace.activeTabID });
      }
      const tabs = workspace.tabs.filter((tab) => tab.id !== tabID);
      const activeTabID =
        workspace.activeTabID !== tabID
          ? workspace.activeTabID
          : (tabs[Math.min(index, tabs.length - 1)]?.id ?? null);
      publishWorkspace(
        workspaceKey,
        freezeWorkspace(tabs, activeTabID, activeTabID === null ? false : workspace.expanded),
      );
      return Object.freeze({ closed, activeTabID });
    },
  };

  return Object.freeze({
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getWorkspace: (workspaceKey) => snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE,
    actions: Object.freeze(actions),
  });
}

function openToolTab(
  workspace: WorkbenchWorkspaceTabs,
  kind: WorkbenchToolKind,
  owner: Session.SessionId,
  newInstance: boolean,
  createID: () => string,
): { readonly workspace: WorkbenchWorkspaceTabs; readonly tab: WorkbenchTab } {
  const existing = reusableToolTab(workspace, kind, newInstance);
  if (existing !== null) {
    const tab =
      existing.kind === "changes" && existing.owner !== owner
        ? Object.freeze({ ...existing, owner })
        : existing;
    const tabs = tab === existing ? workspace.tabs : replaceTab(workspace.tabs, tab);
    return Object.freeze({
      workspace: freezeWorkspace(tabs, tab.id, true),
      tab,
    });
  }

  const tab = createToolTab(kind, owner, createID());
  return Object.freeze({
    workspace: freezeWorkspace([...workspace.tabs, tab], tab.id, true),
    tab,
  });
}

function reusableToolTab(
  workspace: WorkbenchWorkspaceTabs,
  kind: WorkbenchToolKind,
  newInstance: boolean,
): WorkbenchTab | null {
  if (newInstance && (kind === "terminal" || kind === "browser")) return null;
  const active = workspace.tabs.find(
    (tab) => tab.id === workspace.activeTabID && tab.kind === kind,
  );
  return active ?? workspace.tabs.find((tab) => tab.kind === kind) ?? null;
}

function createToolTab(
  kind: WorkbenchToolKind,
  owner: Session.SessionId,
  resourceID: string,
): WorkbenchTab {
  if (kind === "changes") {
    return Object.freeze({ id: "changes", kind, owner });
  }
  if (kind === "files") {
    return Object.freeze({ id: "files", kind });
  }
  if (kind === "terminal") {
    return Object.freeze({ id: terminalTabID(resourceID), kind, terminalID: resourceID });
  }
  return Object.freeze({
    id: browserTabID(owner, resourceID),
    kind,
    owner,
    browserID: resourceID,
  });
}

function createFileTab(filePath: string): WorkbenchFileTab {
  // Normalizing here is what makes "one tab per path" hold: a Windows host's `src\a.ts` and a
  // core listing's `src/a.ts` must resolve to the same tab ID.
  const path = normalizePathSeparators(filePath).replace(/\/+$/, "").trim();
  return Object.freeze({ id: fileTabID(path), kind: "file", filePath: path });
}

function activateTab(workspace: WorkbenchWorkspaceTabs, tabID: string): WorkbenchWorkspaceTabs {
  return workspace.activeTabID === tabID && workspace.expanded
    ? workspace
    : freezeWorkspace(workspace.tabs, tabID, true);
}

function replaceTab(
  tabs: readonly WorkbenchTab[],
  replacement: WorkbenchTab,
): readonly WorkbenchTab[] {
  return tabs.map((tab) => (tab.id === replacement.id ? replacement : tab));
}

// Tab IDs never leave the store — selection is component state, not a route —
// so the ID only needs to be unique and stable per resource.
function fileTabID(filePath: string): string {
  return `file:${filePath}`;
}

function terminalTabID(terminalID: string): string {
  return `terminal:${encodeURIComponent(terminalID)}`;
}

function browserTabID(owner: Session.SessionId, browserID: string): string {
  return `browser:${encodeURIComponent(owner)}:${encodeURIComponent(browserID)}`;
}

function freezeWorkspace(
  tabs: readonly WorkbenchTab[],
  activeTabID: string | null,
  expanded = false,
): WorkbenchWorkspaceTabs {
  const resolvedActive =
    activeTabID !== null && tabs.some((tab) => tab.id === activeTabID) ? activeTabID : null;
  return Object.freeze({
    tabs: Object.freeze([...tabs]),
    activeTabID: resolvedActive,
    expanded,
  });
}

function freezeSnapshot(
  byWorkspace: Readonly<Record<string, WorkbenchWorkspaceTabs>>,
): WorkbenchTabStoreSnapshot {
  return Object.freeze({ byWorkspace: Object.freeze({ ...byWorkspace }) });
}

function randomID(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const workbenchTabStore = createWorkbenchTabStore();

function useWorkbenchTabs(workspaceKey: string): WorkbenchWorkspaceTabs {
  return useSyncExternalStoreWithSelector(
    workbenchTabStore.subscribe,
    workbenchTabStore.getSnapshot,
    workbenchTabStore.getSnapshot,
    (snapshot) => snapshot.byWorkspace[workspaceKey] ?? EMPTY_WORKSPACE,
  );
}

const workbenchTabActions = workbenchTabStore.actions;

export {
  browserTabID,
  createWorkbenchTabStore,
  fileTabID,
  terminalTabID,
  useWorkbenchTabs,
  workbenchTabActions,
};
export type {
  WorkbenchBrowserTab,
  WorkbenchFileTab,
  WorkbenchTab,
  WorkbenchTabCloseResult,
  WorkbenchTabStore,
  WorkbenchTabStoreOptions,
  WorkbenchTerminalTab,
  WorkbenchWorkspaceTabs,
};
