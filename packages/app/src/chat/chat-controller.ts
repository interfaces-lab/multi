// Imperative session commands that live outside a thread's watch. The
// attach/fold lifecycle is chat-store.ts; the pure rules are chat-model.ts.

import type { Session } from "@honk/core/session";
import type { Workspace } from "@honk/core/workspace";

import { getHonkClient, requireHonkClient } from "./client";
import { draftKeyOf, restoreDraft, type ComposerMessage } from "./composer-store";
import type { ModelSelection } from "./selection";

export interface ModelChoice {
  readonly providerId: string;
  readonly modelId: string;
}

/**
 * Creates a session; the caller navigates to it. Model and thinking level are
 * per session (spec/core.md section 11) and recorded in the transcript, so
 * the thread page holds no selection state of its own. Null means core's default.
 */
export async function createCoreSession(input: {
  readonly workspaceId: Workspace.WorkspaceId;
  readonly selection: ModelSelection;
}): Promise<Session.SessionId> {
  const sdk = requireHonkClient();
  const { id } = await sdk.session.create({
    workspaceId: input.workspaceId,
    ...(input.selection.kind === "fusion"
      ? { fusion: input.selection.stop }
      : {
          ...(input.selection.model === null ? {} : { model: input.selection.model }),
          ...(input.selection.thinkingLevel === null
            ? {}
            : { thinkingLevel: input.selection.thinkingLevel }),
        }),
  });
  return id;
}

/**
 * Fires a fresh session's first prompt without waiting for the turn to
 * settle. A send that cannot go out — or comes back rejected — lands the
 * text in the thread's draft, so the words wait in the composer the caller
 * navigates to instead of vanishing with the failure.
 */
export function sendInitialPrompt(sessionId: Session.SessionId, message: ComposerMessage): void {
  const sdk = getHonkClient();
  if (sdk === null) {
    restoreDraft(draftKeyOf(sessionId), message);
    return;
  }
  void sdk.session.prompt({ sessionId, text: message.text, images: message.images }).catch(() => {
    restoreDraft(draftKeyOf(sessionId), message);
  });
}
