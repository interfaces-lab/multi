import { describe, expect, it } from "vitest";

import { workbenchPresentation } from "./workbench-presentation";
import { fileTabID, type WorkbenchTab } from "./workbench-tab-store";

function presentation(managedTabs: readonly WorkbenchTab[], activeTabID: string | null) {
  return workbenchPresentation({
    activeTabID,
    expanded: true,
    managedTabs,
  });
}

describe("workbench presentation", () => {
  it("presents an expanded shell without an active managed tab", () => {
    const result = presentation([], null);

    expect(result).toMatchObject({ activeTab: null, headerTabs: [], isOpen: true });
  });

  it("keeps Files and opened files in the shared workbench header", () => {
    const filePath = "src/workbench-files.tsx";
    const fileTab: WorkbenchTab = {
      id: fileTabID(filePath),
      kind: "file",
      filePath,
    };
    const result = presentation([{ id: "files", kind: "files" }, fileTab], fileTab.id);

    expect(result.isOpen).toBe(true);
    expect(result.headerTabs).toMatchObject([
      { id: "files", label: "Files", showLabel: true },
      {
        id: fileTab.id,
        label: "workbench-files.tsx",
        title: filePath,
        filePath,
        showLabel: true,
      },
    ]);
  });
});
