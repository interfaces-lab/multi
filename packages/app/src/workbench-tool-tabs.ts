import { IconChanges, IconConsoleSimple, IconFileBend, IconGlobe } from "@honk/ui/icons";
import type { Glyph } from "@honk/ui";
import { Schema } from "effect";

type WorkbenchToolKind = "changes" | "browser" | "terminal" | "files";

interface WorkbenchToolTabEntry {
  readonly id: WorkbenchToolKind;
  readonly label: string;
  readonly icon: Glyph;
}

const WorkbenchToolKindSchema = Schema.Literals(["changes", "browser", "terminal", "files"]);

// The workbench's fixed tool set. Order is presentation order in the rail and
// the "+" menu. Plan/Tasks belonged to the retired backend and have no Honk Core
// equivalent and are gone rather than shipped dead.
const WORKBENCH_TOOL_TABS: readonly WorkbenchToolTabEntry[] = [
  { id: "changes", label: "Changes", icon: IconChanges },
  { id: "browser", label: "Browser", icon: IconGlobe },
  { id: "terminal", label: "Terminal", icon: IconConsoleSimple },
  { id: "files", label: "Files", icon: IconFileBend },
] satisfies readonly WorkbenchToolTabEntry[];

export { WORKBENCH_TOOL_TABS, WorkbenchToolKindSchema };
export type { WorkbenchToolKind, WorkbenchToolTabEntry };
