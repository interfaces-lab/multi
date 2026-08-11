import type { TabDescriptor } from "@honk/ui";
import { describe, expect, it } from "vitest";

import {
  buildWorkspaceDrop,
  collapsedKeySet,
  groupWorkspaceTabs,
  groupHasPath,
  mergeWorkspaceOrder,
  prunePersistedOrder,
  resolveWorkspaceDrop,
  scrollFadeEdges,
  tabMatchesFilters,
  toggleCollapsedKey,
  toggleSessionCollapsedKey,
  type SidebarTab,
  type WorkspaceTabGroup,
} from "./model";

const home: TabDescriptor = { key: "home", title: "Home", kind: "home", status: "idle" };

function thread(
  key: string,
  options: {
    readonly path?: string;
    readonly repository?: SidebarTab["repository"];
    readonly status?: SidebarTab["status"];
  } = {},
): SidebarTab {
  return {
    key,
    title: key,
    kind: "thread",
    status: options.status ?? "idle",
    repository: options.repository ?? {
      state: "ready",
      label: options.path?.split("/").at(-1) ?? "repo",
    },
    ...(options.path === undefined ? {} : { path: options.path }),
  };
}

function group(key: string): WorkspaceTabGroup {
  return {
    key,
    label: key,
    path: `/${key}`,
    tabs: [{ tab: thread(`${key}-tab`, { path: `/${key}` }), index: 1 }],
  };
}

function ephemeralGroup(key: string): WorkspaceTabGroup {
  return {
    key,
    label: key,
    tabs: [{ tab: thread(`${key}-tab`, { repository: { state: "loading" } }), index: 1 }],
  };
}

describe("vertical sidebar model", () => {
  it("excludes Home and groups path-backed tabs by path", () => {
    const groups = groupWorkspaceTabs([
      home,
      thread("repo-a", { path: "/repo" }),
      thread("other-a", { path: "/other" }),
      thread("repo-b", { path: "/repo" }),
    ]);

    expect(
      groups.map((entry) => ({
        key: entry.key,
        tabs: entry.tabs.map((tab) => [tab.tab.key, tab.index]),
      })),
    ).toEqual([
      {
        key: "/repo",
        tabs: [
          ["repo-a", 1],
          ["repo-b", 3],
        ],
      },
      { key: "/other", tabs: [["other-a", 2]] },
    ]);
    expect(groups.every(groupHasPath)).toBe(true);
  });

  it("uses state and tab key fallbacks for ephemeral workspaces", () => {
    const groups = groupWorkspaceTabs([
      thread("loading-a", { repository: { state: "loading" } }),
      thread("loading-b", { repository: { state: "loading" } }),
      thread("error", { repository: { state: "unavailable" } }),
    ]);

    expect(groups.map((entry) => entry.key)).toEqual([
      "loading:loading-a",
      "loading:loading-b",
      "unavailable:error",
    ]);
    expect(groups.some(groupHasPath)).toBe(false);
  });

  it("merges ranked groups first and appends unknown groups in derived order", () => {
    expect(
      mergeWorkspaceOrder([group("a"), group("b"), group("c")], ["c", "stale", "a"]).map(
        (entry) => entry.key,
      ),
    ).toEqual(["c", "a", "b"]);
  });

  it("resolves before and after drops after removing the source", () => {
    expect(
      resolveWorkspaceDrop({
        orderedKeys: ["a", "b", "c", "d"],
        sourceKey: "a",
        anchorKey: "c",
        dropAfter: false,
      }),
    ).toEqual(["b", "a", "c", "d"]);
    expect(
      resolveWorkspaceDrop({
        orderedKeys: ["a", "b", "c", "d"],
        sourceKey: "a",
        anchorKey: "c",
        dropAfter: true,
      }),
    ).toEqual(["b", "c", "a", "d"]);
    expect(
      resolveWorkspaceDrop({
        orderedKeys: ["a", "b", "c", "d"],
        sourceKey: "d",
        anchorKey: "b",
        dropAfter: true,
      }),
    ).toEqual(["a", "b", "d", "c"]);
  });

  it("inserts relative to a visible anchor in the full order with filtered groups between", () => {
    expect(
      resolveWorkspaceDrop({
        orderedKeys: ["source", "hidden-before", "anchor", "hidden-after", "tail"],
        sourceKey: "source",
        anchorKey: "anchor",
        dropAfter: true,
      }),
    ).toEqual(["hidden-before", "anchor", "source", "hidden-after", "tail"]);
  });

  it("prunes oldest stale ranks to the cap while mounted workspaces survive", () => {
    expect(
      prunePersistedOrder(
        ["stale-old", "mounted-a", "stale-new", "mounted-b"],
        ["mounted-a", "mounted-b"],
        2,
      ),
    ).toEqual(["mounted-a", "mounted-b"]);
    expect(
      prunePersistedOrder(
        ["stale-old", "mounted-a", "stale-new", "mounted-b"],
        ["mounted-a", "mounted-b"],
        3,
      ),
    ).toEqual(["mounted-a", "stale-new", "mounted-b"]);
  });

  it("keeps stale workspace ranks while the order remains under the cap", () => {
    expect(prunePersistedOrder(["stale", "mounted"], ["mounted"], 50)).toEqual([
      "stale",
      "mounted",
    ]);
  });

  it("matches all tabs without filters and any selected status otherwise", () => {
    expect(tabMatchesFilters(thread("idle"), [])).toBe(true);
    expect(tabMatchesFilters(thread("idle"), ["working"])).toBe(false);
    expect(tabMatchesFilters(thread("idle"), ["working", "idle"])).toBe(true);
    expect(tabMatchesFilters(thread("working", { status: "working" }), ["working"])).toBe(true);
  });

  it("persists a path-backed drop before or after the anchor", () => {
    const groups = [group("a"), group("b"), group("c")];
    expect(
      buildWorkspaceDrop({
        groups,
        rankedKeys: [],
        sourceKey: "a",
        anchorKey: "c",
        dropAfter: true,
        cap: 50,
      }),
    ).toEqual(["b", "c", "a"]);
    expect(
      buildWorkspaceDrop({
        groups,
        rankedKeys: [],
        sourceKey: "c",
        anchorKey: "a",
        dropAfter: false,
        cap: 50,
      }),
    ).toEqual(["c", "a", "b"]);
  });

  it("never persists an ephemeral drag source", () => {
    expect(
      buildWorkspaceDrop({
        groups: [group("a"), ephemeralGroup("e")],
        rankedKeys: ["a"],
        sourceKey: "e",
        anchorKey: "a",
        dropAfter: true,
        cap: 50,
      }),
    ).toEqual(["a"]);
  });

  it("positions the source relative to path-backed neighbors across an ephemeral anchor", () => {
    expect(
      buildWorkspaceDrop({
        groups: [group("a"), ephemeralGroup("e"), group("b"), group("c")],
        rankedKeys: [],
        sourceKey: "c",
        anchorKey: "e",
        dropAfter: false,
        cap: 50,
      }),
    ).toEqual(["a", "c", "b"]);
  });

  it("keeps stale ranked workspaces under the cap when persisting a drop", () => {
    expect(
      buildWorkspaceDrop({
        groups: [group("a"), group("b")],
        rankedKeys: ["stale", "a"],
        sourceKey: "b",
        anchorKey: "a",
        dropAfter: false,
        cap: 50,
      }),
    ).toEqual(["stale", "b", "a"]);
  });

  it("enforces the cap on drop with mounted workspaces surviving", () => {
    expect(
      buildWorkspaceDrop({
        groups: [group("a"), group("b")],
        rankedKeys: ["s1", "s2", "a"],
        sourceKey: "b",
        anchorKey: "a",
        dropAfter: true,
        cap: 3,
      }),
    ).toEqual(["s2", "a", "b"]);
  });

  it("keeps stale collapse keys sticky when toggling another workspace", () => {
    expect(toggleCollapsedKey(["stale"], "a", [group("a"), group("b")], 50)).toEqual([
      "stale",
      "a",
    ]);
    expect(toggleCollapsedKey(["stale", "a"], "a", [group("a"), group("b")], 50)).toEqual([
      "stale",
    ]);
  });

  it("evicts stale collapse keys only past the cap", () => {
    expect(toggleCollapsedKey(["s1", "s2"], "a", [group("a")], 2)).toEqual(["s2", "a"]);
  });

  it("prunes session collapse keys to mounted ephemeral groups", () => {
    const groups = [ephemeralGroup("e1"), ephemeralGroup("e2"), group("a")];
    expect(toggleSessionCollapsedKey(["gone", "e1"], "e2", groups)).toEqual(["e1", "e2"]);
    expect(toggleSessionCollapsedKey(["e1", "e2"], "e1", groups)).toEqual(["e2"]);
  });
});

