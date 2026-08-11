import type { HonkClient } from "@honk/core";
import type { Workspace } from "@honk/core/workspace";
import * as React from "react";

import { getHonkClient } from "./chat/client";
import { errorMessage } from "./error-message";

const IMAGE_MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
});

type ImagePreviewState =
  | { readonly phase: "loading" }
  | {
      readonly phase: "ready";
      readonly src: string;
      readonly sizeBytes: number;
    }
  | { readonly phase: "unavailable"; readonly message: string }
  | { readonly phase: "error"; readonly message: string };

type ImagePreviewResource = {
  readonly getSnapshot: () => ImagePreviewState;
  readonly subscribe: (listener: () => void) => () => void;
};

// `files.read` answers text (the SVG path) but deliberately carries no bytes
// for binary files; image bytes travel through `git.fileImage`.
type ImagePreviewClient = {
  readonly files: Pick<HonkClient["files"], "read">;
  readonly git: Pick<HonkClient["git"], "fileImage">;
};
type ImagePreviewClientResolver = () => ImagePreviewClient | null;

const INITIAL_IMAGE_PREVIEW_STATE: ImagePreviewState = Object.freeze({ phase: "loading" });
const imagePreviewResources = new Map<string, ImagePreviewResource>();

function imageExtension(path: string): string {
  const leaf = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const dot = leaf.lastIndexOf(".");
  return dot < 0 ? "" : leaf.slice(dot + 1).toLowerCase();
}

function isImagePreviewPath(path: string): boolean {
  return IMAGE_MEDIA_TYPE_BY_EXTENSION[imageExtension(path)] !== undefined;
}

function imageMediaType(path: string, reported: string | undefined): string | null {
  if (reported?.toLowerCase().startsWith("image/") === true) return reported;
  return IMAGE_MEDIA_TYPE_BY_EXTENSION[imageExtension(path)] ?? null;
}

function base64ByteLength(base64: string): number {
  const normalized = base64.replaceAll(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

async function loadImagePreview(
  client: ImagePreviewClient,
  workspaceId: Workspace.WorkspaceId,
  path: string,
): Promise<ImagePreviewState> {
  const content = await client.files.read({ workspaceId, path });
  if (content.type === "text") {
    const mediaType = imageMediaType(path, undefined);
    if (mediaType !== "image/svg+xml") {
      return { phase: "unavailable", message: "No image preview is available for this file." };
    }
    return {
      phase: "ready",
      src: `data:${mediaType};charset=utf-8,${encodeURIComponent(content.text)}`,
      sizeBytes: new TextEncoder().encode(content.text).byteLength,
    };
  }
  const image = await client.git.fileImage({ workspaceId, path, ref: "working_tree" });
  if (image.type === "absent") {
    return { phase: "unavailable", message: "No image preview is available for this file." };
  }
  const mediaType = imageMediaType(path, image.mediaType);
  if (mediaType === null) {
    return { phase: "unavailable", message: "This file is not a supported image." };
  }
  return {
    phase: "ready",
    src: `data:${mediaType};base64,${image.base64}`,
    sizeBytes: base64ByteLength(image.base64),
  };
}

function createImagePreviewResource(
  workspaceId: Workspace.WorkspaceId,
  path: string,
  resolveClient: ImagePreviewClientResolver,
  onRelease?: () => void,
): ImagePreviewResource {
  let snapshot = INITIAL_IMAGE_PREVIEW_STATE;
  let requested = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: ImagePreviewState): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const load = (): void => {
    if (requested) return;
    requested = true;
    const client = resolveClient();
    if (client === null) {
      publish({ phase: "error", message: "Honk Core is not connected yet." });
      return;
    }
    void loadImagePreview(client, workspaceId, path).then(publish, (error: unknown) => {
      publish({ phase: "error", message: errorMessage(error) });
    });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      listeners.add(listener);
      load();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          // One task lets React Strict Mode resubscribe without a duplicate read, then releases the
          // base64 payload as soon as the expanded body is truly gone.
          releaseTimer = setTimeout(() => {
            if (listeners.size === 0) onRelease?.();
          }, 0);
        }
      };
    },
  };
}

function imagePreviewResourceFor(
  workspaceId: Workspace.WorkspaceId,
  path: string,
): ImagePreviewResource {
  const key = `${workspaceId}:${path}`;
  const existing = imagePreviewResources.get(key);
  if (existing !== undefined) return existing;
  const created = createImagePreviewResource(workspaceId, path, getHonkClient, () => {
    imagePreviewResources.delete(key);
  });
  imagePreviewResources.set(key, created);
  return created;
}

function useImagePreview(workspaceId: Workspace.WorkspaceId, path: string): ImagePreviewState {
  const resource = imagePreviewResourceFor(workspaceId, path);
  return React.useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
}

export {
  base64ByteLength,
  createImagePreviewResource,
  isImagePreviewPath,
  loadImagePreview,
  useImagePreview,
};
export type { ImagePreviewClient, ImagePreviewResource, ImagePreviewState };
