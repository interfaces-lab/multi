import type { Git } from "@honk/core";
import { Session } from "@honk/core/session";
import { Workspace } from "@honk/core/workspace";
import { describe, expect, it, vi } from "vitest";

import {
  createChangesResource,
  fileStatusGlyph,
  type ChangesClient,
} from "./workbench-changes-resource";
import type { WorkbenchSessionRef } from "./workbench-frame";

const workspaceId = Workspace.WorkspaceId.make("ws_changes");
const sessionId = Session.SessionId.make("ses_changes");
const ref: WorkbenchSessionRef = { sessionId, workspaceId };

function change(input: {
  readonly file: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly status?: Git.ChangeStatus;
}): Git.FileChange {
  return {
    file: input.file,
    status: input.status ?? "modified",
    tracked: true,
    binary: false,
    additions: input.additions ?? 0,
    deletions: input.deletions ?? 0,
  };
}

function diff(input: {
  readonly file: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly status?: Git.ChangeStatus;
  readonly patch?: string;
}): Git.FileDiff {
  return {
    file: input.file,
    ...(input.status === undefined ? {} : { status: input.status }),
    tracked: true,
    binary: false,
    additions: input.additions ?? 0,
    deletions: input.deletions ?? 0,
    ...(input.patch === undefined ? {} : { patch: input.patch }),
  };
}

function changesClient(input?: {
  readonly files?: readonly Git.FileChange[];
  readonly branchFiles?: readonly Git.FileChange[];
  readonly diffs?: readonly Git.FileDiff[];
  readonly branchDiffs?: readonly Git.FileDiff[];
  readonly turns?: readonly {
    readonly entryId: string;
    readonly files: readonly Git.FileChange[];
  }[];
  readonly checkpointDiffs?: readonly Git.FileDiff[];
  readonly defaultBranch?: string | null;
  readonly error?: Error;
}) {
  const status = vi.fn((query: { readonly mode?: "git" | "branch" }) =>
    input?.error === undefined
      ? Promise.resolve({
          branch: "codex/utility-tabs",
          defaultBranch: input?.defaultBranch ?? null,
          files: (query.mode === "branch" ? input?.branchFiles : input?.files) ?? [],
        })
      : Promise.reject(input.error),
  );
  const diffFn = vi.fn((query: { readonly mode?: "git" | "branch" }) =>
    Promise.resolve((query.mode === "branch" ? input?.branchDiffs : input?.diffs) ?? []),
  );
  const checkpointDiff = vi.fn(() => Promise.resolve(input?.checkpointDiffs ?? []));
  const changes = vi.fn(() => Promise.resolve({ turns: input?.turns ?? [] }));
  const client: ChangesClient = {
    git: { status, diff: diffFn, checkpointDiff },
    session: { changes },
  };
  return { client, status, diff: diffFn, checkpointDiff, changes };
}

async function readySnapshot(resource: ReturnType<typeof createChangesResource>) {
  resource.subscribe(() => {});
  await vi.waitFor(() => {
    expect(resource.getSnapshot().phase).toBe("ready");
  });
  const snapshot = resource.getSnapshot();
  if (snapshot.phase !== "ready") throw new Error("Expected ready changes.");
  return snapshot;
}

