import { Files, type HonkClient } from "@honk/core";
import type { Workspace } from "@honk/core/workspace";
import { Button, Icon, IconButton, Spinner, Text } from "@honk/ui";
import { IconArrowRotateClockwise } from "@honk/ui/icons";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { getHonkClient } from "./chat/client";
import { errorMessage } from "./error-message";

// The filesystem read is byte-accurate: core reads bytes and decodes, so a binary file is reported
// as binary rather than rendered as replacement characters. Saving overwrites the whole file —
// `files.write` is core's one write route — so the editor tracks the text it loaded and surfaces
// "Changed on disk" instead of silently clobbering a concurrent agent edit.

const FILE_VIEWER_RESOURCE_GRACE_MS = 30_000;
// Render cost scales with characters, not bytes on disk, so the cap is measured on what was decoded.
const FILE_VIEWER_MAX_CHARACTERS = 2_000_000;
const NOT_CONNECTED_MESSAGE = "Honk Core is not connected yet.";

type FileViewerState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly text: string }
  | { readonly phase: "empty" }
  | { readonly phase: "missing" }
  | { readonly phase: "binary"; readonly sizeBytes: number }
  | { readonly phase: "oversized"; readonly characters: number }
  | { readonly phase: "error"; readonly message: string };

type FileViewerResource = {
  readonly getSnapshot: () => FileViewerState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: () => void;
  readonly save: (contents: string) => Promise<void>;
  readonly observeThreadRunning: (isRunning: boolean) => void;
};

type FileViewerClient = {
  readonly files: Pick<HonkClient["files"], "read" | "write">;
};
type FileViewerClientResolver = () => FileViewerClient | null;

const LOADING_STATE: FileViewerState = Object.freeze({ phase: "loading" });
const fileViewerResources = new Map<string, FileViewerResource>();

function createFileViewerResource(
  workspaceId: Workspace.WorkspaceId,
  path: string,
  resolveClient: FileViewerClientResolver = getHonkClient,
): FileViewerResource {
  let snapshot = LOADING_STATE;
  let requested = false;
  let generation = 0;
  let lastThreadRunning: boolean | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: FileViewerState): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const refresh = (): void => {
    requested = true;
    // Any in-flight read belongs to the previous generation and must not land after this one.
    generation += 1;
    const currentGeneration = generation;
    const client = resolveClient();
    if (client === null) {
      publish({ phase: "error", message: NOT_CONNECTED_MESSAGE });
      return;
    }
    // A reread of an already-rendered file keeps it on screen instead of flashing the spinner; a
    // run that rewrote the file swaps the content in place.
    const preservesContent = snapshot.phase === "ready" || snapshot.phase === "empty";
    if (!preservesContent) publish(LOADING_STATE);
    void readFileState(client, workspaceId, path).then(
      (state) => {
        if (currentGeneration !== generation) return;
        publish(state);
      },
      (error: unknown) => {
        if (currentGeneration !== generation) return;
        // A failed background refresh must not evict a mounted editor and its unsaved draft.
        if (preservesContent) return;
        publish({ phase: "error", message: errorMessage(error) });
      },
    );
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      listeners.add(listener);
      if (!requested) refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          releaseTimer = setTimeout(() => {
            if (listeners.size === 0) fileViewerResources.delete(resourceKey(workspaceId, path));
          }, FILE_VIEWER_RESOURCE_GRACE_MS);
        }
      };
    },
    refresh,
    async save(contents) {
      const client = resolveClient();
      if (client === null) throw new Error(NOT_CONNECTED_MESSAGE);
      await client.files.write({ workspaceId, path, content: contents });
    },
    observeThreadRunning(isRunning) {
      // The agent may have rewritten this file during the run that just finished.
      if (lastThreadRunning === true && !isRunning) refresh();
      lastThreadRunning = isRunning;
    },
  };
}

async function readFileState(
  client: FileViewerClient,
  workspaceId: Workspace.WorkspaceId,
  path: string,
): Promise<FileViewerState> {
  let content: Awaited<ReturnType<FileViewerClient["files"]["read"]>>;
  try {
    content = await client.files.read({ workspaceId, path });
  } catch (error) {
    if (error instanceof Files.NotFoundError) return { phase: "missing" };
    throw error;
  }
  if (content.type === "binary") {
    return { phase: "binary", sizeBytes: content.size };
  }
  if (content.text.length > FILE_VIEWER_MAX_CHARACTERS) {
    return { phase: "oversized", characters: content.text.length };
  }
  return content.text.length > 0 ? { phase: "ready", text: content.text } : { phase: "empty" };
}

