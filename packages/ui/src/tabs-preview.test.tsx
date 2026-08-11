import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@stylexjs/stylex", () => ({
  create: <T,>(styles: T) => styles,
  createTheme: <T,>(_variables: unknown, values: T) => values,
  defineVars: <T,>(values: T) => values,
  keyframes: () => "test-keyframes",
  props: () => ({}),
}));

vi.mock("./tooltip", () => ({
  TooltipProvider: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  Tooltip: ({
    align,
    children,
    label,
    side,
    sideOffset,
  }: {
    readonly align?: string;
    readonly children: ReactElement;
    readonly label: ReactNode;
    readonly side?: string;
    readonly sideOffset?: number;
  }) => (
    <div data-tooltip-align={align} data-tooltip-side={side} data-tooltip-side-offset={sideOffset}>
      {children}
      {label}
    </div>
  ),
}));

import { SessionTabPreviewTooltip, type TabDescriptor } from "./tabs";

const tab: TabDescriptor = {
  key: "thread-1",
  title: "Fix the sidebar",
  kind: "thread",
  status: "idle",
  path: "/code/honk",
  repository: { state: "ready", label: "honk" },
};

describe("session tab preview tooltip", () => {
  it("keeps the titlebar placement as its default", () => {
    const html = renderToStaticMarkup(
      <SessionTabPreviewTooltip tab={tab}>
        <button type="button">Thread</button>
      </SessionTabPreviewTooltip>,
    );

    expect(html).toContain('data-tooltip-side="bottom"');
    expect(html).toContain('data-tooltip-align="start"');
    expect(html).toContain('data-tooltip-side-offset="6"');
  });

  it("forwards a sidebar placement without changing preview content", () => {
    const html = renderToStaticMarkup(
      <SessionTabPreviewTooltip tab={tab} side="right" align="start" sideOffset={4}>
        <button type="button">Thread</button>
      </SessionTabPreviewTooltip>,
    );

    expect(html).toContain('data-tooltip-side="right"');
    expect(html).toContain('data-tooltip-align="start"');
    expect(html).toContain('data-tooltip-side-offset="4"');
    expect(html).toContain("honk");
    expect(html).toContain("Fix the sidebar");
    expect(html).toContain("/code/honk");
  });
});
