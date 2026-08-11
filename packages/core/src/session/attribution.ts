/**
 * The attribution gate: what a turn's tool calls say about whose writes a
 * checkpoint diff contains.
 *
 * The snapshot diff is the truth about *content*; the turn's tool calls are
 * the truth about *attribution*. Intersecting them is what keeps a sibling
 * session's edits out of a turn's receipt without hiding what a shell command
 * wrote. Everything here is pure — transcript entries in, decisions out — and
 * pairs with `Tools.writesOf`, which classifies a single call.
 *
 * @see spec/core.md section 7 — "A turn captures a checkpoint; tools gate
 * attribution".
 * @module
 */

import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { Option, Schema } from "effect";

import type { Git } from "../git";
import type { Models } from "../models";
import { Tools } from "../tools";
import { ThinkingLevel } from "./contract";

/** What one turn's tool calls say about who wrote what. */
export interface TurnWrites {
  /**
   * The turn ran a tool whose writes are not derivable — shell, MCP — or
   * declared a path the gate could not place inside the workspace.
   */
  readonly opaque: boolean;
  /** Paths the turn's declaring tools named, workspace-relative. */
  readonly declared: ReadonlySet<string>;
}

/**
 * The transcript's model record: the last `model_change` entry wins, exactly
 * as Pi replays it when rebuilding session context. Create always writes one,
 * so an absent record means an invalid Honk session and restoration refuses it.
 */
export const modelOf = (entries: readonly SessionTreeEntry[]): Models.ModelRef | undefined => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "model_change") {
      return { providerId: entry.provider, modelId: entry.modelId };
    }
  }
  return undefined;
};

/**
 * The transcript's thinking-level record: the last `thinking_level_change`
 * entry wins, exactly as Pi replays it.
 *
 * Pi stores the entry value as a plain string, so the record is validated
 * against Pi's vocabulary. A value this pin does not know — a level from a
 * newer Pi that once ran this transcript — yields nothing rather than a
 * guess, and the harness starts on Pi's own default.
 */
export const thinkingLevelOf = (
  entries: readonly SessionTreeEntry[],
): ThinkingLevel | undefined => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "thinking_level_change") {
      return Option.getOrUndefined(Schema.decodeUnknownOption(ThinkingLevel)(entry.thinkingLevel));
    }
  }
  return undefined;
};

/**
 * Collects the attribution gate for one turn: the entries after the previous
 * snapshot up to and including this one.
 *
 * An absent index means the boundary entry is not in the transcript — `base`
 * never is — and widens the range to the corresponding end, which errs toward
 * claiming more rather than silently dropping a write.
 */
export const turnToolWrites = (
  entries: readonly SessionTreeEntry[],
  fromIndex: number | undefined,
  toIndex: number | undefined,
  workspaceDirectory: string,
): TurnWrites => {
  const start = fromIndex === undefined ? 0 : fromIndex + 1;
  const end = toIndex === undefined ? entries.length - 1 : toIndex;

  let opaque = false;
  const declared = new Set<string>();
  for (let index = start; index <= end; index += 1) {
    const entry = entries[index];
    if (entry === undefined || entry.type !== "message") continue;
    if (entry.message.role !== "assistant" || !(entry.message.content instanceof Array)) continue;
    for (const block of entry.message.content) {
      if (block.type !== "toolCall") continue;
      const writes = Tools.writesOf(block.name, block.arguments);
      if (writes.kind === "opaque") opaque = true;
      if (writes.kind === "declared") {
        for (const path of writes.paths) {
          const relative = workspaceRelative(workspaceDirectory, path);
          if (relative === undefined) opaque = true;
          else declared.add(relative);
        }
      }
    }
  }
  return { opaque, declared };
};

/**
 * Applies the gate: a declaring-only turn claims exactly the paths it named,
 * an opaque turn claims the whole diff. Filtering an opaque turn would
 * silently hide real writes, which is the one failure mode this read must
 * never have.
 */
export const gateTurnFiles = (
  files: readonly Git.FileChange[],
  writes: TurnWrites,
): readonly Git.FileChange[] => {
  if (writes.opaque) return files;
  return files.filter((file) => writes.declared.has(file.file));
};

/**
 * Aligns a tool-argument path — Pi's writing tools accept relative or
 * absolute — with the workspace-relative form git reports. Resolution is
 * lexical, not `node:path`: this package is platform-free, so filesystem
 * capability rides the injected env and never a Node import. A path this
 * cannot confidently place inside the workspace (it escapes the directory,
 * or reaches the same file through a symlink such as macOS's `/tmp` →
 * `/private/tmp`) yields nothing, and the caller treats the turn as opaque:
 * over-claiming is a visible, correctable mistake, while dropping a write is
 * an invisible lie.
 */
const workspaceRelative = (workspaceDirectory: string, path: string): string | undefined => {
  const absolute = path.startsWith("/") ? path : `${workspaceDirectory}/${path}`;
  const base = segmentsOf(workspaceDirectory);
  const target = segmentsOf(absolute);
  if (target.length <= base.length) return undefined;
  if (base.some((segment, index) => target[index] !== segment)) return undefined;
  return target.slice(base.length).join("/");
};

/** Lexical `/`-split normalization; `..` clamps at the root as `resolve` does. */
const segmentsOf = (path: string): string[] => {
  const segments: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments;
};
