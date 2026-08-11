/**
 * Session creation, inventory, lookup, deletion, and inventory-stream RPCs.
 *
 * @module
 */

import { Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";

import { Models } from "../models";
import { Workspace } from "../workspace";

import {
  CreateChoiceError,
  FusionStop,
  NotFoundError,
  Phase,
  PiError,
  SessionId,
  SessionInfo,
  SessionTitle,
  ThinkingLevel,
} from "./contract-foundation";

/** Creates a session inside a trusted workspace. */
export const Create = Rpc.make("session.create", {
  payload: {
    workspaceId: Workspace.WorkspaceId,
    model: Schema.optionalKey(Models.ModelRef),
    thinkingLevel: Schema.optionalKey(ThinkingLevel),
    fusion: Schema.optionalKey(FusionStop),
  },
  success: SessionInfo,
  error: Schema.Union([Workspace.NotFoundError, Models.AvailableError, CreateChoiceError, PiError]),
});

/** The persisted birth mark of a delegation-owned session. */
export const DelegationLink = Schema.Struct({
  delegationOf: SessionId,
  role: Schema.NonEmptyString,
}).annotate({ identifier: "DelegationLink" });
export type DelegationLink = typeof DelegationLink.Type;

/** One stored session as an inventory surface renders it. */
export const SessionSummary = Schema.Struct({
  id: SessionId,
  workspaceId: Workspace.WorkspaceId,
  directory: Schema.NonEmptyString,
  title: Schema.optionalKey(SessionTitle),
  createdAt: Schema.String,
  phase: Phase,
  updatedAt: Schema.String,
  delegation: Schema.optionalKey(DelegationLink),
}).annotate({ identifier: "SessionSummary" });
export type SessionSummary = typeof SessionSummary.Type;

/** The authoritative cross-session inventory. */
export const ListOutput = Schema.Struct({
  sessions: Schema.Array(SessionSummary),
}).annotate({ identifier: "SessionListOutput" });
export type ListOutput = typeof ListOutput.Type;

/** Lists every stored session this host can still place. */
export const List = Rpc.make("session.list", {
  payload: {},
  success: ListOutput,
  error: PiError,
});

/** Resolves one session by id without opening it. */
export const Get = Rpc.make("session.get", {
  payload: { sessionId: SessionId },
  success: SessionInfo,
  error: Schema.Union([NotFoundError, PiError]),
});

/** Deletes one session transcript and its reachable checkpoints. */
export const Delete = Rpc.make("session.delete", {
  payload: { sessionId: SessionId },
  error: Schema.Union([NotFoundError, PiError]),
});

/** Subscribes to authoritative full-inventory frames. */
export const WatchInventory = Rpc.make("session.watch_inventory", {
  payload: {},
  success: ListOutput,
  error: PiError,
  stream: true,
});
