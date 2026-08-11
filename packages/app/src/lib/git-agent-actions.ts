// Presentation for agent-driven Git actions (spec/conversation.md section 8).
// Honk Core owns the action set and the canonical instructions
// (`Session.GitActionId`, dispatched through `session.runGitAction`); this
// module owns only what a surface renders: labels, loading labels, and the
// split-button order.

import { Session } from "@honk/core/session";
import { Option, Schema } from "effect";

export type GitAgentActionId = Session.GitActionId;

export const GIT_AGENT_ACTIONS: Record<
  GitAgentActionId,
  { readonly label: string; readonly loadingLabel: string }
> = {
  createBranch: { label: "Create Branch", loadingLabel: "Creating branch..." },
  createBranchAndCommit: { label: "Create Branch & Commit", loadingLabel: "Committing..." },
  createBranchCommitAndPush: {
    label: "Create Branch, Commit & Push",
    loadingLabel: "Committing...",
  },
  commit: { label: "Commit", loadingLabel: "Committing..." },
  commitAndPush: { label: "Commit & Push", loadingLabel: "Committing..." },
  createPrWithChanges: { label: "Commit & Create PR", loadingLabel: "Creating PR..." },
};

export const GIT_AGENT_ACTION_ORDER: readonly GitAgentActionId[] = [
  "createBranchAndCommit",
  "createBranchCommitAndPush",
  "createBranch",
  "commitAndPush",
  "commit",
  "createPrWithChanges",
];

export const GIT_AGENT_DEFAULT_ACTION: GitAgentActionId = "commitAndPush";

const decodeGitAgentActionId = Schema.decodeUnknownOption(Session.GitActionId);

export const gitAgentActionIdOf = (value: unknown): GitAgentActionId | null =>
  Option.getOrNull(decodeGitAgentActionId(value));
