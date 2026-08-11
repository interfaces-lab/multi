// The file half of the `@` menu: searching the workspace index.
//
// Trigger detection, item building, and splicing live in
// `./prompt-menu-model`, shared with the `/` menu. Caret geometry belongs to
// the editor, which hands the menu a real DOM range. This module is only the
// asking.

import type { Files, HonkClient } from "@honk/core";
import type { Workspace } from "@honk/core/workspace";

/** More rows than the menu could honestly rank; enough to fill its scroll. */
const FIND_LIMIT = 20;
/** Keystrokes inside this window collapse into one find call. */
export const MENTION_FIND_DEBOUNCE_MS = 120;

export interface MentionResults {
  readonly entries: readonly Files.Entry[];
  readonly truncated: boolean;
}

export interface MentionSearchIo {
  readonly list: () => Promise<readonly Files.Entry[]>;
  readonly find: (query: string) => Promise<MentionResults>;
}

export interface MentionSearch {
  /** An empty query is the root listing; anything else is a find. */
  readonly search: (query: string) => void;
  readonly stop: () => void;
}

/**
 * One in-flight answer at a time, by monotonic sequence: every search claims
 * the next number and only the newest claim may publish. The root listing
 * fires immediately — opening the menu should not wait out a debounce — while
 * typed queries debounce {@link MENTION_FIND_DEBOUNCE_MS}.
 */
export function createMentionSearch(
  io: MentionSearchIo,
  publish: (results: MentionResults | null) => void,
  schedule: (run: () => void, delayMs: number) => () => void = (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return () => {
      clearTimeout(timer);
    };
  },
): MentionSearch {
  let sequence = 0;
  let cancelPending: (() => void) | null = null;

  const claim = (): number => {
    cancelPending?.();
    cancelPending = null;
    sequence += 1;
    return sequence;
  };
  const publishIfCurrent = (claimed: number, results: MentionResults | null): void => {
    if (claimed === sequence) publish(results);
  };
  const run = (claimed: number, request: Promise<MentionResults>): void => {
    request.then(
      (results) => {
        publishIfCurrent(claimed, results);
      },
      () => {
        // A failed lookup closes the menu rather than showing a stale list.
        publishIfCurrent(claimed, null);
      },
    );
  };

  return {
    search: (query) => {
      const claimed = claim();
      if (query.length === 0) {
        run(
          claimed,
          io.list().then((entries) => ({ entries, truncated: false })),
        );
        return;
      }
      cancelPending = schedule(() => {
        cancelPending = null;
        run(claimed, io.find(query));
      }, MENTION_FIND_DEBOUNCE_MS);
    },
    stop: () => {
      claim();
    },
  };
}

export const mentionSearchIoOf = (
  client: HonkClient,
  workspaceId: Workspace.WorkspaceId,
): MentionSearchIo => ({
  list: () => client.files.list({ workspaceId }),
  find: (query) => client.files.find({ workspaceId, query, limit: FIND_LIMIT }),
});
