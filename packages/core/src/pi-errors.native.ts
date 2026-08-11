export type AgentHarnessErrorCode =
  | "busy"
  | "invalid_state"
  | "invalid_argument"
  | "session"
  | "hook"
  | "auth"
  | "compaction"
  | "branch_summary"
  | "unknown";

export type SessionErrorCode =
  | "not_found"
  | "invalid_session"
  | "invalid_entry"
  | "invalid_fork_target"
  | "storage"
  | "unknown";

/** Native transport copy of Pi's public error. Wire decoding constructs this exact class. */
export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SessionError";
    this.code = code;
  }
}

/** Native transport copy of Pi's public error. Wire decoding constructs this exact class. */
export class AgentHarnessError extends Error {
  readonly code: AgentHarnessErrorCode;

  constructor(code: AgentHarnessErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AgentHarnessError";
    this.code = code;
  }
}
