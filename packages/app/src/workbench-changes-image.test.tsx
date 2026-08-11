import type { HonkClient } from "@honk/core";
import { Workspace } from "@honk/core/workspace";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkbenchChangesCard } from "./workbench-changes-card";
import {
  base64ByteLength,
  createImagePreviewResource,
  isImagePreviewPath,
  loadImagePreview,
  type ImagePreviewClient,
} from "./workbench-changes-image-resource";

type FilesApi = HonkClient["files"];
type GitApi = HonkClient["git"];

const workspaceId = Workspace.WorkspaceId.make("ws_image");

function imageClient(overrides: {
  readonly read?: FilesApi["read"];
  readonly fileImage?: GitApi["fileImage"];
}): ImagePreviewClient {
  return {
    files: {
      read: overrides.read ?? vi.fn().mockResolvedValue({ type: "binary", size: 4 }),
    },
    git: {
      fileImage:
        overrides.fileImage ??
        vi.fn().mockResolvedValue({
          type: "image",
          file: "assets/study.jpg",
          ref: "working_tree",
          mediaType: "image/jpeg",
          base64: "AQIDBA==",
        }),
    },
  };
}

describe("workbench Changes image preview", () => {
  it("recognizes the image formats the renderer can preview", () => {
    expect(isImagePreviewPath("assets/study.JPG")).toBe(true);
    expect(isImagePreviewPath("assets/diagram.svg")).toBe(true);
    expect(isImagePreviewPath("src/index.ts")).toBe(false);
  });

  it("loads image bytes only after an expanded preview subscribes", async () => {
    const fileImage = vi.fn().mockResolvedValue({
      type: "image",
      file: "assets/study.jpg",
      ref: "working_tree",
      mediaType: "image/jpeg",
      base64: "AQIDBA==",
    });
    const resource = createImagePreviewResource(workspaceId, "assets/study.jpg", () =>
      imageClient({ fileImage }),
    );

    expect(fileImage).not.toHaveBeenCalled();
    const unsubscribe = resource.subscribe(() => {});
    await vi.waitUntil(() => resource.getSnapshot().phase !== "loading");

    expect(fileImage).toHaveBeenCalledWith({
      workspaceId,
      path: "assets/study.jpg",
      ref: "working_tree",
    });
    expect(resource.getSnapshot()).toEqual({
      phase: "ready",
      src: "data:image/jpeg;base64,AQIDBA==",
      sizeBytes: 4,
    });
    unsubscribe();
  });

  it("turns text SVG content into an image source without fetching bytes", async () => {
    const fileImage = vi.fn();
    const state = await loadImagePreview(
      imageClient({
        read: vi.fn().mockResolvedValue({ type: "text", text: "<svg></svg>", truncated: false }),
        fileImage,
      }),
      workspaceId,
      "assets/mark.svg",
    );

    expect(state.phase).toBe("ready");
    if (state.phase !== "ready") return;
    expect(state.src).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E");
    expect(fileImage).not.toHaveBeenCalled();
  });

  it("keeps the image body absent while its row is collapsed", () => {
    const render = (isExpanded: boolean): string =>
      renderToStaticMarkup(
        <WorkbenchChangesCard
          file={{
            file: "assets/study.jpg",
            additions: 0,
            deletions: 0,
            status: "added",
            tracked: false,
            binary: true,
          }}
          workspaceId={workspaceId}
          patch={undefined}
          patchPending={false}
          diffStyle="unified"
          wordWrap={false}
          theme="light"
          isExpanded={isExpanded}
          onToggleExpand={vi.fn()}
          isActive={false}
          onSelect={vi.fn()}
          isViewed={false}
          onToggleViewed={vi.fn()}
          isIncluded
          onToggleInclude={vi.fn()}
          onRevert={vi.fn()}
          actionsDisabled={false}
        />,
      );

    expect(render(false)).not.toContain("Loading image preview");
    expect(render(true)).toContain("Loading image preview");
  });

  it("counts decoded bytes without allocating another binary buffer", () => {
    expect(base64ByteLength("AQIDBA==")).toBe(4);
    expect(base64ByteLength("AQI=")).toBe(2);
  });
});
