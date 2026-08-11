import type { Workspace } from "@honk/core/workspace";
import { Spinner, Text } from "@honk/ui";
import { borderVars, colorVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { useImagePreview } from "./workbench-changes-image-resource";

// The expanded preview keeps the old GitImageView's 128px reserved body. This is content geometry,
// not a spacing value, and prevents the row from jumping when the image finishes decoding.
const IMAGE_PREVIEW_MIN_HEIGHT = "128px";
// The preview may grow with its image, but it must leave the surrounding Changes panel scrollable.
const IMAGE_PREVIEW_MAX_HEIGHT = "70vh";

const styles = stylex.create({
  root: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  frame: {
    minWidth: 0,
    minHeight: IMAGE_PREVIEW_MIN_HEIGHT,
    maxHeight: IMAGE_PREVIEW_MAX_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "auto",
    padding: spaceVars["--honk-space-panel-pad"],
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-muted"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  image: {
    display: "block",
    maxWidth: "100%",
    maxHeight: `calc(${IMAGE_PREVIEW_MAX_HEIGHT} - 2 * ${spaceVars["--honk-space-panel-pad"]})`,
    objectFit: "contain",
  },
  meta: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-panel-pad"],
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  path: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  size: {
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  notice: {
    minHeight: IMAGE_PREVIEW_MIN_HEIGHT,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${String(sizeBytes)} B`;
  const kibibytes = sizeBytes / 1024;
  if (kibibytes < 1024) return `${kibibytes < 10 ? kibibytes.toFixed(1) : kibibytes.toFixed(0)} KB`;
  const mebibytes = kibibytes / 1024;
  return `${mebibytes < 10 ? mebibytes.toFixed(1) : mebibytes.toFixed(0)} MB`;
}

function ImageNotice({
  title,
  message,
}: {
  readonly title: string;
  readonly message: string;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.notice)}>
      <Text as="p" size="sm" tone="muted" weight="regular">
        {title}
      </Text>
      <Text as="p" size="xs" tone="faint">
        {message}
      </Text>
    </div>
  );
}

function DecodedImage({ src, path }: { readonly src: string; readonly path: string }) {
  const [decodeFailed, setDecodeFailed] = React.useState(false);
  if (decodeFailed) {
    return (
      <ImageNotice
        title="Could not decode image"
        message="The browser could not render this image preview."
      />
    );
  }
  return (
    <img
      src={src}
      alt={path}
      onError={() => {
        setDecodeFailed(true);
      }}
      {...stylex.props(styles.image)}
    />
  );
}

function WorkbenchChangesImage({
  workspaceId,
  path,
}: {
  readonly workspaceId: Workspace.WorkspaceId;
  readonly path: string;
}): React.ReactElement {
  const snapshot = useImagePreview(workspaceId, path);
  if (snapshot.phase === "loading") {
    return (
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.frame)}>
          <Spinner label="Loading image preview" size="sm" tone="muted" />
        </div>
      </div>
    );
  }
  if (snapshot.phase === "error") {
    return <ImageNotice title="Could not load image" message={snapshot.message} />;
  }
  if (snapshot.phase === "unavailable") {
    return <ImageNotice title="Image unavailable" message={snapshot.message} />;
  }
  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.frame)}>
        <DecodedImage key={snapshot.src} src={snapshot.src} path={path} />
      </div>
      <div {...stylex.props(styles.meta)}>
        <span title={path} {...stylex.props(styles.path)}>
          {path}
        </span>
        <span {...stylex.props(styles.size)}>{formatBytes(snapshot.sizeBytes)}</span>
      </div>
    </div>
  );
}

export { WorkbenchChangesImage };
