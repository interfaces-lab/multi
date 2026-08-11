import type { Glyph } from "@honk/ui";
import { IconFileBend } from "@honk/ui/icons";
import { basename } from "@honk/shared/paths";

import type { WorkbenchTab as ManagedWorkbenchTab } from "./workbench-tab-store";
import type {
  WorkbenchToolHeaderMenuItem,
  WorkbenchToolHeaderTab,
} from "./workbench-tool-header-types";
import { WORKBENCH_TOOL_TABS, type WorkbenchToolTabEntry } from "./workbench-tool-tabs";

// The rail carries the glyph only; its label comes from `tabLabels`, so a file tab needs no entry
// in the fixed tool-tab table.
type OpenWorkbenchToolTab = {
  readonly tab: Exclude<ManagedWorkbenchTab, { readonly kind: "changes" }>;
  readonly icon: Glyph;
};

type WorkbenchPresentation = {
  readonly activeTab: ManagedWorkbenchTab | null;
  readonly headerMenuItems: readonly WorkbenchToolHeaderMenuItem[];
  readonly headerTabs: readonly WorkbenchToolHeaderTab[];
  readonly isOpen: boolean;
  readonly openTabs: readonly OpenWorkbenchToolTab[];
  readonly tabLabels: ReadonlyMap<string, string>;
  readonly terminalCount: number;
  readonly toolTabs: readonly WorkbenchToolTabEntry[];
};

function workbenchPresentation(input: {
  readonly activeTabID: string | null;
  readonly expanded: boolean;
  readonly managedTabs: readonly ManagedWorkbenchTab[];
}): WorkbenchPresentation {
  const toolTabs = WORKBENCH_TOOL_TABS;
  const mountedToolKinds = new Set(input.managedTabs.map((tab) => tab.kind));
  const tabLabels = new Map(
    input.managedTabs.map<readonly [string, string]>((tab) => [
      tab.id,
      tabLabel(tab, input.managedTabs),
    ]),
  );
  const openTabs = input.managedTabs.flatMap<OpenWorkbenchToolTab>((tab) => {
    if (tab.kind === "changes") return [];
    if (tab.kind === "file") return [{ tab, icon: IconFileBend }];
    const entry = toolTabs.find((candidate) => candidate.id === tab.kind);
    return entry === undefined ? [] : [{ tab, icon: entry.icon }];
  });
  const terminalCount = input.managedTabs.filter((tab) => tab.kind === "terminal").length;
  const activeTab = input.managedTabs.find((tab) => tab.id === input.activeTabID) ?? null;
  const headerTabs = input.managedTabs.flatMap<WorkbenchToolHeaderTab>((tab) => {
    if (tab.kind === "file") {
      // Two files can share a basename, so the pill's tooltip carries the full path.
      return [
        {
          id: tab.id,
          label: tabLabels.get(tab.id) ?? basename(tab.filePath),
          title: tab.filePath,
          icon: IconFileBend,
          filePath: tab.filePath,
          closable: true,
          showLabel: true,
        },
      ];
    }
    const entry = toolTabs.find((candidate) => candidate.id === tab.kind);
    return entry === undefined
      ? []
      : [
          {
            id: tab.id,
            label: tabLabels.get(tab.id) ?? tab.kind,
            icon: entry.icon,
            closable: true,
            showLabel: true,
          },
        ];
  });
  const headerMenuItems: readonly WorkbenchToolHeaderMenuItem[] = toolTabs.map((entry) => ({
    id: `tool:${entry.id}`,
    label: entry.label,
    icon: entry.icon,
    disabled: entry.id !== "terminal" && entry.id !== "browser" && mountedToolKinds.has(entry.id),
  }));

  return {
    activeTab,
    headerMenuItems,
    headerTabs,
    isOpen: input.expanded,
    openTabs,
    tabLabels,
    terminalCount,
    toolTabs,
  };
}

function tabLabel(tab: ManagedWorkbenchTab, tabs: readonly ManagedWorkbenchTab[]): string {
  if (tab.kind === "file") return basename(tab.filePath);
  const entry = WORKBENCH_TOOL_TABS.find((candidate) => candidate.id === tab.kind);
  if (entry === undefined) return tab.kind;
  if (tab.kind !== "terminal" && tab.kind !== "browser") return entry.label;
  const siblings = tabs.filter((candidate) => candidate.kind === tab.kind);
  const ordinal = siblings.findIndex((candidate) => candidate.id === tab.id) + 1;
  return ordinal <= 1 ? entry.label : `${entry.label} ${String(ordinal)}`;
}

export { workbenchPresentation };
export type { OpenWorkbenchToolTab, WorkbenchPresentation };
