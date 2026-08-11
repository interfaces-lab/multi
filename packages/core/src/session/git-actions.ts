// Agent-driven Git actions (spec/core.md section 12, spec/conversation.md
// section 8): one click becomes an ordinary agent turn. Core owns the
// canonical instruction words so every client that names an action sends the
// same prompt; interfaces own only presentation labels.

import { Schema } from "effect";

/**
 * The actions a client can start by name.
 *
 * `revertFiles` is deliberately absent: restoring files is the typed
 * `session.revert` command, not agent judgment.
 *
 * @category schemas
 */
export const GitActionId = Schema.Literals([
  "createBranch",
  "createBranchAndCommit",
  "createBranchCommitAndPush",
  "commit",
  "commitAndPush",
  "createPrWithChanges",
]).annotate({ identifier: "GitActionId" });
export type GitActionId = typeof GitActionId.Type;

// Surface-neutral on purpose: the same action starts from a chat receipt or a
// source-control panel, and the instructions must not claim an origin.
const HEADER = [
  "Run the requested Git action and nothing else.",
  "Follow AGENTS.md Git rules and stage explicit file paths only (never `git add -A` or `git add .`).",
];

const STEPS: Record<GitActionId, readonly string[]> = {
  createBranch: ["Create a descriptive branch from the current branch.", "Do not commit or push."],
  createBranchAndCommit: [
    "Create a descriptive branch from the current branch.",
    "Stage only the intended file paths.",
    "Create one concise commit.",
    "Do not push.",
  ],
  createBranchCommitAndPush: [
    "Create a descriptive branch from the current branch.",
    "Stage only the intended file paths.",
    "Create one concise commit.",
    "Push the branch and set upstream when needed.",
  ],
  commit: ["Stage only the intended file paths.", "Create one concise commit.", "Do not push."],
  commitAndPush: [
    "Stage only the intended file paths.",
    "Create one concise commit.",
    "Push the current branch and set upstream when needed.",
  ],
  createPrWithChanges: [
    "Create a descriptive branch when the current branch is a mainline.",
    "Stage only the intended file paths.",
    "Create one concise commit.",
    "Push and open a pull request with a clear title and summary.",
  ],
};

/**
 * The canonical prompt for an action — what the model is told, verbatim.
 * The transcript stores this as the turn's real user message, so what the
 * model saw is always what a surface can show.
 */
export const instructionsFor = (action: GitActionId, files?: readonly string[]): string =>
  [
    ...HEADER,
    ...STEPS[action],
    ...(files !== undefined && files.length > 0
      ? [`Limit the action to these paths: ${files.join(", ")}.`]
      : []),
  ].join("\n");
