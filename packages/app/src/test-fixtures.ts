// Shared app-test values at the two contracts that are otherwise easy to fake
// incompletely: Core inventory rows and Pi transcript entries.

import type { Models } from "@honk/core/models";
import { Session } from "@honk/core/session";
import { Workspace } from "@honk/core/workspace";

type MessageEntry = Extract<Session.SessionTreeEntry, { readonly type: "message" }>;
type TranscriptMessage = MessageEntry["message"];
type UserMessage = Extract<TranscriptMessage, { readonly role: "user" }>;
type AssistantMessage = Extract<TranscriptMessage, { readonly role: "assistant" }>;
type ToolResultMessage = Extract<TranscriptMessage, { readonly role: "toolResult" }>;
type CompactionEntry = Extract<Session.SessionTreeEntry, { readonly type: "compaction" }>;

export type AssistantContent = AssistantMessage["content"][number];
export type UserContent = Exclude<UserMessage["content"], string>[number];

export function providerSummary(input: {
  readonly id: string;
  readonly name?: string;
  readonly configured?: boolean;
  readonly methods?: Models.ProviderSummary["methods"];
  readonly authType?: Models.ProviderSummary["authType"];
  readonly source?: string;
  readonly models?: readonly Models.ModelSummary[];
}): Models.ProviderSummary {
  return {
    id: input.id,
    name: input.name ?? input.id,
    configured: input.configured ?? true,
    methods: [...(input.methods ?? [])],
    ...(input.authType === undefined ? {} : { authType: input.authType }),
    ...(input.source === undefined ? {} : { source: input.source }),
    models: [...(input.models ?? [])],
  };
}

export interface SessionSummaryInput {
  readonly id: string;
  readonly workspaceId?: string;
  readonly directory?: string;
  readonly title?: string;
  readonly createdAt?: string;
  readonly phase?: Session.Phase;
  readonly updatedAt?: string;
  readonly delegation?: {
    readonly delegationOf: string;
    readonly role: string;
  };
}

export function sessionSummary(input: SessionSummaryInput): Session.SessionSummary {
  const createdAt = input.createdAt ?? "2026-08-05T10:00:00.000Z";
  return {
    id: Session.SessionId.make(input.id),
    workspaceId: Workspace.WorkspaceId.make(input.workspaceId ?? "ws_1"),
    directory: input.directory ?? "/repo",
    ...(input.title === undefined ? {} : { title: input.title }),
    createdAt,
    phase: input.phase ?? "idle",
    updatedAt: input.updatedAt ?? createdAt,
    ...(input.delegation === undefined
      ? {}
      : {
          delegation: {
            delegationOf: Session.SessionId.make(input.delegation.delegationOf),
            role: input.delegation.role,
          },
        }),
  };
}

const messageBase = (id: string, timestamp: string) => ({
  id,
  parentId: null,
  timestamp,
});

export function userMessageEntry(
  id: string,
  text: string,
  timestamp = "2026-08-05T10:00:00.000Z",
): MessageEntry {
  const message: UserMessage = {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.parse(timestamp),
  };
  return { type: "message", ...messageBase(id, timestamp), message };
}

export function userContentMessageEntry(
  id: string,
  content: readonly UserContent[],
  timestamp = "2026-08-05T10:00:00.000Z",
): MessageEntry {
  const message: UserMessage = {
    role: "user",
    content: [...content],
    timestamp: Date.parse(timestamp),
  };
  return { type: "message", ...messageBase(id, timestamp), message };
}

export function assistantMessageEntry(
  id: string,
  content: readonly AssistantContent[],
  timestamp = "2026-08-05T10:00:04.000Z",
): MessageEntry {
  const message: AssistantMessage = {
    role: "assistant",
    content: [...content],
    api: "faux",
    provider: "faux",
    model: "faux",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.parse(timestamp),
  };
  return { type: "message", ...messageBase(id, timestamp), message };
}

export function toolResultMessageEntry(input: {
  readonly id: string;
  readonly toolCallId: string;
  readonly text: string;
  readonly toolName?: string;
  readonly details?: unknown;
  readonly timestamp?: string;
}): MessageEntry {
  const timestamp = input.timestamp ?? "2026-08-05T10:00:03.000Z";
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: input.toolCallId,
    toolName: input.toolName ?? "tool",
    isError: false,
    content: [{ type: "text", text: input.text }],
    ...(input.details === undefined ? {} : { details: input.details }),
    timestamp: Date.parse(timestamp),
  };
  return { type: "message", ...messageBase(input.id, timestamp), message };
}

export function compactionEntry(
  id: string,
  timestamp = "2026-08-05T10:00:05.000Z",
): CompactionEntry {
  return {
    type: "compaction",
    ...messageBase(id, timestamp),
    summary: "Earlier work",
    tokensBefore: 90_000,
  };
}
