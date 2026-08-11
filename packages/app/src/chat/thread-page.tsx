// The chat thread: one Honk Core session, rendered natively from Pi values.
// Deep-linkable and restart-safe — the core restores stored sessions lazily
// on the first command that names them. The thread column sits beside the
// workbench (Changes, Files, Terminal, Browser) for the session's workspace.

import { Spinner, Text } from "@honk/ui";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useParams } from "@tanstack/react-router";
import * as React from "react";

import { Session } from "@honk/core/session";

import { useConversationDensity } from "../app-settings-store";
import { Workbench } from "../workbench";
import { useWorkbench, workbenchActions } from "../workbench-controller";
import { useWorkbenchTabs, workbenchTabActions } from "../workbench-tab-store";
import { conversationItems, modelSelectionOfEntries, tickerOf } from "./chat-model";
import { markSessionTabVisited, useCoreSession } from "./chat-store";
import { describeError } from "./client";
import { type ActiveMessageEdit, type MessageEditTarget } from "./message-edit";
import type { ModelSelection } from "./selection";
import { useSessionWorkspace } from "./session-workspace";
import { ThreadComposer } from "./thread-composer";
import { ChatTranscript } from "./transcript";

const styles = stylex.create({
  frame: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    width: "100%",
    display: "flex",
    flexDirection: "row",
  },
  thread: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    minHeight: 0,
  },
  centered: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  banner: {
    alignSelf: "center",
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    fontSize: fontVars["--honk-font-size-detail"],
    color: colorVars["--honk-color-text-muted"],
  },
});

export function ChatThreadPage(): React.ReactElement {
  const params = useParams({ from: "/chat/$sessionId" });
  const sessionId = Session.SessionId.make(params.sessionId);

  return <ChatThread key={sessionId} sessionId={sessionId} />;
}

