import { describe, expect, it } from "vitest";

import { Session } from "@honk/core/session";

import {
  CLOSED_TAB_LIMIT,
  closeTab,
  createTabState,
  hydrateTabState,
  openTab,
  rememberDirectory,
  removeSessions,
  reopenClosedTab,
  reorderTabs,
  serializeTabState,
  type TabState,
} from "./tab-model";
import { HOME_TAB_KEY, tabDescriptors } from "./tab-presentation";
import { sessionSummary } from "./test-fixtures";

const id = (value: string): Session.SessionId => Session.SessionId.make(value);

const summary = (input: {
  readonly id: string;
  readonly directory?: string;
  readonly title?: string;
  readonly phase?: Session.Phase;
  readonly delegation?: boolean;
}): Session.SessionSummary =>
  sessionSummary({
    id: id(input.id),
    workspaceId: "ws_1",
    directory: input.directory ?? "/repo/honk",
    ...(input.title === undefined ? {} : { title: input.title }),
    createdAt: "2026-08-07T00:00:00.000Z",
    phase: input.phase ?? "idle",
    updatedAt: "2026-08-07T00:00:00.000Z",
    ...(input.delegation === true
      ? { delegation: { delegationOf: id("ses_parent"), role: "sidekick" } }
      : {}),
  });

const withTabs = (...ids: readonly string[]): TabState =>
  ids.reduce((state, value) => openTab(state, id(value)), createTabState());

describe("tab transitions", () => {
  it("closes to the right neighbor, then the left, then Home", () => {
    let state = withTabs("a", "b", "c");
    state = closeTab(state, id("b"));
    expect(state.activeId).toBe(id("c"));
    expect(state.closed).toEqual([{ id: id("b"), index: 1 }]);

    state = closeTab(state, id("c"));
    expect(state.activeId).toBe(id("a"));

    state = closeTab(state, id("a"));
    expect(state.activeId).toBeNull();
    expect(state.tabs).toEqual([]);
  });

  it("closing an inactive tab keeps the selection", () => {
    const state = closeTab(withTabs("a", "b"), id("a"));
    expect(state.activeId).toBe(id("b"));
  });

  it("reopens at the original index and activates", () => {
    let state = withTabs("a", "b", "c");
    state = closeTab(state, id("b"));
    state = reopenClosedTab(state);
    expect(state.tabs).toEqual([id("a"), id("b"), id("c")]);
    expect(state.activeId).toBe(id("b"));
    expect(state.closed).toEqual([]);
  });

  it("skips already-open entries when reopening", () => {
    let state = withTabs("a", "b");
    state = closeTab(state, id("b"));
    state = openTab(state, id("b"));
    state = reopenClosedTab(state);
    expect(state.tabs.filter((value) => value === id("b"))).toHaveLength(1);
    expect(state.closed).toEqual([]);
  });

  it("caps close history at the limit, dropping the oldest", () => {
    let state = createTabState();
    for (let index = 0; index < CLOSED_TAB_LIMIT + 5; index += 1) {
      const session = id(`ses_${String(index)}`);
      state = openTab(state, session);
      state = closeTab(state, session);
    }
    expect(state.closed).toHaveLength(CLOSED_TAB_LIMIT);
    expect(state.closed[0]?.id).toBe(id("ses_5"));
  });

  it("validates reorder as a full permutation", () => {
    const state = withTabs("a", "b", "c");
    expect(reorderTabs(state, [id("c"), id("a"), id("b")]).tabs).toEqual([
      id("c"),
      id("a"),
      id("b"),
    ]);
    expect(reorderTabs(state, [id("a"), id("b")])).toBe(state);
    expect(reorderTabs(state, [id("a"), id("a"), id("b")])).toBe(state);
    expect(reorderTabs(state, [id("a"), id("b"), id("x")])).toBe(state);
  });

  it("removeSessions drops tabs and closed entries and falls to a neighbor", () => {
    let state = withTabs("a", "b", "c");
    state = closeTab(state, id("c"));
    state = removeSessions(state, [id("b"), id("c")]);
    expect(state.tabs).toEqual([id("a")]);
    expect(state.activeId).toBe(id("a"));
    expect(state.closed).toEqual([]);
  });
});

