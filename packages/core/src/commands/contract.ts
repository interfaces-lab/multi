/**
 * `sdk.commands`: the workspace's prompt templates, as a client lists them.
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
 * One command as a client sees it.
 *
 * The template body is not here for the same reason a skill's content is not:
 * it is written for the model, and a client that showed it would be rendering
 * an instruction the user did not write. What a client needs is the name it
 * completes, the description it explains the row with, and whether picking the
 * row should submit or wait for arguments.
 *
 * @category schemas
 */
export const Summary = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),

  /**
   * Whether the template substitutes arguments into its body.
   *
   * A composer uses this to decide what picking the row means. A command with
   * no placeholders is complete the moment it is chosen and can run; one that
   * interpolates `$1` or `$ARGUMENTS` is a prefix the user is still typing, so
   * the row should leave the caret in the composer instead of submitting a
   * template with its placeholders unfilled.
   */
  acceptsArguments: Schema.Boolean,
}).annotate({ identifier: "CommandSummary" });
export type Summary = typeof Summary.Type;

/**
 * Lists the commands this trusted workspace defines.
 *
 * Cached after the first call. A workspace with no command directories answers
 * with an empty list rather than failing.
 *
 * @category commands
 */
export const List = Rpc.make("commands.list", {
  payload: { workspaceId: Workspace.WorkspaceId },
  success: Schema.Array(Summary),
  error: Workspace.NotFoundError,
});

/**
 * Rescans the workspace's command directories and answers the fresh list.
 *
 * @category commands
 */
export const Reload = Rpc.make("commands.reload", {
  payload: { workspaceId: Workspace.WorkspaceId },
  success: Schema.Array(Summary),
  error: Workspace.NotFoundError,
});

/**
 * The commands command catalog, declared once.
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
export * as Commands from "./contract";
