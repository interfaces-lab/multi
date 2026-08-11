import type { Session } from "@honk/core/session";

import type { ComposerMessage } from "./composer-store";
import type { ModelSelection } from "./selection";

export interface MessageEditTarget {
  readonly entryId: string;
  readonly message: ComposerMessage;
}

export type ActiveMessageEdit =
  | (MessageEditTarget & {
      readonly phase: "editing";
      readonly sessionId: Session.SessionId;
      readonly error: string | null;
      readonly selection: ModelSelection;
      readonly selectionChanged: boolean;
    })
  | (MessageEditTarget & {
      readonly phase: "submitting";
      readonly sessionId: Session.SessionId;
      readonly requestId: number;
      readonly selection: ModelSelection;
      readonly selectionChanged: boolean;
    });
