/**
 * The stable public facade for the session wire contract.
 *
 * Schema and RPC definitions live in focused, acyclic modules. This file owns
 * only their public surface, the request/response catalog, the combined RPC
 * group, and the richer in-process service interface.
 *
 * @module
 */

import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";
import type { Effect, Scope, Stream } from "effect";
import { RpcGroup } from "effect/unstable/rpc";

import { Models } from "../models";
import type { ServiceOf } from "../util/rpc";

import {
  Abort,
  EditMessage,
  Events,
  FollowUp,
  Prompt,
  Reload,
  RunCommand,
  RunGitAction,
  RunSkill,
  Steer,
} from "./contract-conversation";
import { NotFoundError, PiError, SessionId } from "./contract-foundation";
import { Create, Delete, Get, List, ListOutput, WatchInventory } from "./contract-lifecycle";
import { Changes, Revert, SetModel, SetThinkingLevel, SetWorkspace } from "./contract-workspace";

export {
  Abort,
  AbortOutput,
  EditMessage,
  EditMessageCommittedError,
  EmptyMessageError,
  Events,
  EventsFrame,
  FollowUp,
  PROMPT_IMAGE_MAX_BASE64_LENGTH,
  PROMPT_IMAGE_MAX_BYTES,
  PROMPT_IMAGE_MAX_COUNT,
  Prompt,
  PromptImage,
  Reload,
  ReloadOutput,
  RunCommand,
  RunGitAction,
  RunSkill,
  Steer,
} from "./contract-conversation";
export {
  CreateChoiceError,
  FusionStop,
  NotFoundError,
  Phase,
  PiEntry,
  PiError,
  SESSION_TITLE_MAX_LENGTH,
  SessionId,
  SessionInfo,
  SessionTitle,
  ThinkingLevel,
} from "./contract-foundation";
export type { Error } from "./contract-foundation";
export {
  Create,
  DelegationLink,
  Delete,
  Get,
  List,
  ListOutput,
  SessionSummary,
  WatchInventory,
} from "./contract-lifecycle";
export {
  Changes,
  ChangesOutput,
  Revert,
  SetModel,
  SetThinkingLevel,
  SetWorkspace,
  TurnChanges,
} from "./contract-workspace";

// Pi types remain reachable through @honk/core/session without adding a Pi
// dependency to clients. GitActionId travels with the RPC that consumes it.
export type { AgentHarnessEvent, SessionTreeEntry } from "@earendil-works/pi-agent-core";
export { GitActionId } from "./git-actions";

/**
 * The request/response command catalog. Its property order is also the stable
 * construction order used by {@link Rpcs}.
 */
export const commands = {
  create: Create,
  prompt: Prompt,
  editMessage: EditMessage,
  abort: Abort,
  steer: Steer,
  followUp: FollowUp,
  runGitAction: RunGitAction,
  runSkill: RunSkill,
  runCommand: RunCommand,
  reload: Reload,
  changes: Changes,
  setWorkspace: SetWorkspace,
  setThinkingLevel: SetThinkingLevel,
  setModel: SetModel,
  revert: Revert,
  list: List,
  get: Get,
  delete: Delete,
};

/** The complete session RPC group, including both streaming methods. */
export class Rpcs extends RpcGroup.make(...Object.values(commands), Events, WatchInventory) {}

/**
 * The session service as in-process callers use it.
 *
 * Request/response methods derive from {@link commands}. The streaming methods
 * keep their two-stage in-process shape so subscription readiness is explicit
 * and the caller's scope owns detachment.
 */
export interface Interface extends ServiceOf<typeof commands> {
  readonly events: (input: {
    readonly sessionId: SessionId;
  }) => Effect.Effect<
    Stream.Stream<AgentHarnessEvent>,
    NotFoundError | PiError | Models.ResolveError,
    Scope.Scope
  >;

  readonly watchInventory: Effect.Effect<Stream.Stream<ListOutput, PiError>, never, Scope.Scope>;
}

// Extensionless on purpose: consumer tsconfigs do not enable
// allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Session from "./contract";
