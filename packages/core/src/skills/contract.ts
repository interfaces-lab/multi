/**
 * `sdk.skills`: the workspace's skills, as a client lists them.
 *
 * Schemas, typed errors, and the command catalog only — this module reaches no
 * service, so a browser bundle can hold it.
 *
 * @module
 */

import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { ServiceOf } from "../util/rpc";
import { Workspace } from "../workspace";

/**
 * One skill as a client sees it.
 *
 * Deliberately not Pi's `Skill`. That type carries the full instruction
 * content and an absolute host path, and neither belongs in a menu row: the
 * content is for the model, and an absolute path would leak the shape of the
 * user's disk into every client that renders the list. A client that wants a
 * skill's text asks the model to run it.
 *
 * `description` is nullable rather than empty-defaulted so "this skill has no
 * description" and "this skill's description is blank" stay the same fact
 * instead of becoming a row with an empty second line.
 *
 * @category schemas
 */
export const Summary = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),
}).annotate({ identifier: "SkillSummary" });
export type Summary = typeof Summary.Type;

/**
 * Lists the skills this trusted workspace defines.
 *
 * Cached after the first call. A workspace with no skill directories answers
 * with an empty list rather than failing — having no skills is the common
 * case, not an error.
 *
 * @category commands
 */
export const List = Rpc.make("skills.list", {
  payload: { workspaceId: Workspace.WorkspaceId },
  success: Schema.Array(Summary),
  error: Workspace.NotFoundError,
});

/**
 * Rescans the workspace's skill directories and answers the fresh list.
 *
 * Skills are files a person edits while Honk is running. Without this the only
 * way to pick up a new one would be to restart the host.
 *
 * @category commands
 */
export const Reload = Rpc.make("skills.reload", {
  payload: { workspaceId: Workspace.WorkspaceId },
  success: Schema.Array(Summary),
  error: Workspace.NotFoundError,
});

/**
 * The skills command catalog, declared once.
 *
 * @category commands
 */
export const commands = {
  list: List,
  reload: Reload,
};

/**
 * @category commands
 */
export class Rpcs extends RpcGroup.make(...Object.values(commands)) {}

/**
 * @category service
 */
export interface Interface extends ServiceOf<typeof commands> {}

// Extensionless on purpose: consumers bundle this source.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Skills from "./contract";
