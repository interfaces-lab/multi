import type { TabDescriptor } from "@honk/ui";

import type { StatusFilter } from "./extension";

export type SidebarTab = Exclude<TabDescriptor, { readonly kind: "home" }>;
export type ScrollFadeEdges = { readonly showTop: boolean; readonly showBottom: boolean };

// Cursor gates each sidebar fade term on a 5px scroll threshold so a rested scroller shows no
// mask at all.
const SCROLL_FADE_THRESHOLD = 5;

export function scrollFadeEdges(metrics: {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}): ScrollFadeEdges {
  return {
    showTop: metrics.scrollTop > SCROLL_FADE_THRESHOLD,
    showBottom:
      metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop > SCROLL_FADE_THRESHOLD,
  };
}

export type WorkspaceTabGroup = {
  readonly key: string;
  readonly label: string;
  readonly path?: string;
  readonly tabs: readonly { readonly tab: SidebarTab; readonly index: number }[];
};

export function workspaceKey(tab: SidebarTab): string {
  return tab.path ?? `${tab.repository.state}:${tab.key}`;
}

export function groupHasPath(group: WorkspaceTabGroup): boolean {
  return group.tabs[0]?.tab.path !== undefined;
}

export function groupWorkspaceTabs(tabs: readonly TabDescriptor[]): readonly WorkspaceTabGroup[] {
  const groups = tabs.reduce((result, tab, index) => {
    if (tab.kind === "home") return result;
    const key = workspaceKey(tab);
    const existing = result.get(key);
    if (existing !== undefined) {
      existing.tabs.push({ tab, index });
      return result;
    }
    result.set(key, {
      key,
      label: workspaceLabel(tab),
      ...(tab.path === undefined ? {} : { path: tab.path }),
      tabs: [{ tab, index }],
    });
    return result;
  }, new Map<string, Omit<WorkspaceTabGroup, "tabs"> & { tabs: { tab: SidebarTab; index: number }[] }>());

  return Object.freeze(
    [...groups.values()].map((group) =>
      Object.freeze({ ...group, tabs: Object.freeze([...group.tabs]) }),
    ),
  );
}

export function tabMatchesFilters(tab: SidebarTab, filters: readonly StatusFilter[]): boolean {
  return filters.length === 0 || filters.some((filter) => filter === tab.status);
}

export function mergeWorkspaceOrder(
  groups: readonly WorkspaceTabGroup[],
  rankedKeys: readonly string[],
): readonly WorkspaceTabGroup[] {
  const ranks = rankedKeys.reduce((result, key, index) => {
    if (!result.has(key)) result.set(key, index);
    return result;
  }, new Map<string, number>());

  return Object.freeze(
    groups
      .map((group, index) => ({ group, index, rank: ranks.get(group.key) }))
      .sort((left, right) => {
        if (left.rank !== undefined && right.rank !== undefined) return left.rank - right.rank;
        if (left.rank !== undefined) return -1;
        if (right.rank !== undefined) return 1;
        return left.index - right.index;
      })
      .map((entry) => entry.group),
  );
}

export function resolveWorkspaceDrop(options: {
  readonly orderedKeys: readonly string[];
  readonly sourceKey: string;
  readonly anchorKey: string;
  readonly dropAfter: boolean;
}): readonly string[] {
  if (
    options.sourceKey === options.anchorKey ||
    !options.orderedKeys.includes(options.sourceKey) ||
    !options.orderedKeys.includes(options.anchorKey)
  ) {
    return Object.freeze([...options.orderedKeys]);
  }

  const withoutSource = options.orderedKeys.filter((key) => key !== options.sourceKey);
  const anchorIndex = withoutSource.indexOf(options.anchorKey);
  const insertionIndex = anchorIndex + (options.dropAfter ? 1 : 0);
  return Object.freeze([
    ...withoutSource.slice(0, insertionIndex),
    options.sourceKey,
    ...withoutSource.slice(insertionIndex),
  ]);
}

