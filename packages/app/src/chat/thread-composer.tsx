// The thread composer, rebuilt to the released input's pixels (f3965987e
// thread/composer.tsx) on core's three verbs. Idle Enter prompts; running
// Enter queues a follow-up; running Cmd/Ctrl+Enter steers the run in flight;
// Stop restores whatever Pi had queued during an ordinary reply. An edited
// rerun owns its cleared queues, so stopping it leaves the reply draft alone.
// The queue tray above the input is Pi's own queue replayed through
// `queue_update` frames — read-only here.
//
// The trays and the input paint as sibling surfaces in one measured stack,
// the way Cursor draws them: the input's own height and radius never change
// when a tray appears.

import { Icon, IconButton, Text, Tooltip } from "@honk/ui";
import { IconPlusSmall } from "@honk/ui/icons";
import {
  colorVars,
  composerVars,
  fontVars,
  radiusVars,
  spaceVars,
  workbenchSurfaceVars,
} from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { Session } from "@honk/core/session";

import { ComposerSubmitButton } from "../composer/submit-button";
import { clearedMessageOf } from "./chat-model";
import { useCoreSession } from "./chat-store";
import { describeError, getHonkClient } from "./client";
import {
  draftKeyOf,
  EMPTY_MESSAGE,
  promptPhaseOf,
  readDraft,
  restoreDraft,
  submitLabelOf,
  submitVerbOf,
  useDraft,
  type ComposerMessage,
} from "./composer-store";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor";
import { useFocusOnType, type FocusOnTypeEditor } from "./focus-on-type";
import { CoreModelSelector } from "./model-menu";
import { loadPromptMenu } from "./prompt-menu-resource";
import { usePromptMenu } from "./use-prompt-menu";
import { ComposerQueueTray } from "./queue-tray";
import { useSessionWorkspace } from "./session-workspace";
import { TRANSCRIPT_MAX_WIDTH } from "./transcript";

const LazyPromptMenu = React.lazy(() =>
  loadPromptMenu().then((module) => ({ default: module.PromptMenu })),
);

const COMPOSER_COLLAPSED_PADDING_INLINE_PX = 10;
const COMPOSER_COLLAPSED_PADDING_INLINE = `${String(COMPOSER_COLLAPSED_PADDING_INLINE_PX)}px`;
const COMPOSER_EDITOR_LINE_HEIGHT_PX = 20;
const COMPOSER_EDITOR_LINE_HEIGHT = `${String(COMPOSER_EDITOR_LINE_HEIGHT_PX)}px`;
const COMPOSER_EDITOR_MAX_HEIGHT_PX = 120;
const COMPOSER_EDITOR_MAX_HEIGHT = `${String(COMPOSER_EDITOR_MAX_HEIGHT_PX)}px`;
const COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE = "4px";
const COMPOSER_CONTROLS_EXPANDED_PADDING_BLOCK = "6px";
const COMPOSER_RING = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border"]}`;
const COMPOSER_RING_ACTIVE = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border-active"]}`;