describe("tab persistence", () => {
  it("round-trips tabs, selection, and remembered directories", () => {
    let state = withTabs("a", "b");
    state = rememberDirectory(state, id("a"), "/repo/one");
    state = closeTab(state, id("b"));
    const restored = hydrateTabState(serializeTabState(state));
    expect(restored).toEqual(state);
  });

  it("rejects foreign envelopes whole and bad items alone", () => {
    expect(hydrateTabState("not json").tabs).toEqual([]);
    expect(
      hydrateTabState(JSON.stringify({ tabs: [{ key: "ses_legacy" }], activeKey: "ses_legacy" }))
        .tabs,
    ).toEqual([]);

    const mixed = hydrateTabState(
      JSON.stringify({
        schema: "honk.window-tabs",
        version: 1,
        tabs: ["ses_good", 42, "", "ses_good", "ses_other"],
        activeId: "ses_gone",
        info: { ses_good: { directory: "/repo" }, ses_gone: { directory: "/x" }, ses_other: 7 },
        closed: [{ id: "ses_closed", index: -3 }, { id: "" }, "junk"],
      }),
    );
    expect(mixed.tabs).toEqual([id("ses_good"), id("ses_other")]);
    // activeId not among open tabs falls back to Home rather than guessing.
    expect(mixed.activeId).toBeNull();
    expect(mixed.info).toEqual({ ses_good: { directory: "/repo" } });
    expect(mixed.closed).toEqual([{ id: id("ses_closed"), index: 0 }]);

    // A future version drops whole rather than half-decoding into this one's
    // shape. This is the branch that runs the day TAB_VERSION moves.
    expect(
      hydrateTabState(
        JSON.stringify({
          schema: "honk.window-tabs",
          version: 2,
          tabs: ["ses_future"],
          activeId: "ses_future",
          info: {},
          closed: [],
        }),
      ),
    ).toEqual(createTabState());
  });
});

describe("tab presentation", () => {
  it("projects Home at slot 0 and the title fallback chain", () => {
    let state = withTabs("a", "b", "c");
    state = rememberDirectory(state, id("b"), "/repo/persisted");
    const tabs = tabDescriptors(state, [
      summary({ id: "a", directory: "/repo/live", title: "Fix tab title generation" }),
    ]);
    expect(tabs[0]).toMatchObject({ key: HOME_TAB_KEY, kind: "home" });
    expect(tabs[1]).toMatchObject({
      title: "Fix tab title generation",
      repository: { state: "ready", label: "live" },
      path: "/repo/live",
    });
    expect(tabs[2]).toMatchObject({ title: "persisted", path: "/repo/persisted" });
    expect(tabs[3]).toMatchObject({ title: "Loading session", repository: { state: "loading" } });
  });

  it("shows working only while the phase is not idle, flat otherwise", () => {
    const state = withTabs("a", "b");
    const tabs = tabDescriptors(state, [
      summary({ id: "a", phase: "turn" }),
      summary({ id: "b", phase: "idle" }),
    ]);
    expect(tabs[1]?.status).toBe("working");
    expect(tabs[2]?.status).toBe("idle");
  });

  it("sweeps for every busy phase, not just a turn", () => {
    // The rule is "not idle", so compaction and retry sweep too. Reading it as
    // a two-value fork is how a background compaction goes invisible.
    const busy: readonly Session.Phase[] = ["turn", "compaction", "branch_summary", "retry"];
    for (const phase of busy) {
      const tabs = tabDescriptors(withTabs("a"), [summary({ id: "a", phase })]);
      expect(tabs[1]?.status).toBe("working");
    }
    expect(tabDescriptors(withTabs("a"), [summary({ id: "a", phase: "idle" })])[1]?.status).toBe(
      "idle",
    );
  });
});