function resourceKey(workspaceId: Workspace.WorkspaceId, path: string): string {
  return `${workspaceId}\n${path}`;
}

function fileViewerResourceFor(
  workspaceId: Workspace.WorkspaceId,
  path: string,
): FileViewerResource {
  const key = resourceKey(workspaceId, path);
  const existing = fileViewerResources.get(key);
  if (existing !== undefined) return existing;
  const created = createFileViewerResource(workspaceId, path);
  fileViewerResources.set(key, created);
  return created;
}

// Fixed Cursor workbench geometry for the breadcrumb row below tabs.
const BREADCRUMB_ROW_HEIGHT = "32px";
// Fixed Cursor geometry for the breadcrumb control's internal line box.
const BREADCRUMB_TRAIL_HEIGHT = "22px";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    // Cursor's `breadcrumb.background` resolves to editorBackground (spec JS 882955), so the
    // breadcrumbs row and the code below it share one surface instead of stacking two chromes.
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  // Cursor gives breadcrumbs their own full-width row below the tab strip rather than sharing the
  // title row: `.breadcrumbs-below-tabs{height:32px;padding-bottom:6px;padding-top:6px}`.
  breadcrumbBar: {
    flexShrink: 0,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    height: BREADCRUMB_ROW_HEIGHT,
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor-exact `.breadcrumbs-below-tabs` block padding (spec CSS 279770); the smallest spacing token is the 8px gutter
    paddingBlock: "6px",
    paddingInlineStart: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor-exact `.breadcrumbs-extra-actions{padding-right:14px}` closing the row (spec CSS 280390); no 14px spacing token exists
    paddingInlineEnd: "14px",
    gap: spaceVars["--honk-space-gutter"],
    // The workbench base size the breadcrumb `.9em` scale is measured against (spec CSS 482373).
    fontSize: fontVars["--honk-font-size-body"],
  },
  // `.breadcrumbs-below-tabs .breadcrumbs-control{flex:1 100%;height:22px}` (spec CSS 443452), with
  // the widget itself pinned to 18px leading (spec CSS 1166788).
  breadcrumbTrail: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "100%",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
    height: BREADCRUMB_TRAIL_HEIGHT,
    lineHeight: fontVars["--honk-leading-body"],
    color: colorVars["--honk-color-text-muted"],
  },
  breadcrumbSegment: {
    minWidth: 0,
    // Cursor caps each breadcrumb item at 80% (spec CSS 444308), which keeps one long segment from
    // evicting the rest of the trail.
    maxWidth: "80%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor sizes breadcrumb labels at `.9em` of the 13px base (~11.7px, spec CSS 482373); the em-relative scale is what keeps them subordinate, and no 11.7px token exists
    fontSize: "0.9em",
  },
  // Honk has no tab strip naming the open file inside this panel and no hover/focus states on the
  // trail, so the file segment carries the emphasis Cursor spends on focus underlines.
  breadcrumbFile: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-primary"],
  },
  breadcrumbActions: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  // Cursor replaces the registered chevron codicon with a literal slash at 0.9em and 6px inline
  // padding (spec CSS 480343).
  breadcrumbSeparator: {
    flexShrink: 0,
    // oxlint-disable-next-line honk/design-no-raw-values -- 0.9em keeps the slash at Cursor's breadcrumb-relative type scale (spec CSS 480343); no font token owns an em-relative separator size
    fontSize: "0.9em",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor-exact separator padding from the same rule (spec CSS 480343); no 6px spacing token exists
    paddingInline: "6px",
  },
  center: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

const PierreFileView = React.lazy(async () => {
  const module = await import("./workbench-pierre-file-view");
  return { default: module.WorkbenchPierreFileView };
});