describe("Changes resource", () => {
  it("loads modified, added, and deleted files from the working tree", async () => {
    const files = [
      change({ file: "src/modified.ts", additions: 3, deletions: 1 }),
      change({ file: "src/added.ts", additions: 8, status: "added" }),
      change({ file: "public/deleted.png", status: "deleted" }),
    ];
    const mock = changesClient({
      files,
      diffs: [
        diff({
          file: "src/modified.ts",
          additions: 3,
          deletions: 1,
          status: "modified",
          patch: "@@ -1 +1 @@\n-old\n+new",
        }),
        diff({ file: "public/deleted.png", status: "deleted" }),
      ],
    });
    const resource = createChangesResource(ref, "git", () => mock.client);

    expect(resource.getSnapshot()).toEqual({ phase: "loading" });
    const snapshot = await readySnapshot(resource);
    expect(snapshot.branch).toBe("codex/utility-tabs");
    expect(snapshot.files).toEqual(files);
    await vi.waitFor(() => {
      expect(resource.getSnapshot()).toMatchObject({ diffsPending: false });
    });
    const settled = resource.getSnapshot();
    if (settled.phase !== "ready") throw new Error("Expected ready changes.");
    expect(settled.diffs.get("src/modified.ts")?.patch).toContain("+new");
    expect(settled.diffs.get("public/deleted.png")?.patch).toBeUndefined();
    expect(files.map((file) => fileStatusGlyph(file.status))).toEqual(["M", "A", "D"]);
  });

  it("distinguishes a clean tree from a host error", async () => {
    const clean = createChangesResource(ref, "git", () => changesClient().client);
    const cleanSnapshot = await readySnapshot(clean);
    expect(cleanSnapshot.files).toEqual([]);

    const failed = createChangesResource(
      ref,
      "git",
      () => changesClient({ error: new Error("git host failed") }).client,
    );
    failed.subscribe(() => {});
    await vi.waitFor(() => {
      expect(failed.getSnapshot()).toEqual({ phase: "error", message: "git host failed" });
    });
  });

  it("answers the merge-base scope from branch-mode status and diff", async () => {
    const branchFiles = [
      change({ file: "src/committed.ts", additions: 4, deletions: 2 }),
      change({ file: "src/added.ts", additions: 7, status: "added" }),
    ];
    const mock = changesClient({
      defaultBranch: "main",
      files: [change({ file: "src/working-tree.ts", additions: 1 })],
      branchFiles,
      branchDiffs: [
        diff({ file: "src/committed.ts", additions: 4, deletions: 2, patch: "@@ -1 +1 @@" }),
      ],
    });
    const resource = createChangesResource(ref, "branch", () => mock.client);

    const snapshot = await readySnapshot(resource);
    expect(snapshot.defaultBranch).toBe("main");
    expect(mock.status).toHaveBeenCalledWith({ workspaceId, mode: "branch" });
    expect(snapshot.files).toEqual(branchFiles);
    await vi.waitFor(() => {
      expect(mock.diff).toHaveBeenCalledWith({ workspaceId, mode: "branch" });
      expect(resource.getSnapshot()).toMatchObject({ diffsPending: false });
    });
  });

  it("reads the last-turn scope from the session receipt and its checkpoint diff", async () => {
    const turnFiles = [change({ file: "src/turn.ts", additions: 5, deletions: 3 })];
    const mock = changesClient({
      files: [change({ file: "src/working-tree.ts", additions: 1 })],
      turns: [
        { entryId: "entry-1", files: [change({ file: "src/earlier.ts" })] },
        { entryId: "entry-2", files: turnFiles },
      ],
      checkpointDiffs: [diff({ file: "src/turn.ts", additions: 5, deletions: 3, patch: "@@" })],
    });
    const resource = createChangesResource(ref, "lastTurn", () => mock.client);

    const snapshot = await readySnapshot(resource);
    expect(snapshot.files).toEqual(turnFiles);
    await vi.waitFor(() => {
      expect(mock.checkpointDiff).toHaveBeenCalledWith({
        workspaceId,
        from: `${sessionId}/entry-1`,
        to: `${sessionId}/entry-2`,
      });
    });
    expect(mock.diff).not.toHaveBeenCalled();
  });

  it("diffs the first turn against the session's base checkpoint", async () => {
    const mock = changesClient({
      turns: [{ entryId: "entry-1", files: [change({ file: "src/turn.ts" })] }],
    });
    const resource = createChangesResource(ref, "lastTurn", () => mock.client);

    await readySnapshot(resource);
    await vi.waitFor(() => {
      expect(mock.checkpointDiff).toHaveBeenCalledWith({
        workspaceId,
        from: `${sessionId}/base`,
        to: `${sessionId}/entry-1`,
      });
    });
  });

  it("keeps a resource per scope so switching back does not clobber the other", () => {
    const mock = changesClient({ defaultBranch: "main" });
    expect(createChangesResource(ref, "git", () => mock.client)).not.toBe(
      createChangesResource(ref, "branch", () => mock.client),
    );
  });

  it("refreshes after a running turn becomes idle", async () => {
    const mock = changesClient();
    const resource = createChangesResource(ref, "git", () => mock.client);
    await readySnapshot(resource);
    expect(mock.status).toHaveBeenCalledTimes(1);

    resource.observeThreadRunning(true);
    resource.observeThreadRunning(false);
    await vi.waitFor(() => {
      expect(mock.status).toHaveBeenCalledTimes(2);
    });
  });
});
