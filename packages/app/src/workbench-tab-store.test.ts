import { Session } from "@honk/core/session";
import { describe, expect, it } from "vitest";

import { createWorkbenchTabStore, fileTabID } from "./workbench-tab-store";

const ownerA = Session.SessionId.make("ses_a");
const ownerB = Session.SessionId.make("ses_b");

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `generated-${String(index)}`;
}

describe("workspace workbench tabs", () => {
  it("owns two same-kind terminal and browser resources independently", () => {
    const store = createWorkbenchTabStore({
      createID: ids("terminal-1", "terminal-2", "browser-1", "browser-2"),
    });

    const firstTerminal = store.actions.openTool("workspace", "terminal", ownerA);
    const secondTerminal = store.actions.openTool("workspace", "terminal", ownerA, {
      newInstance: true,
    });
    const firstBrowser = store.actions.openTool("workspace", "browser", ownerA);
    const secondBrowser = store.actions.openTool("workspace", "browser", ownerA, {
      newInstance: true,
    });

    expect([firstTerminal, secondTerminal]).toMatchObject([
      { kind: "terminal", terminalID: "terminal-1" },
      { kind: "terminal", terminalID: "terminal-2" },
    ]);
    expect([firstBrowser, secondBrowser]).toMatchObject([
      { kind: "browser", browserID: "browser-1", owner: ownerA },
      { kind: "browser", browserID: "browser-2", owner: ownerA },
    ]);
    expect(new Set(store.getWorkspace("workspace").tabs.map((tab) => tab.id)).size).toBe(4);
  });

  it("reuses a workspace browser across parent switches and creates new instances explicitly", () => {
    const store = createWorkbenchTabStore({ createID: ids("browser-a", "browser-b") });

    const first = store.actions.openTool("workspace", "browser", ownerA);
    const reused = store.actions.openTool("workspace", "browser", ownerB);
    const second = store.actions.openTool("workspace", "browser", ownerB, {
      newInstance: true,
    });

    expect(reused).toBe(first);
    expect(first).toMatchObject({ kind: "browser", owner: ownerA, browserID: "browser-a" });
    expect(second).toMatchObject({ kind: "browser", owner: ownerB, browserID: "browser-b" });
    expect(store.getWorkspace("workspace").tabs).toHaveLength(2);
  });

  it("selects the nearest remaining tab when the active tab closes", () => {
    const store = createWorkbenchTabStore({
      createID: ids("second", "third"),
    });
    const first = store.actions.openTool("workspace", "terminal", ownerA);
    const second = store.actions.openTool("workspace", "terminal", ownerA, {
      newInstance: true,
    });
    const third = store.actions.openTool("workspace", "browser", ownerA);

    store.actions.activate("workspace", second.id);
    expect(store.actions.close("workspace", second.id).activeTabID).toBe(third.id);
    expect(store.actions.close("workspace", third.id).activeTabID).toBe(first.id);
  });

  // Two chats can share one workspace: the Changes tab is one per workspace and
  // its owner follows whichever session opened it last.
  it("retains one workspace inventory while ownership changes", () => {
    const store = createWorkbenchTabStore();
    const terminal = store.actions.openTool("workspace", "terminal", ownerA);
    const changesA = store.actions.openTool("workspace", "changes", ownerA);
    const changesB = store.actions.openTool("workspace", "changes", ownerB);

    expect(changesB).toMatchObject({ id: changesA.id, owner: ownerB });
    expect(store.getWorkspace("workspace").tabs).toContainEqual(terminal);
    expect(store.getWorkspace("workspace").tabs).toHaveLength(2);
  });

  it("keeps the shell inventory available across workspaces", () => {
    const store = createWorkbenchTabStore();
    const terminal = store.actions.openTool("workspace", "terminal", ownerA);

    expect(store.getWorkspace("workspace").tabs).toEqual([terminal]);
    expect(store.getWorkspace("workspace").activeTabID).toBe(terminal.id);
    expect(store.getWorkspace("unknown").tabs).toEqual([]);
    expect(store.getWorkspace("workspace").tabs).toEqual([terminal]);
  });

  it("treats explicit collapse as chrome state only", () => {
    const store = createWorkbenchTabStore();
    const terminal = store.actions.openTool("workspace", "terminal", ownerA);

    expect(store.getWorkspace("workspace")).toMatchObject({
      activeTabID: terminal.id,
      expanded: true,
    });
    store.actions.setExpanded("workspace", false);
    expect(store.getWorkspace("workspace")).toMatchObject({
      tabs: [terminal],
      activeTabID: terminal.id,
      expanded: false,
    });
  });

  it("opens an empty shell without creating or activating a tool", () => {
    const store = createWorkbenchTabStore();

    store.actions.setExpanded("workspace", true);

    expect(store.getWorkspace("workspace")).toMatchObject({
      tabs: [],
      activeTabID: null,
      expanded: true,
    });
  });

  it("opens one viewer tab per path and reactivates an already-open file", () => {
    const store = createWorkbenchTabStore();

    const first = store.actions.openFile("workspace", "src/one.ts");
    const second = store.actions.openFile("workspace", "src/two.ts");
    store.actions.openTool("workspace", "changes", ownerA);
    const reopened = store.actions.openFile("workspace", "src/one.ts");

    expect(reopened).toBe(first);
    expect([first, second]).toMatchObject([
      { kind: "file", filePath: "src/one.ts" },
      { kind: "file", filePath: "src/two.ts" },
    ]);
    expect(first.id).toBe(fileTabID("src/one.ts"));
    expect(store.getWorkspace("workspace").tabs).toHaveLength(3);
    expect(store.getWorkspace("workspace")).toMatchObject({
      activeTabID: first.id,
      expanded: true,
    });
  });

  // A Windows host lists `src\one.ts`; the same file listed by core is `src/one.ts`.
  it("collapses separator variants of one path onto a single tab", () => {
    const store = createWorkbenchTabStore();

    const opened = store.actions.openFile("workspace", "src\\one.ts");
    const reopened = store.actions.openFile("workspace", "src/one.ts");

    expect(opened.filePath).toBe("src/one.ts");
    expect(reopened).toBe(opened);
    expect(store.getWorkspace("workspace").tabs).toHaveLength(1);
  });
});