function WorkbenchFileViewer({
  path,
  workspaceId,
  isThreadRunning,
  isVisible,
}: {
  readonly path: string;
  readonly workspaceId: Workspace.WorkspaceId;
  readonly isThreadRunning: boolean;
  readonly isVisible: boolean;
}): React.ReactElement {
  const resource = fileViewerResourceFor(workspaceId, path);
  const state = React.useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  React.useEffect(() => {
    resource.observeThreadRunning(isThreadRunning);
  }, [isThreadRunning, resource]);
  // Inactive panels stay mounted under `display: none`. Latch on the first reveal so CodeView first
  // measures a laid-out box; once revealed the tab keeps its surface across later switches.
  const [wasVisible, setWasVisible] = React.useState(isVisible);
  if (isVisible && !wasVisible) setWasVisible(true);

  if (wasVisible && (state.phase === "ready" || state.phase === "empty")) {
    return (
      <EditableWorkbenchFile
        key={resourceKey(workspaceId, path)}
        path={path}
        sourceText={state.phase === "ready" ? state.text : ""}
        resource={resource}
      />
    );
  }

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.breadcrumbBar)}>
        <FileBreadcrumbs path={path} />
        <IconButton
          type="button"
          size="sm"
          variant="quiet"
          aria-label="Reload file"
          title="Reload file"
          onClick={resource.refresh}
        >
          <Icon icon={IconArrowRotateClockwise} size="sm" tone="muted" />
        </IconButton>
      </div>
      <FileViewerBody path={path} state={state} isMounted={wasVisible} onRetry={resource.refresh} />
    </div>
  );
}

type EditorSavePhase = "idle" | "saving" | "saved" | "error";

type EditorSession = {
  readonly baseText: string;
  readonly draftText: string;
  readonly observedText: string;
  readonly externalChange: boolean;
  readonly savePhase: EditorSavePhase;
  readonly saveError?: string;
};

function EditableWorkbenchFile({
  path,
  sourceText,
  resource,
}: {
  readonly path: string;
  readonly sourceText: string;
  readonly resource: FileViewerResource;
}): React.ReactElement {
  const [session, setSession] = React.useState<EditorSession>(() => ({
    baseText: sourceText,
    draftText: sourceText,
    observedText: sourceText,
    externalChange: false,
    savePhase: "idle",
  }));

  if (sourceText !== session.observedText) {
    setSession((current) => {
      if (sourceText === current.observedText) return current;
      if (current.draftText === current.baseText) {
        return {
          baseText: sourceText,
          draftText: sourceText,
          observedText: sourceText,
          externalChange: false,
          savePhase:
            current.savePhase === "saving"
              ? "saving"
              : sourceText === current.baseText
                ? current.savePhase
                : "idle",
        };
      }
      return {
        ...current,
        observedText: sourceText,
        externalChange: sourceText !== current.baseText,
      };
    });
  }

  const isDirty = session.draftText !== session.baseText;

  const save = async (): Promise<void> => {
    const current = session;
    if (current.savePhase === "saving" || current.draftText === current.baseText) return;
    const contents = current.draftText;
    setSession(({ saveError: _saveError, ...value }) => ({ ...value, savePhase: "saving" }));
    try {
      await resource.save(contents);
      setSession(({ saveError: _saveError, ...value }) => ({
        ...value,
        baseText: contents,
        externalChange: false,
        savePhase: value.draftText === contents ? "saved" : "idle",
      }));
      resource.refresh();
    } catch (error) {
      setSession((value) => ({
        ...value,
        savePhase: "error",
        saveError: errorMessage(error),
      }));
    }
  };

  const reload = (): void => {
    const current = session;
    if (
      current.draftText !== current.baseText &&
      typeof globalThis.confirm === "function" &&
      !globalThis.confirm("Discard unsaved changes and reload this file?")
    ) {
      return;
    }
    setSession({
      baseText: sourceText,
      draftText: sourceText,
      observedText: sourceText,
      externalChange: false,
      savePhase: "idle",
    });
    resource.refresh();
  };

  const status = editorStatus(session, isDirty);

  return (
    <div
      {...stylex.props(styles.root)}
      onKeyDownCapture={(event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void save();
        }
      }}
    >
      <div {...stylex.props(styles.breadcrumbBar)}>
        <FileBreadcrumbs path={path} />
        <div {...stylex.props(styles.breadcrumbActions)}>
          {status === null ? null : (
            <Text
              size="xs"
              tone={status.tone}
              aria-live="polite"
              aria-label={
                session.saveError === undefined
                  ? status.label
                  : `${status.label}: ${session.saveError}`
              }
              title={session.saveError}
            >
              {status.label}
            </Text>
          )}
          <Button
            type="button"
            size="sm"
            variant="quiet"
            disabled={!isDirty || session.savePhase === "saving"}
            title="Save file (⌘S or Ctrl+S)"
            onClick={() => {
              void save();
            }}
          >
            Save
          </Button>
          <IconButton
            type="button"
            size="sm"
            variant="quiet"
            aria-label={isDirty ? "Discard changes and reload file" : "Reload file"}
            title={isDirty ? "Discard changes and reload file" : "Reload file"}
            onClick={reload}
          >
            <Icon icon={IconArrowRotateClockwise} size="sm" tone="muted" />
          </IconButton>
        </div>
      </div>
      <React.Suspense fallback={<FileViewerLoading />}>
        <PierreFileView
          path={path}
          text={session.baseText}
          onChange={(text) => {
            setSession(({ saveError: _saveError, ...current }) => ({
              ...current,
              draftText: text,
              savePhase: "idle",
            }));
          }}
        />
      </React.Suspense>
    </div>
  );
}

