import { Icon, IconButton } from "@honk/ui";
import { IconCrossSmall } from "@honk/ui/icons";
import { colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { Session } from "@honk/core/session";

const IMAGE_PREVIEW_SIZE = `calc(${controlVars["--honk-control-h-lg"]} * 2)`;

const styles = stylex.create({
  strip: {
    display: "flex",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
  },
  frame: {
    position: "relative",
    width: IMAGE_PREVIEW_SIZE,
    height: IMAGE_PREVIEW_SIZE,
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  image: { display: "block", width: "100%", height: "100%", objectFit: "cover" },
  remove: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineEnd: 0,
  },
});

const sourceOf = (image: Session.PromptImage): string =>
  `data:${image.mimeType};base64,${image.data}`;

export function MessageImages({
  images,
  onRemove,
}: {
  readonly images: readonly Session.PromptImage[];
  readonly onRemove?: (index: number) => void;
}): React.ReactElement | null {
  if (images.length === 0) return null;
  return (
    <div aria-label="Uploaded images" {...stylex.props(styles.strip)}>
      {images.map((image, index) => (
        <div
          key={`${image.mimeType}:${image.data.slice(0, 24)}:${String(index)}`}
          {...stylex.props(styles.frame)}
        >
          <img
            src={sourceOf(image)}
            alt={`Uploaded image ${String(index + 1)}`}
            draggable={false}
            {...stylex.props(styles.image)}
          />
          {onRemove === undefined ? null : (
            <span {...stylex.props(styles.remove)}>
              <IconButton
                aria-label={`Remove uploaded image ${String(index + 1)}`}
                size="sm"
                variant="neutral"
                onClick={() => {
                  onRemove(index);
                }}
              >
                <Icon icon={IconCrossSmall} size="xs" />
              </IconButton>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
