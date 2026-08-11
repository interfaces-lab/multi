// The start composer: the card Home and /chat type into. Enter opens the
// workspace, creates the session, fires the prompt, and hands the running
// turn to the thread route. The draft lives in composer-store, so the text
// rides through route changes. The thread surface's composer is its own
// module (`thread-composer.tsx`) so this eager card never drags the thread
// column's modules into the start graph.
//
// Start-flow logic rides start-model's reducer so the trust refusal is
// decided in one tested place rather than forked per surface: reaching
// `ready` *is* the start — the create effect fires from it and leaves.

import { Button, Icon, IconButton, Tooltip } from "@honk/ui";
import { IconFolder1, IconPlusSmall } from "@honk/ui/icons";
import {
  colorVars,
  composerVars,
  fontVars,
  radiusVars,
  spaceVars,
  workbenchSurfaceVars,
} from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import { basename } from "@honk/shared/paths";
import * as React from "react";

import type { Workspace } from "@honk/core/workspace";

import { useDefaultProjectDirectory } from "../app-settings-store";
import { canPickFolder, pickFolder } from "../desktop-bridge";
import { ComposerSubmitButton } from "../composer/submit-button";
import { createCoreSession, sendInitialPrompt } from "./chat-controller";
import {
  draftKeyOf,
  EMPTY_MESSAGE,
  promptPhaseOf,
  startSubmitOf,
  useDraft,
  writeDraft,
  type ComposerMessage,
} from "./composer-store";
import { describeError, getHonkClient } from "./client";
import { useFocusOnType, type FocusOnTypeEditor } from "./focus-on-type";
import { refreshCatalog, useCatalogPhase } from "./model-catalog";
import { CoreModelSelector } from "./model-menu";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor";
import { loadPromptMenu } from "./prompt-menu-resource";
import { usePromptMenu } from "./use-prompt-menu";
import type { ModelSelection } from "./selection";
import {
  readModelSelection,
  readRecent,
  reconcileModelSelection,
  rememberRecent,
  rememberSelection,
  resolveStartDirectory,
} from "./selection";
import type { StartEvent } from "./start-model";
import { initialState, reduce } from "./start-model";
import { TrustDialog } from "./trust-dialog";

const LazyPromptMenu = React.lazy(() =>
  loadPromptMenu().then((module) => ({ default: module.PromptMenu })),
);

const COMPOSER_RING = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border"]}`;
const COMPOSER_RING_ACTIVE = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border-active"]}`;

const styles = stylex.create({
  startRoot: { display: "flex", flexDirection: "column", width: "100%" },
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    borderRadius: radiusVars["--honk-radius-panel"],
    boxShadow: {
      default: COMPOSER_RING,
      ":hover": { "@media (hover: hover)": COMPOSER_RING_ACTIVE },
      ":focus-within": COMPOSER_RING_ACTIVE,
    },
  },
  input: {
    boxSizing: "border-box",
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px matches the production composer's fixed inline geometry
    paddingInline: "16px",
    paddingTop: spaceVars["--honk-space-panel-pad"],
    borderWidth: 0,
    backgroundColor: "transparent",
    outline: "none",
    color: "inherit",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    resize: "none",
  },
  footer: {
    height: composerVars["--honk-composer-state-band-height"],
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px matches the production composer's fixed inline geometry
    paddingInline: "16px",
  },
  footerSpacer: { flexGrow: 1 },
  workspaceLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  errorText: {
    paddingTop: spaceVars["--honk-space-gutter"],
    fontSize: fontVars["--honk-font-size-detail"],
    color: colorVars["--honk-color-err-fg"],
  },
});