function editorStatus(
  session: EditorSession,
  isDirty: boolean,
): { readonly label: string; readonly tone: "muted" | "ok" | "warn" | "err" } | null {
  if (session.savePhase === "saving") return { label: "Saving…", tone: "muted" };
  if (session.savePhase === "error") return { label: "Save failed", tone: "err" };
  if (session.externalChange) return { label: "Changed on disk", tone: "warn" };
  if (isDirty) return { label: "Unsaved", tone: "warn" };
  if (session.savePhase === "saved") return { label: "Saved", tone: "ok" };
  return null;
}

// The trail is static text: this panel has no explorer to navigate into, and Cursor's own picker
// contract does not exist here, so rendering segments as buttons would promise a target honk cannot
// open. The full path stays reachable through the row's title.
function FileBreadcrumbs({ path }: { readonly path: string }): React.ReactElement {
  const segments = path.split("/").filter((segment) => segment !== "");
  return (
    <div {...stylex.props(styles.breadcrumbTrail)} title={path}>
      {segments.map((segment, index) => (
        <React.Fragment key={segments.slice(0, index + 1).join("/")}>
          {index === 0 ? null : (
            <span aria-hidden {...stylex.props(styles.breadcrumbSeparator)}>
              /
            </span>
          )}
          <span
            {...stylex.props(
              styles.breadcrumbSegment,
              index === segments.length - 1 && styles.breadcrumbFile,
            )}
          >
            {segment}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function FileViewerBody({
  path,
  state,
  isMounted,
  onRetry,
}: {
  readonly path: string;
  readonly state: FileViewerState;
  readonly isMounted: boolean;
  readonly onRetry: () => void;
}): React.ReactElement {
  if (state.phase === "loading" || !isMounted) {
    return <FileViewerLoading />;
  }
  if (state.phase === "error") {
    return <FileViewerNotice title="Can't open file" detail={state.message} onRetry={onRetry} />;
  }
  // Never auto-close the tab: a file deleted on another branch should still be where the user left
  // it, saying so.
  if (state.phase === "missing") {
    return <FileViewerNotice title="File not found" detail={path} mono onRetry={onRetry} />;
  }
  // Retrying cannot change either verdict, so neither offers the control.
  if (state.phase === "binary") {
    return (
      <FileViewerNotice
        title="Binary file"
        detail={`${formatCount(state.sizeBytes)} bytes — Honk shows text files only.`}
      />
    );
  }
  if (state.phase === "oversized") {
    return (
      <FileViewerNotice
        title="File too large"
        detail={`${formatCount(state.characters)} characters — Honk shows files up to ${formatCount(
          FILE_VIEWER_MAX_CHARACTERS,
        )}.`}
      />
    );
  }

  // Ready and empty text files are handled by EditableWorkbenchFile above. This
  // branch only exists while the lazy editor waits for its first visible mount.
  return <FileViewerLoading />;
}

function FileViewerLoading(): React.ReactElement {
  return (
    <div {...stylex.props(styles.center)}>
      <Spinner label="Loading file" tone="muted" />
    </div>
  );
}

function FileViewerNotice({
  title,
  detail,
  mono = false,
  onRetry,
}: {
  readonly title: string;
  readonly detail: string;
  readonly mono?: boolean;
  readonly onRetry?: () => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.center)}>
      <Text as="p" size="sm" tone="muted" weight="regular">
        {title}
      </Text>
      <Text as="p" size="xs" tone="faint" family={mono ? "mono" : "ui"}>
        {detail}
      </Text>
      {onRetry === undefined ? null : (
        <Button size="sm" variant="quiet" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

export { createFileViewerResource, FILE_VIEWER_MAX_CHARACTERS, WorkbenchFileViewer };
export type { FileViewerState };