describe("scrollFadeEdges", () => {
  it("masks neither edge when the content fits", () => {
    expect(scrollFadeEdges({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 })).toEqual({
      showTop: false,
      showBottom: false,
    });
  });

  it("masks only the bottom edge at rest above overflowing content", () => {
    expect(scrollFadeEdges({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 })).toEqual({
      showTop: false,
      showBottom: true,
    });
  });

  it("masks both edges mid-scroll", () => {
    expect(scrollFadeEdges({ scrollTop: 100, scrollHeight: 400, clientHeight: 200 })).toEqual({
      showTop: true,
      showBottom: true,
    });
  });

  it("masks only the top edge at the end of the scroller", () => {
    expect(scrollFadeEdges({ scrollTop: 200, scrollHeight: 400, clientHeight: 200 })).toEqual({
      showTop: true,
      showBottom: false,
    });
  });

  it("ignores sub-threshold overscroll on either edge", () => {
    expect(scrollFadeEdges({ scrollTop: 5, scrollHeight: 405, clientHeight: 200 })).toEqual({
      showTop: false,
      showBottom: true,
    });
    expect(scrollFadeEdges({ scrollTop: 195, scrollHeight: 400, clientHeight: 200 })).toEqual({
      showTop: true,
      showBottom: false,
    });
  });
});

describe("collapsedKeySet", () => {
  const groups = [group("a"), ephemeralGroup("e1")];

  it("binds persisted keys to path-backed groups and session keys to transient ones", () => {
    expect([...collapsedKeySet(groups, ["a"], ["e1"])]).toEqual(["a", "e1"]);
  });

  it("ignores keys whose group is not mounted", () => {
    expect([...collapsedKeySet(groups, ["gone"], ["also-gone"])]).toEqual([]);
  });

  it("does not let a persisted key collapse a transient group, or the reverse", () => {
    expect([...collapsedKeySet(groups, ["e1"], ["a"])]).toEqual([]);
  });
});
