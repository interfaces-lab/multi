/**
 * The tools a trusted workspace gives its harness, and what each one's calls
 * say about attribution.
 *
 * Checkpoints are the truth about *content*: `sdk.session.changes` diffs the
 * snapshots around a turn, so every write shows up — shell redirections,
 * generated files, MCP side effects. What a snapshot cannot say is *whose*
 * write it was: two sessions in one directory, or the user editing by hand,
 * land in the same diff. That is what {@link writesOf} answers. A turn's tool
 * calls classify it: a turn that used only declaring tools claims exactly the
 * paths it named, and a turn that ran an opaque mutator claims the whole
 * diff, because filtering it would silently hide real writes.
 *
 * The classification errs open on purpose. An unknown tool is opaque, not
 * ignored: over-claiming a path is a visible, correctable mistake, while
 * dropping one is an invisible lie.
 *
 * @see spec/core.md section 7.
 * @module
 */

import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-agent-core";

export { writesOf, type ToolWrites } from "./tool-writes";

/**
 * Pi's built-in execution tools, in the order a harness receives them.
 *
 * @category construction
 */
export const builtins = () => [
  createReadTool(),
  createWriteTool(),
  createEditTool(),
  createBashTool(),
];

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Tools from "./tools";