function ChatThread({ sessionId }: { readonly sessionId: Session.SessionId }): React.ReactElement {
  const { state, editMessage, runGitAction } = useCoreSession(sessionId);
  const workspace = useSessionWorkspace(sessionId);
  const density = useConversationDensity();
  const running = state.status === "running";
  const [edit, setEdit] = React.useState<ActiveMessageEdit | null>(null);
  const editRequestRef = React.useRef(0);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const activeEdit = edit?.sessionId === sessionId ? edit : null;

  React.useEffect(() => {
    markSessionTabVisited(sessionId);
  }, [sessionId]);

  const beginMessageEdit = (target: MessageEditTarget): void => {
    const targetIndex = state.entries.findIndex((entry) => entry.id === target.entryId);
    const inheritedEntries = targetIndex < 0 ? state.entries : state.entries.slice(0, targetIndex);
    setActionError(null);
    setEdit({
      phase: "editing",
      sessionId,
      entryId: target.entryId,
      message: target.message,
      error: null,
      selection: modelSelectionOfEntries(inheritedEntries),
      selectionChanged: false,
    });
  };

  const changeMessageEditSelection = (selection: ModelSelection): void => {
    setEdit((current) =>
      current?.phase === "editing" && current.sessionId === sessionId
        ? { ...current, selection, selectionChanged: true, error: null }
        : current,
    );
  };

  const changeMessageEdit = (message: MessageEditTarget["message"]): void => {
    setEdit((current) =>
      current?.phase === "editing" && current.sessionId === sessionId
        ? { ...current, message, error: null }
        : current,
    );
  };

  const cancelMessageEdit = (): void => {
    setEdit((current) =>
      current?.phase === "editing" && current.sessionId === sessionId ? null : current,
    );
  };

  const submitMessageEdit = (message: MessageEditTarget["message"]): void => {
    const current = activeEdit;
    if (current?.phase !== "editing" || state.status !== "ready") return;
    const requestId = editRequestRef.current + 1;
    editRequestRef.current = requestId;
    setActionError(null);
    setEdit({
      phase: "submitting",
      sessionId,
      entryId: current.entryId,
      message,
      requestId,
      selection: current.selection,
      selectionChanged: current.selectionChanged,
    });
    const selectedRun =
      current.selectionChanged && current.selection.kind === "model"
        ? {
            ...(current.selection.model === null ? {} : { model: current.selection.model }),
            thinkingLevel: current.selection.thinkingLevel ?? "off",
          }
        : undefined;
    void editMessage(current.entryId, message, selectedRun).then(
      () => {
        if (editRequestRef.current !== requestId) return;
        setEdit((latest) =>
          latest?.phase === "submitting" && latest.requestId === requestId ? null : latest,
        );
      },
      (error: unknown) => {
        if (editRequestRef.current !== requestId) return;
        const description = describeError(error);
        if (!(error instanceof Session.EditMessageCommittedError)) {
          setEdit((latest) =>
            latest?.phase === "submitting" && latest.requestId === requestId
              ? {
                  phase: "editing",
                  sessionId,
                  entryId: current.entryId,
                  message,
                  error: description,
                  selection: current.selection,
                  selectionChanged: current.selectionChanged,
                }
              : latest,
          );
        } else {
          setEdit((latest) =>
            latest?.phase === "submitting" && latest.requestId === requestId ? null : latest,
          );
          if (error.stage === "settlement") {
            setActionError(`${error.message} ${error.reason}`);
          }
        }
      },
    );
  };

  // A change receipt is a link into the workbench beside it: reviewing opens
  // Changes, a file row opens that file. Both are inert until the workspace
  // read answers, because a tab set is keyed by workspace.
  const workspaceKey = workspace.status === "ready" ? workspace.workspace.workspaceId : null;
  const reviewChanges =
    workspaceKey === null
      ? null
      : () => {
          workbenchTabActions.openTool(workspaceKey, "changes", sessionId);
          workbenchActions.rememberTab("changes");
        };
  const openFile =
    workspaceKey === null
      ? null
      : (path: string) => {
          workbenchTabActions.openFile(workspaceKey, path);
        };

  // The workbench needs the session's workspace identity; until the one read
  // answers, the thread stands alone rather than blocking on it.
  const workbench =
    workspace.status === "ready" ? (
      <Workbench
        key={workspace.workspace.workspaceId}
        sessionRef={{ sessionId, workspaceId: workspace.workspace.workspaceId }}
        directory={workspace.workspace.directory}
        isThreadRunning={running}
      />
    ) : null;
  // The shell can be expanded before a tool is chosen, so this gate intentionally does not depend
  // on a live active tab.
  const isPanelOpen = useWorkbenchTabs(
    workspace.status === "ready" ? workspace.workspace.workspaceId : "",
  ).expanded;
  const isMaximized = useWorkbench((current) => current.isMaximized) && isPanelOpen;

  if (state.sessionId === null || state.status === "connecting") {
    return (
      <div {...stylex.props(styles.centered)}>
        {state.status === "failed" ? (
          <>
            <Text size="lg" weight="semibold">
              Chat unavailable
            </Text>
            <Text size="sm" tone="muted">
              {state.error ?? "Honk Core could not open this session."}
            </Text>
          </>
        ) : (
          <Spinner label="Opening chat" tone="muted" />
        )}
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.frame)}>
      {/* Unmounting beats squeezing to zero: the transcript retains its scroll offset and
          measurement cache on unmount, and a zero-width column would re-wrap every row. */}
      {isMaximized ? null : (
        <div data-thread-panel="" {...stylex.props(styles.thread)}>
          <ChatTranscript
            items={conversationItems(state.entries, state.streamingMessage, state.turns)}
            running={running}
            ticker={tickerOf(state)}
            density={density}
            sessionId={sessionId}
            restorationKey={sessionId}
            onGitAction={(action) => {
              setActionError(null);
              void runGitAction(action).catch((error: unknown) => {
                setActionError(describeError(error));
              });
            }}
            messageEditing={
              activeEdit !== null || state.status === "ready"
                ? {
                    kind: "enabled",
                    active: activeEdit,
                    available: state.status === "ready" || state.status === "running",
                    onBegin: beginMessageEdit,
                    onChange: changeMessageEdit,
                    onSelectionChange: changeMessageEditSelection,
                    onCancel: cancelMessageEdit,
                    onSubmit: submitMessageEdit,
                  }
                : { kind: "disabled" }
            }
            onReviewChanges={reviewChanges}
            onOpenFile={openFile}
          />
          {state.status === "failed" && (
            <div {...stylex.props(styles.banner)}>{state.error ?? "Honk Core failed."}</div>
          )}
          {state.status === "disconnected" && (
            <div {...stylex.props(styles.banner)}>
              Honk Core disconnected. Your transcript remains available.
            </div>
          )}
          {actionError !== null && (
            <div role="alert" {...stylex.props(styles.banner)}>
              {actionError}
            </div>
          )}
          <ThreadComposer
            key={sessionId}
            sessionId={sessionId}
            messageEdit={
              activeEdit?.phase === "editing"
                ? { kind: "editing", onReplyFocus: cancelMessageEdit }
                : activeEdit?.phase === "submitting"
                  ? { kind: "submitting", requestId: activeEdit.requestId }
                  : { kind: "none" }
            }
          />
        </div>
      )}
      {workbench}
    </div>
  );
}