export function prunePersistedOrder(
  nextOrder: readonly string[],
  mountedKeys: readonly string[],
  cap: number,
): readonly string[] {
  const uniqueOrder = [...new Set(nextOrder)];
  const normalizedCap = Math.max(0, Math.floor(cap));
  if (uniqueOrder.length <= normalizedCap) return Object.freeze(uniqueOrder);

  const mounted = new Set(mountedKeys);
  const mountedCount = uniqueOrder.filter((key) => mounted.has(key)).length;
  const staleCapacity = Math.max(0, normalizedCap - mountedCount);
  const staleKeys = uniqueOrder.filter((key) => !mounted.has(key));
  const staleToKeep = new Set(staleCapacity === 0 ? [] : staleKeys.slice(-staleCapacity));
  return Object.freeze(uniqueOrder.filter((key) => mounted.has(key) || staleToKeep.has(key)));
}

export function filterWorkspaceGroups(
  groups: readonly WorkspaceTabGroup[],
  filters: readonly StatusFilter[],
): readonly WorkspaceTabGroup[] {
  return groups
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter((entry) => tabMatchesFilters(entry.tab, filters)),
    }))
    .filter((group) => filters.length === 0 || group.tabs.length > 0);
}

export function buildWorkspaceDrop(options: {
  readonly groups: readonly WorkspaceTabGroup[];
  readonly rankedKeys: readonly string[];
  readonly sourceKey: string;
  readonly anchorKey: string;
  readonly dropAfter: boolean;
  readonly cap: number;
}): readonly string[] {
  const knownKeys = new Set(options.groups.map((group) => group.key));
  const mountedKeys = options.groups.filter(groupHasPath).map((group) => group.key);
  const mounted = new Set(mountedKeys);
  const fullOrder = [
    ...options.rankedKeys.filter((key) => !knownKeys.has(key) || mounted.has(key)),
    ...mergeWorkspaceOrder(options.groups, options.rankedKeys)
      .map((group) => group.key)
      .filter((key) => !options.rankedKeys.includes(key)),
  ];
  const nextOrder = resolveWorkspaceDrop({
    orderedKeys: fullOrder,
    sourceKey: options.sourceKey,
    anchorKey: options.anchorKey,
    dropAfter: options.dropAfter,
  }).filter((key) => !knownKeys.has(key) || mounted.has(key));
  return prunePersistedOrder(nextOrder, mountedKeys, options.cap);
}

export function toggleCollapsedKey(
  current: readonly string[],
  key: string,
  groups: readonly WorkspaceTabGroup[],
  cap: number,
): readonly string[] {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  const mountedKeys = groups.filter(groupHasPath).map((group) => group.key);
  return prunePersistedOrder([...next], mountedKeys, cap);
}

// Persisted keys only bind path-backed groups; session keys only bind the transient ones. Keys
// for groups that are not mounted stay stored but do not collapse anything.
export function collapsedKeySet(
  groups: readonly WorkspaceTabGroup[],
  persistedKeys: readonly string[],
  ephemeralKeys: readonly string[],
): ReadonlySet<string> {
  const knownGroups = new Map(groups.map((group) => [group.key, groupHasPath(group)]));
  return new Set([
    ...persistedKeys.filter((key) => knownGroups.get(key) === true),
    ...ephemeralKeys.filter((key) => knownGroups.get(key) === false),
  ]);
}

export function toggleSessionCollapsedKey(
  current: readonly string[],
  key: string,
  groups: readonly WorkspaceTabGroup[],
): readonly string[] {
  const knownKeys = new Set(
    groups.filter((group) => !groupHasPath(group)).map((group) => group.key),
  );
  const next = new Set(current.filter((candidate) => knownKeys.has(candidate)));
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return Object.freeze([...next]);
}

export function statusTone(
  status: TabDescriptor["status"],
): "ok" | "warn" | "err" | "neutral" | "draft" {
  switch (status) {
    case "done":
      return "ok";
    case "needs-you":
      return "warn";
    case "failed":
      return "err";
    case "draft":
      return "draft";
    case "idle":
    case "working":
      return "neutral";
  }
}

export function statusLabel(status: TabDescriptor["status"]): string {
  switch (status) {
    case "needs-you":
      return "Needs you";
    case "working":
      return "Working";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "draft":
      return "Draft";
    case "idle":
      return "Idle";
  }
}

function workspaceLabel(tab: SidebarTab): string {
  if (tab.repository.state === "ready") return tab.repository.label;
  return tab.repository.state === "loading" ? "Loading workspace" : "Workspace unavailable";
}
