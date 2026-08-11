import type { TabDescriptor } from "@honk/ui";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@stylexjs/stylex", () => ({
  create: <T,>(styles: T) => styles,
  createTheme: <T,>(_variables: unknown, values: T) => values,
  defineVars: <T,>(values: T) => values,
  keyframes: () => "test-keyframes",
  props: () => ({}),
}));

vi.mock("@honk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@honk/ui")>();
  return {
    ...actual,
    SessionTabPreviewTooltip: ({
      align,
      children,
      side,
      sideOffset,
    }: {
      readonly align?: string;
      readonly children: ReactElement;
      readonly side?: string;
      readonly sideOffset?: number;
    }) => (
      <div
        data-tooltip-align={align}
        data-tooltip-side={side}
        data-tooltip-side-offset={sideOffset}
      >
        {children}
      </div>
    ),
  };
});

import { createHonkDesktopCell, type HonkDesktopTabs } from "../sdk";
import type { StatusFilter } from "./extension";
import { VerticalSidebar } from "./view";

const home: TabDescriptor = { key: "home", title: "Home", kind: "home", status: "idle" };

function thread(
  key: string,
  title: string,
  path: string,
  status: TabDescriptor["status"] = "idle",
): TabDescriptor {
  return {
    key,
    title,
    kind: "thread",
    status,
    repository: { state: "ready", label: path.split("/").at(-1) ?? path },
    path,
  };
}

function stubTabs(tabs: readonly TabDescriptor[], activeKey: string): HonkDesktopTabs {
  const snapshot = { tabs, activeKey };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    activate: () => {},
    close: () => {},
    create: () => {},
  };
}

function render(input: {
  readonly tabs?: readonly TabDescriptor[];
  readonly activeKey?: string;
  readonly collapsedGroups?: readonly string[];
  readonly workspaceOrder?: readonly string[];
  readonly workspacesOpen?: boolean;
  readonly threadFilters?: readonly StatusFilter[];
}): string {
  return renderToStaticMarkup(
    <VerticalSidebar
      tabs={stubTabs(input.tabs ?? [home], input.activeKey ?? "home")}
      collapsedGroups={createHonkDesktopCell<readonly string[]>(input.collapsedGroups ?? [])}
      workspaceOrder={createHonkDesktopCell<readonly string[]>(input.workspaceOrder ?? [])}
      workspacesOpen={createHonkDesktopCell(input.workspacesOpen ?? true)}
      threadFilters={createHonkDesktopCell<readonly StatusFilter[]>(input.threadFilters ?? [])}
    />,
  );
}

const populated = [
  home,
  thread("s1", "Fix the parser", "/code/honk", "working"),
  thread("s2", "Rename the tokens", "/code/honk"),
  thread("s3", "Trim the readme", "/code/ui"),
];

describe("vertical sidebar mount", () => {
  it("frames the pane with the traffic-light seat, the Home row, and the footer action", () => {
    const html = render({ tabs: [home], activeKey: "home" });

    expect(html).toContain('aria-label="Open tabs"');
    expect(html).toContain("data-shell-drag-region");
    expect(html).toContain("Home");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("New thread");
    expect(html).toContain("No open workspace tabs");
  });

  it("groups threads by workspace path and counts them on the header", () => {
    const html = render({ tabs: populated, activeKey: "s1" });

    expect(html).toContain('aria-label="honk, 2 open tabs"');
    expect(html).toContain('aria-label="ui, 1 open tab"');
    expect(html).toContain('data-honk-desktop-workspace-section-key="/code/honk"');
    expect(html).toContain("Fix the parser");
    expect(html).toContain("Rename the tokens");
    expect(html).toContain("Trim the readme");
    expect(html.indexOf("Fix the parser")).toBeLessThan(html.indexOf("Trim the readme"));
  });

  it("opens each thread preview beside the sidebar", () => {
    const html = render({
      tabs: [home, thread("s1", "Fix the parser", "/code/honk")],
      activeKey: "s1",
    });

    expect(html).toContain('data-tooltip-side="right"');
    expect(html).toContain('data-tooltip-align="start"');
    expect(html).toContain('data-tooltip-side-offset="4"');
  });

  it("orders groups by the persisted workspace order", () => {
    const html = render({ tabs: populated, workspaceOrder: ["/code/ui", "/code/honk"] });

    expect(html.indexOf("Trim the readme")).toBeLessThan(html.indexOf("Fix the parser"));
  });

  it("keeps a persisted-collapsed workspace header but drops its rows", () => {
    const html = render({ tabs: populated, collapsedGroups: ["/code/honk"] });

    expect(html).toContain('aria-label="honk, 2 open tabs"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Fix the parser");
    expect(html).not.toContain("Rename the tokens");
    expect(html).toContain("Trim the readme");
  });

  it("narrows rows to the persisted status filter and drops emptied groups", () => {
    const html = render({ tabs: populated, threadFilters: ["working"] });

    expect(html).toContain("Fix the parser");
    expect(html).not.toContain("Rename the tokens");
    expect(html).not.toContain("Trim the readme");
    expect(html).not.toContain('data-honk-desktop-workspace-section-key="/code/ui"');
  });

  it("says so when a filter hides everything", () => {
    const html = render({
      tabs: [home, thread("s2", "Rename the tokens", "/code/honk")],
      threadFilters: ["working"],
    });

    expect(html).toContain("No matching workspace tabs");
  });

  it("hides the whole workspace list when the collection is closed", () => {
    const html = render({ tabs: populated, workspacesOpen: false });

    expect(html).toContain("Workspaces");
    expect(html).not.toContain("Fix the parser");
    expect(html).not.toContain('data-honk-desktop-workspace-section-key="/code/honk"');
  });
});
