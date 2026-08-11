// The workbench's identity is Honk Core's: one chat session in one trusted
// workspace. Every workbench surface keys on these values and nothing else,
// so the producer (the chat thread page) is the single place that resolves
// them.

import type { Session } from "@honk/core/session";
import type { Workspace } from "@honk/core/workspace";

/** Core identity for one workbench: the chat session and its trusted workspace. */
type WorkbenchSessionRef = {
  readonly sessionId: Session.SessionId;
  readonly workspaceId: Workspace.WorkspaceId;
};

type ResolvedWorkbenchFrame = {
  readonly sessionRef: WorkbenchSessionRef;
  /** The workspace directory on disk — terminals and labels need the path, not the id. */
  readonly directory: string;
  readonly isThreadRunning: boolean;
};

export type { ResolvedWorkbenchFrame, WorkbenchSessionRef };