function ComposerCard({
  draft,
  onDraftChange,
  placeholder,
  readOnly = false,
  autoFocus = false,
  onSubmit,
  footer,
  workspaceId,
  editorRef,
  onImageReadPendingChange,
}: {
  readonly draft: ComposerMessage;
  readonly onDraftChange: (message: ComposerMessage) => void;
  readonly placeholder: string;
  readonly readOnly?: boolean;
  readonly autoFocus?: boolean;
  readonly onSubmit: () => void;
  readonly footer: React.ReactNode;
  /**
   * The trusted workspace the menus search, once the picked folder resolves
   * to one. Null until then, which closes the menus rather than searching a
   * directory nobody has agreed to open.
   */
  readonly workspaceId: Workspace.WorkspaceId | null;
  /** The form owns the submit, so it owns the handle it reads the message from. */
  readonly editorRef: React.RefObject<ComposerEditorHandle | null>;
  readonly onImageReadPendingChange: (pending: boolean) => void;
}): React.ReactElement {
  const [caret, setCaret] = React.useState(0);
  // Read once: the editor owns the text from here on, and re-seeding it on
  // every store write would fight the caret.
  const [initialText] = React.useState(draft);
  // Focus-on-type, window scope: typing anywhere with no field focused lands
  // in this card. A locked (submitting) card takes focus but no text.
  const focusEditorRef = React.useRef<FocusOnTypeEditor | null>(null);
  React.useEffect(() => {
    focusEditorRef.current = {
      focus: () => editorRef.current?.focus(),
      insertText: (text) => {
        editorRef.current?.focus();
        if (readOnly) return;
        editorRef.current?.appendText(text);
      },
    };
    return () => {
      focusEditorRef.current = null;
    };
  }, [editorRef, readOnly]);
  useFocusOnType(focusEditorRef);

  // The same driver the thread composer mounts, over the same editor.
  const menu = usePromptMenu({ draft: draft.text, caret, workspaceId, editor: editorRef });

  return (
    <div {...stylex.props(styles.card)}>
      <ComposerEditor
        handleRef={editorRef}
        initialText={initialText.text}
        initialImages={initialText.images}
        placeholder={placeholder}
        ariaLabel="Message"
        autoFocus={autoFocus}
        readOnly={readOnly}
        editorStyle={styles.input}
        onChange={(message, offset) => {
          onDraftChange(message);
          setCaret(offset);
          menu.noteEdit();
        }}
        onImageReadPendingChange={onImageReadPendingChange}
        onSubmit={onSubmit}
        menu={{
          open: menu.open,
          listboxId: menu.listboxId,
          activeOptionId: menu.open
            ? `${menu.listboxId}-option-${String(menu.selectedIndex)}`
            : null,
          accept: menu.acceptHighlighted,
          dismiss: menu.dismiss,
          move: menu.moveSelection,
        }}
      />
      <div {...stylex.props(styles.footer)}>{footer}</div>
      {menu.open && menu.anchor !== null ? (
        <React.Suspense fallback={null}>
          <LazyPromptMenu
            anchor={menu.anchor}
            items={menu.items}
            selectedIndex={menu.selectedIndex}
            // The start card sits mid-screen with room under it, unlike the
            // thread reply pinned to the bottom edge.
            placement="below"
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
    </div>
  );
}

/**
 * The workspace a picked folder already resolves to, or null.
 *
 * `workspace.open` checks stored trust before it reads anything the workspace
 * controls (spec/core.md section 5), so asking here is safe: a trusted folder
 * answers with its id and the menus light up, an untrusted one answers
 * `trust_required` and they stay closed until the first send walks the trust
 * flow. Nothing is prompted and nothing is opened on the user's behalf.
 */
function useStartWorkspace(directory: string | null): Workspace.WorkspaceId | null {
  const [resolved, setResolved] = React.useState<{
    readonly directory: string;
    readonly workspaceId: Workspace.WorkspaceId;
  } | null>(null);
  React.useEffect(() => {
    if (directory === null) return;
    const client = getHonkClient();
    if (client === null) return;
    let stale = false;
    client.workspace.open({ directory }).then(
      (result) => {
        if (!stale && result.type === "ready") {
          setResolved({ directory, workspaceId: result.id });
        }
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [directory]);
  return resolved?.directory === directory ? resolved.workspaceId : null;
}

interface StartComposerProps {
  readonly directory?: string | null;
  readonly onDirectoryChange?: (directory: string) => void;
}

function StartComposer(props: StartComposerProps): React.ReactElement {
  const navigate = useNavigate();
  const [state, dispatch] = React.useReducer(reduce, initialState);
  const [draft, setDraft] = useDraft(draftKeyOf(null));
  const defaultDirectory = useDefaultProjectDirectory();
  const [localDirectory, setLocalDirectory] = React.useState<string | null>(() =>
    resolveStartDirectory(defaultDirectory, readRecent()),
  );
  const directory = props.directory === undefined ? localDirectory : props.directory;
  const [imageReadPending, setImageReadPending] = React.useState(false);
  const startWorkspaceId = useStartWorkspace(directory);
  const editorRef = React.useRef<ComposerEditorHandle | null>(null);
  const [selection, setSelection] = React.useState<ModelSelection>(readModelSelection);
  const catalog = useCatalogPhase();
  const canStart =
    catalog.status === "ready" &&
    catalog.providers.some((provider) => provider.configured && provider.models.length > 0);
  // What the in-flight start carries. Refs, not state: the create effect must
  // not re-run because the draft or the selection changed under it.
  const pendingMessage = React.useRef<ComposerMessage>(EMPTY_MESSAGE);
  const pendingSelection = React.useRef<ModelSelection>(selection);

  // A remembered provider route can stop being runnable after logout.
  // Reconcile once the catalog arrives so what the picker
  // shows, what local storage remembers, and what create sends stay aligned.
  React.useEffect(() => {
    if (catalog.status !== "ready") return;
    setSelection((current) => {
      const next = reconcileModelSelection(current, catalog.providers);
      if (next === current) return current;
      rememberSelection(next);
      return next;
    });
  }, [catalog]);

  const openingDirectory = state.step === "opening" ? state.directory : null;
  const readyWorkspaceId = state.step === "ready" ? state.workspaceId : null;
  const phase = promptPhaseOf(draft, state.step !== "pick");

  // Entering the opening step is the only trigger for the open call, whether it
  // came from a submit or a completed trust. One cause, one effect.
  React.useEffect(() => {
    if (openingDirectory === null) return;
    const sdk = getHonkClient();
    if (sdk === null) {
      dispatch({ type: "request_failed", message: "Honk Core is not connected yet." });
      return;
    }
    let stale = false;
    const emit = (event: StartEvent) => {
      if (!stale) dispatch(event);
    };
    sdk.workspace.open({ directory: openingDirectory }).then(
      (result) => {
        emit({ type: "open_result", result });
      },
      (error: unknown) => {
        emit({ type: "request_failed", message: describeError(error) });
      },
    );
    return () => {
      stale = true;
    };
  }, [openingDirectory]);

  // A ready workspace completes the submit: create the session, fire the prompt
  // without waiting for it to settle, and leave. The thread page's watch is what
  // renders the running turn.
  React.useEffect(() => {
    if (readyWorkspaceId === null) return;
    const message = pendingMessage.current;
    const chosen = pendingSelection.current;
    let stale = false;
    createCoreSession({
      workspaceId: readyWorkspaceId,
      selection: chosen,
    }).then(
      (sessionId) => {
        if (stale) return;
        // Success is the only clear. A failed create returns to "pick" with
        // the text intact and editable again.
        writeDraft(draftKeyOf(null), EMPTY_MESSAGE);
        editorRef.current?.clear();
        // The first prompt rides the thread path: a rejected send lands the
        // text in the thread's draft instead of stranding an empty session.
        sendInitialPrompt(sessionId, message);
        void navigate({ to: "/chat/$sessionId", params: { sessionId } });
      },
      (error: unknown) => {
        if (!stale) dispatch({ type: "request_failed", message: describeError(error) });
      },
    );
    return () => {
      stale = true;
    };
  }, [readyWorkspaceId, navigate]);

  const submit = () => {
    if (imageReadPending || !canStart || catalog.status !== "ready") return;
    const decision = startSubmitOf(draft, state.step !== "pick", directory);
    if (decision === "ignore") return;
    if (decision === "choose-folder") {
      // Nothing to open and nothing to guess from: /chat owns choosing a folder.
      void navigate({ to: "/chat" });
      return;
    }
    const chosen = reconcileModelSelection(selection, catalog.providers);
    if (chosen !== selection) {
      setSelection(chosen);
      rememberSelection(chosen);
    }
    pendingSelection.current = chosen;
    pendingMessage.current = decision.message;
    dispatch({ type: "directory_chosen", directory: decision.directory });
  };

  const chooseDirectory = () => {
    void pickFolder(directory ?? defaultDirectory).then((picked) => {
      if (picked === null) return;
      rememberRecent(picked);
      if (props.onDirectoryChange === undefined) setLocalDirectory(picked);
      else props.onDirectoryChange(picked);
    });
  };

  const setModelSelection = (next: ModelSelection) => {
    setSelection(next);
    rememberSelection(next);
  };

  const acceptTrust = () => {
    if (state.step !== "trust") return;
    const pending = state.directory;
    const sdk = getHonkClient();
    if (sdk === null) return;
    dispatch({ type: "trust_accepted" });
    sdk.workspace.trust({ directory: pending }).then(
      () => {
        dispatch({ type: "trust_confirmed" });
      },
      (error: unknown) => {
        dispatch({ type: "request_failed", message: describeError(error) });
      },
    );
  };

  return (
    <form
      {...stylex.props(styles.startRoot)}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <ComposerCard
        draft={draft}
        onDraftChange={setDraft}
        workspaceId={startWorkspaceId}
        editorRef={editorRef}
        onImageReadPendingChange={setImageReadPending}
        placeholder="What can I help you build?"
        // The in-flight start locks the editor with the text visible; focus
        // stays put, and nothing clears until the session exists.
        readOnly={phase === "submitting"}
        onSubmit={submit}
        footer={
          <>
            <Tooltip label="Add images">
              <IconButton
                aria-label="Add images"
                size="sm"
                disabled={phase === "submitting" || imageReadPending}
                onClick={() => {
                  editorRef.current?.chooseImages();
                }}
              >
                <Icon icon={IconPlusSmall} size="sm" tone="faint" />
              </IconButton>
            </Tooltip>
            <Button
              variant="quiet"
              size="sm"
              iconStart={<Icon icon={IconFolder1} size="sm" tone="faint" />}
              aria-label={
                directory === null ? "Choose a folder" : `Workspace: ${basename(directory)}`
              }
              disabled={!canPickFolder()}
              onClick={chooseDirectory}
            >
              <span {...stylex.props(styles.workspaceLabel)}>
                {directory === null ? "Choose a folder" : basename(directory)}
              </span>
            </Button>
            <CoreModelSelector
              mode="create"
              selection={selection}
              onSelectionChange={setModelSelection}
              // The create carries the selection captured at submit; locking
              // the picker keeps what is shown and what is sent the same.
              disabled={phase === "submitting" || catalog.status !== "ready"}
            />
            <div {...stylex.props(styles.footerSpacer)} />
            <ComposerSubmitButton
              type="submit"
              disabled={phase !== "draft" || !canStart || imageReadPending}
            />
          </>
        }
      />

      {state.step === "pick" && state.error !== null && (
        <div {...stylex.props(styles.errorText)}>{state.error}</div>
      )}

      {catalog.status === "failed" && (
        <div {...stylex.props(styles.errorText)}>
          {catalog.message}
          <Button type="button" size="sm" variant="quiet" onClick={() => void refreshCatalog()}>
            Retry models
          </Button>
        </div>
      )}

      {state.step === "trust" && (
        // Core refused the untrusted directory (spec/core.md trust invariant).
        // Declining leaves the typed text where it is.
        <TrustDialog
          directory={state.directory}
          onTrust={acceptTrust}
          onDecline={() => {
            dispatch({ type: "trust_declined" });
          }}
        />
      )}
    </form>
  );
}

/** The start surface's composer; the thread surface renders `ThreadComposer`. */
export function ChatComposer(props: StartComposerProps): React.ReactElement {
  return <StartComposer {...props} />;
}
