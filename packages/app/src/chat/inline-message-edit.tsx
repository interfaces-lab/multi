import { Icon, IconButton, Text, Tooltip, UserMessage } from "@honk/ui";
import { IconPlusSmall } from "@honk/ui/icons";
import {
  composerVars,
  controlVars,
  conversationVars,
  fontVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { ComposerSubmitButton } from "../composer/submit-button";
import type { ComposerMessage } from "./composer-store";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor";
import type { ActiveMessageEdit } from "./message-edit";
import { CoreModelSelector } from "./model-menu";
import type { ModelSelection } from "./selection";

const styles = stylex.create({
  form: {
    width: "100%",
    minWidth: 0,
  },
  editorContainer: {
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-step-gap"],
    width: "100%",
    minWidth: 0,
  },
  editor: {
    boxSizing: "border-box",
    display: "block",
    width: "100%",
    minWidth: 0,
    minHeight: fontVars["--honk-leading-heading"],
    maxHeight: `calc(${composerVars["--honk-composer-state-band-height"]} * 2)`,
    overflowY: "auto",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
    paddingInlineEnd: `calc((${controlVars["--honk-control-h-sm"]} * 3) + (${spaceVars["--honk-space-gutter"]} * 2))`,
  },
  editBody: {
    position: "relative",
    minHeight: fontVars["--honk-leading-heading"],
    minWidth: 0,
  },
  controls: {
    position: "absolute",
    insetInlineEnd: 0,
    insetBlockEnd: `calc((${fontVars["--honk-leading-heading"]} - ${controlVars["--honk-control-h-sm"]}) / 2)`,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  feedback: { overflowWrap: "anywhere" },
});

type EditingMessage = Extract<ActiveMessageEdit, { readonly phase: "editing" }>;
export type MessageEditCancelReason = "escape" | "outside";

export function InlineMessageEdit({
  edit,
  running,
  available,
  onChange,
  onSelectionChange,
  onCancel,
  onSubmit,
}: {
  readonly edit: EditingMessage;
  readonly running: boolean;
  readonly available: boolean;
  readonly onChange: (message: ComposerMessage) => void;
  readonly onSelectionChange: (selection: ModelSelection) => void;
  readonly onCancel: (reason: MessageEditCancelReason) => void;
  readonly onSubmit: (message: ComposerMessage) => void;
}): React.ReactElement {
  const editorRef = React.useRef<ComposerEditorHandle | null>(null);
  const editorMessageRef = React.useRef(edit.message);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const cancelRef = React.useRef(onCancel);
  cancelRef.current = onCancel;
  const [imageReadPending, setImageReadPending] = React.useState(false);
  const hasMessage = edit.message.text.length > 0 || edit.message.images.length > 0;
  const waitHint = !available
    ? "Reconnect to save this edit"
    : running
      ? "Wait for the current run to finish"
      : imageReadPending
        ? "Adding images…"
        : null;

  React.useLayoutEffect(() => {
    if (editorMessageRef.current === edit.message) return;
    editorMessageRef.current = edit.message;
    editorRef.current?.reconcile(edit.message);
  }, [edit.message]);

  // Frozen Cursor dismisses the inline intent when interaction moves outside
  // its form. Capture catches a click on non-focusable transcript/workbench
  // content too; Escape remains the explicit keyboard exit in the editor.
  React.useEffect(() => {
    let cancelled = false;
    const cancelFromOutside = (event: Event): void => {
      const target = event.target;
      if (
        cancelled ||
        !(target instanceof Element) ||
        formRef.current?.contains(target) === true ||
        target.closest("[data-message-edit-control]") !== null
      ) {
        return;
      }
      cancelled = true;
      cancelRef.current("outside");
    };
    document.addEventListener("pointerdown", cancelFromOutside, true);
    document.addEventListener("focusin", cancelFromOutside, true);
    return () => {
      document.removeEventListener("pointerdown", cancelFromOutside, true);
      document.removeEventListener("focusin", cancelFromOutside, true);
    };
  }, []);

  const submit = (): void => {
    if (!available || running || imageReadPending) return;
    const submission = editorRef.current?.read();
    if (submission === undefined) return;
    if (submission.text.length === 0 && submission.images.length === 0) return;
    onSubmit({ text: submission.text, images: submission.images });
  };

  return (
    <form
      ref={formRef}
      data-inline-message-edit=""
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <UserMessage>
        <div data-inline-message-edit-row="" {...stylex.props(styles.editBody)}>
          <ComposerEditor
            handleRef={editorRef}
            initialText={edit.message.text}
            initialImages={edit.message.images}
            placeholder="Edit message…"
            ariaLabel="Edit message"
            autoFocus
            containerStyle={styles.editorContainer}
            editorStyle={styles.editor}
            onChange={(message) => {
              editorMessageRef.current = message;
              onChange(message);
            }}
            onImageReadPendingChange={setImageReadPending}
            onSubmit={submit}
            onEscape={() => {
              onCancel("escape");
            }}
            menu={null}
          />
          <div data-inline-message-edit-controls="" {...stylex.props(styles.controls)}>
            <CoreModelSelector
              mode="edit"
              selection={edit.selection}
              disabled={imageReadPending}
              onSelectionChange={onSelectionChange}
            />
            <Tooltip label="Add images">
              <IconButton
                aria-label="Add images"
                size="sm"
                disabled={imageReadPending}
                onClick={() => {
                  editorRef.current?.chooseImages();
                }}
              >
                <Icon icon={IconPlusSmall} size="sm" tone="faint" />
              </IconButton>
            </Tooltip>
            <ComposerSubmitButton
              type="submit"
              ariaLabel="Save and rerun"
              disabled={!hasMessage || imageReadPending || running || !available}
            />
          </div>
        </div>
        {edit.error === null ? null : (
          <div {...stylex.props(styles.feedback)}>
            <Text as="div" role="alert" size="xs" tone="err">
              {edit.error}
            </Text>
          </div>
        )}
        {waitHint === null ? null : (
          <div {...stylex.props(styles.feedback)}>
            <Text as="div" role="status" aria-live="polite" size="xs" tone="faint">
              {waitHint}
            </Text>
          </div>
        )}
      </UserMessage>
    </form>
  );
}