// The composer shares the transcript's column measure: same max width, same
// inline inset, centered under the conversation it continues. Inline because
// StyleX cannot fold a cross-module constant into `stylex.create`.
const COLUMN_MEASURE_STYLE: React.CSSProperties = { maxWidth: TRANSCRIPT_MAX_WIDTH };

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    width: "100%",
    marginInline: "auto",
    paddingInline: spaceVars["--honk-space-panel-pad"],
    paddingBlockEnd: spaceVars["--honk-space-panel-pad"],
    paddingBlockStart: spaceVars["--honk-space-gutter"],
  },
  // Cursor measures trays and the input as one obstruction while painting them as sibling
  // surfaces. The input's own height and radius therefore never change when a tray appears.
  composerStack: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    gap: spaceVars["--honk-space-gutter"],
  },
  inputBox: {
    flexShrink: 0,
    minHeight: 0,
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    boxShadow: {
      default: COMPOSER_RING,
      ":hover": { "@media (hover: hover)": COMPOSER_RING_ACTIVE },
      ":focus-within": COMPOSER_RING_ACTIVE,
    },
  },
  inputRowCollapsed: {
    minHeight: composerVars["--honk-composer-state-band-height"],
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: COMPOSER_COLLAPSED_PADDING_INLINE,
  },
  inputColumnExpanded: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  editorContainerCollapsed: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  editor: {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    borderWidth: 0,
    backgroundColor: "transparent",
    outline: "none",
    color: "inherit",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    resize: "none",
    overflowY: "auto",
    minHeight: COMPOSER_EDITOR_LINE_HEIGHT,
    maxHeight: COMPOSER_EDITOR_MAX_HEIGHT,
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
  },
  editorCollapsed: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px collapsed-editor inline padding is fixed geometry, no spacing token owns 4px
    paddingInline: COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE,
  },
  editorExpanded: {
    paddingTop: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  controlsCollapsed: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  controlsExpanded: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 6px controls-row block padding is fixed geometry, control-gap is a gap token not a padding token
    paddingBlock: COMPOSER_CONTROLS_EXPANDED_PADDING_BLOCK,
    paddingInline: COMPOSER_COLLAPSED_PADDING_INLINE,
  },
  errorText: {
    paddingTop: spaceVars["--honk-space-gutter"],
    fontSize: fontVars["--honk-font-size-detail"],
    color: colorVars["--honk-color-err-fg"],
  },
});

// Plain object: the @honk/ui `style` hatch merges inline CSS, not StyleX styles.
const HINT_STYLE: React.CSSProperties = { flexGrow: 1, minWidth: 0 };

export type ThreadComposerEditContext =
  | { readonly kind: "none" }
  | { readonly kind: "editing"; readonly onReplyFocus: () => void }
  | { readonly kind: "submitting"; readonly requestId: number };

const NO_MESSAGE_EDIT: ThreadComposerEditContext = { kind: "none" };

