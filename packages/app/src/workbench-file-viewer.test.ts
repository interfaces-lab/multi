import { Files, type HonkClient } from "@honk/core";
import { Workspace } from "@honk/core/workspace";
import { describe, expect, it, vi } from "vitest";

import {
  createFileViewerResource,
  FILE_VIEWER_MAX_CHARACTERS,
  type FileViewerState,
} from "./workbench-file-viewer";

type FilesApi = HonkClient["files"];

interface ClientOverrides {
  readonly read?: FilesApi["read"];
  readonly write?: FilesApi["write"];
}

const workspaceId = Workspace.WorkspaceId.make("ws_viewer");

function client(overrides: ClientOverrides) {
  return {
    files: {
      read:
        overrides.read ?? vi.fn().mockResolvedValue({ type: "text", text: "", truncated: false }),
      write: overrides.write ?? vi.fn().mockResolvedValue(undefined),
    },
  };
}

function notFound(): Files.NotFoundError {
  return new Files.NotFoundError({ path: "src/value.ts" });
}

// The resource loads on first subscribe, so settling is one microtask drain past that.
async function settle(
  overrides: ClientOverrides,
  path = "src/value.ts",
): Promise<{ readonly state: FileViewerState; readonly refresh: () => void }> {
  const resource = createFileViewerResource(workspaceId, path, () => client(overrides));
  resource.subscribe(() => {});
  await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");
  return { state: resource.getSnapshot(), refresh: resource.refresh };
}

describe("workbench file viewer content states", () => {
  it("renders decoded text and names the tab's workspace in the read", async () => {
    const read = vi.fn().mockResolvedValue({ type: "text", text: "const one = 1;\n" });

    const { state } = await settle({ read });

    expect(state).toEqual({ phase: "ready", text: "const one = 1;\n" });
    expect(read).toHaveBeenCalledWith({ workspaceId, path: "src/value.ts" });
  });

  it("reports a binary file with its size instead of rendering the payload", async () => {
    const { state } = await settle({
      read: vi.fn().mockResolvedValue({ type: "binary", size: 2048 }),
    });

    expect(state).toEqual({ phase: "binary", sizeBytes: 2048 });
  });

  it("refuses a file past the render cap before building any rows", async () => {
    const text = "x".repeat(FILE_VIEWER_MAX_CHARACTERS + 1);

    const { state } = await settle({ read: vi.fn().mockResolvedValue({ type: "text", text }) });

    expect(state).toEqual({ phase: "oversized", characters: text.length });
  });

  it("separates a deleted file from an empty one through the typed refusal", async () => {
    const missing = await settle({ read: vi.fn().mockRejectedValue(notFound()) });
    const empty = await settle({
      read: vi.fn().mockResolvedValue({ type: "text", text: "" }),
    });

    expect(missing.state).toEqual({ phase: "missing" });
    expect(empty.state).toEqual({ phase: "empty" });
  });

  it("writes the current draft as the file's whole content", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const resource = createFileViewerResource(workspaceId, "src/value.ts", () => client({ write }));

    await resource.save("const value = 2;\n");

    expect(write).toHaveBeenCalledWith({
      workspaceId,
      path: "src/value.ts",
      content: "const value = 2;\n",
    });
  });

  it("reports a failed read and recovers on retry", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("files.read failed"))
      .mockResolvedValue({ type: "text", text: "recovered" });
    const resource = createFileViewerResource(workspaceId, "src/value.ts", () => client({ read }));
    resource.subscribe(() => {});
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");

    expect(resource.getSnapshot()).toEqual({
      phase: "error",
      message: "files.read failed",
    });

    resource.refresh();
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");
    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "recovered" });
  });

  it("reports a disconnected client without calling core", async () => {
    const resource = createFileViewerResource(workspaceId, "src/value.ts", () => null);
    resource.subscribe(() => {});

    expect(resource.getSnapshot()).toEqual({
      phase: "error",
      message: "Honk Core is not connected yet.",
    });
  });

  it("rereads the file when a thread run finishes", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ type: "text", text: "before" })
      .mockResolvedValue({ type: "text", text: "after" });
    const resource = createFileViewerResource(workspaceId, "src/value.ts", () => client({ read }));
    resource.subscribe(() => {});
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");

    resource.observeThreadRunning(true);
    resource.observeThreadRunning(false);
    // The reread keeps the previous content on screen, so the spinner never returns.
    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "before" });

    await vi.waitUntil(() => {
      const state = resource.getSnapshot();
      return state.phase === "ready" && state.text === "after";
    });
    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "after" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("drops a stale read that settles after a refresh", async () => {
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({ type: "text", text: "stale" });
            }, 20);
          }),
      )
      .mockResolvedValue({ type: "text", text: "fresh" });
    const resource = createFileViewerResource(workspaceId, "src/value.ts", () => client({ read }));
    resource.subscribe(() => {});
    resource.refresh();
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");

    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "fresh" });
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    expect(resource.getSnapshot()).toEqual({ phase: "ready", text: "fresh" });
  });
});