export function ThreadComposer({
  sessionId,
  messageEdit = NO_MESSAGE_EDIT,
}: {
  readonly sessionId: Session.SessionId;
  readonly messageEdit?: ThreadComposerEditContext;
}): React.ReactElement {
  const { state, prompt, steer, followUp, stop, setThinkingLevel, setModel } =
    useCoreSession(sessionId);
  const workspace = useSessionWorkspace(sessionId);
  const draftKey = draftKeyOf(sessionId);
  const [draft, setDraft] = useDraft(draftKey);
  const [imageReadPending, setImageReadPending] = React.useState(false);
  // A failed model or level change is transient: the line shows, the session
  // stays alive, and the next attempt clears it.
  const [composerError, setComposerError] = React.useState<string | null>(null);
  const running = state.status === "running";
  const phase = promptPhaseOf(draft, false);
  // The held Cmd/Ctrl modifier: while it is down, Enter steers, and the
  // submit button's label says so.
  const [modHeld, setModHeld] = React.useState(false);
  // Expand to the column layout when the editor wraps; collapse when cleared.
  const [expanded, setExpanded] = React.useState(false);
  const [caret, setCaret] = React.useState(0);
  const editorRef = React.useRef<ComposerEditorHandle | null>(null);
  // Read once: the editor owns the text from here on, and re-seeding it on
  // every store write would fight the caret.
  const [initialDraft] = React.useState(() => readDraft(draftKey));
  const editorMessageRef = React.useRef<ComposerMessage>(initialDraft);
  const editFocusRequest = messageEdit.kind === "submitting" ? messageEdit.requestId : null;

  React.useLayoutEffect(() => {
    if (editFocusRequest !== null) editorRef.current?.focus();
  }, [editFocusRequest]);

  // Local editor changes write their exact object to the draft store. A
  // different object is therefore an external restore (abort, rejected send,
  // or a late first-prompt failure) and must be put back into Lexical as well
  // as the store. Identity avoids resetting the caret during ordinary typing.
  React.useLayoutEffect(() => {
    if (draft === editorMessageRef.current) return;
    editorMessageRef.current = draft;
    editorRef.current?.reconcile(draft);
  }, [draft]);

  // The editor grows with its content and the column layout takes over once it
  // wraps; it only collapses again when the draft empties, so the two widths
  // can never argue about one borderline line.
  React.useLayoutEffect(() => {
    if (!expanded && phase === "draft") setExpanded(true);
    if (expanded && phase === "empty") setExpanded(false);
  }, [expanded, phase]);

  // -------------------------------------------------------------------------
  // Focus-on-type: stray printable keys land in the draft, at the end.
  // -------------------------------------------------------------------------
  const focusEditorRef = React.useRef<FocusOnTypeEditor | null>(null);
  React.useEffect(() => {
    focusEditorRef.current = {
      focus: () => editorRef.current?.focus(),
      insertText: (text) => {
        editorRef.current?.appendText(text);
      },
    };
    return () => {
      focusEditorRef.current = null;
    };
  }, [draftKey]);
  useFocusOnType(focusEditorRef);

  // -------------------------------------------------------------------------
  // The `/` and `@` menus, both from the one driver over the one editor.
  // -------------------------------------------------------------------------
  const workspaceId = workspace.status === "ready" ? workspace.workspace.workspaceId : null;
  const menu = usePromptMenu({ draft: draft.text, caret, workspaceId, editor: editorRef });

  // -------------------------------------------------------------------------
  // The verbs.
  // -------------------------------------------------------------------------
  const restoreCurrentDraft = (message: ComposerMessage): void => {
    restoreDraft(draftKey, message);
    const restored = readDraft(draftKey);
    editorMessageRef.current = restored;
    editorRef.current?.reconcile(restored);
  };

  const send = (sendNow: boolean): void => {
    if (imageReadPending) return;
    const editor = editorRef.current;
    if (editor === null) return;
    // One read of the editor is the whole message: text, images, and whether a
    // chip makes this a resource invocation instead of a prompt.
    const submission = editor.read();
    if (submission.text.length === 0 && submission.images.length === 0) return;
    const message = { text: submission.text, images: submission.images };
    // A send clears optimistically; typing the next thought never waits.
    editorMessageRef.current = EMPTY_MESSAGE;
    editor.clear();
    setDraft(EMPTY_MESSAGE);
    setCaret(0);

    // A resource chip routes to Pi's own invocation verbs, which format the
    // message from the skill or template it already holds. Everything else is
    // an ordinary prompt, steer, or follow-up.
    if (submission.resource !== null) {
      const client = getHonkClient();
      if (client === null) {
        restoreCurrentDraft(message);
        return;
      }
      if (submission.images.length > 0) {
        restoreCurrentDraft(message);
        setComposerError("Skills and commands do not accept images.");
        return;
      }
      const { kind, name } = submission.resource;
      const run =
        kind === "skill"
          ? client.session.runSkill({
              sessionId,
              name,
              ...(submission.text.length === 0 ? {} : { instructions: submission.text }),
            })
          : client.session.runCommand({
              sessionId,
              name,
              ...(submission.text.length === 0 ? {} : { args: submission.text }),
            });
      run.catch((error: unknown) => {
        setComposerError(describeError(error));
        restoreCurrentDraft(message);
      });
      return;
    }

    const verb = submitVerbOf(running, sendNow);
    const dispatch = verb === "prompt" ? prompt : verb === "steer" ? steer : followUp;
    // A rejected send puts the words back — nothing typed is lost.
    void dispatch(message).catch((error: unknown) => {
      setComposerError(describeError(error));
      restoreCurrentDraft(message);
    });
  };

  const stopRun = (): void => {
    void stop().then(
      (cleared) => {
        if (messageEdit.kind !== "submitting") {
          restoreCurrentDraft(clearedMessageOf(cleared));
        }
      },
      (error: unknown) => {
        setComposerError(describeError(error));
      },
    );
  };

  const applySetting = (change: Promise<void>): void => {
    setComposerError(null);
    change.catch((error: unknown) => {
      setComposerError(describeError(error));
    });
  };

  const label = submitLabelOf(phase, running, modHeld);
  const hasDraft = phase === "draft";
  const modelSelector = (
    <CoreModelSelector
      mode="session"
      selection={
        state.fusionStop === null
          ? { kind: "model", model: state.model, thinkingLevel: state.thinkingLevel }
          : { kind: "fusion", stop: state.fusionStop }
      }
      // Only a dead session disables the selection — Pi buffers mid-run changes.
      disabled={state.status === "failed" || state.status === "disconnected"}
      onModelChange={(choice) => {
        applySetting(setModel(choice));
      }}
      onThinkingLevel={(level) => {
        applySetting(setThinkingLevel(level));
      }}
    />
  );
  // One trailing action per state: a running agent with an empty editor
  // offers Stop alone; otherwise one submit button names what Enter will do.
  const trailingAction =
    running && !hasDraft ? (
      <ComposerSubmitButton intent="stop" onClick={stopRun} />
    ) : (
      <ComposerSubmitButton type="submit" ariaLabel={label} disabled={!hasDraft} />
    );
  const imageButton = (
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
  );
  const controls = (
    <>
      {imageButton}
      {modelSelector}
      <Text size="xs" tone="faint" style={HINT_STYLE}>
        {running && hasDraft ? "⏎ queues · ⌘⏎ sends now" : ""}
      </Text>
      {trailingAction}
    </>
  );
  const editor = (
    <ComposerEditor
      handleRef={editorRef}
      initialText={initialDraft.text}
      initialImages={initialDraft.images}
      placeholder="Reply…"
      ariaLabel="Reply"
      autoFocus
      editorStyle={[styles.editor, expanded ? styles.editorExpanded : styles.editorCollapsed]}
      onChange={(message, offset) => {
        const next =
          message.text.length === 0 && message.images.length === 0 ? EMPTY_MESSAGE : message;
        editorMessageRef.current = next;
        setDraft(next);
        setCaret(offset);
        menu.noteEdit();
      }}
      onImageReadPendingChange={setImageReadPending}
      onSubmit={send}
      menu={{
        open: menu.open,
        listboxId: menu.listboxId,
        activeOptionId: menu.open ? `${menu.listboxId}-option-${String(menu.selectedIndex)}` : null,
        accept: menu.acceptHighlighted,
        dismiss: menu.dismiss,
        move: menu.moveSelection,
      }}
    />
  );

  return (
    <form
      {...stylex.props(styles.root, styles.composerStack)}
      style={COLUMN_MEASURE_STYLE}
      onSubmit={(event) => {
        event.preventDefault();
        send(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Meta" || event.key === "Control") setModHeld(true);
      }}
      onKeyUp={(event) => {
        if (event.key === "Meta" || event.key === "Control") setModHeld(false);
      }}
      onBlur={() => {
        setModHeld(false);
      }}
      onFocusCapture={() => {
        if (messageEdit.kind === "editing") messageEdit.onReplyFocus();
      }}
    >
      <ComposerQueueTray queue={state.queue} />
      <div data-thread-composer-input="" {...stylex.props(styles.inputBox)}>
        <div {...stylex.props(expanded ? styles.inputColumnExpanded : styles.inputRowCollapsed)}>
          {expanded ? (
            <>
              {editor}
              <div {...stylex.props(styles.controlsExpanded)}>{controls}</div>
            </>
          ) : (
            <>
              <div {...stylex.props(styles.editorContainerCollapsed)}>{editor}</div>
              <div {...stylex.props(styles.controlsCollapsed)}>{controls}</div>
            </>
          )}
        </div>
      </div>
      {composerError !== null && (
        <div role="alert" {...stylex.props(styles.errorText)}>
          {composerError}
        </div>
      )}
      {menu.open && menu.anchor !== null ? (
        <React.Suspense fallback={null}>
          <LazyPromptMenu
            anchor={menu.anchor}
            items={menu.items}
            selectedIndex={menu.selectedIndex}
            placement="above"
            emptyLabel={menu.emptyLabel}
            footer={menu.footer}
            isLoading={menu.isLoading}
            listboxId={menu.listboxId}
            onSelect={menu.accept}
            onHighlight={menu.highlight}
            isKeyboardNavigation={menu.isKeyboardNavigation}
          />
        </React.Suspense>
      ) : null}
    </form>
  );
}
