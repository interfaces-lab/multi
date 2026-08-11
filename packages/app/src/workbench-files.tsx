import * as stylex from "@stylexjs/stylex";
import type { Files, Git, HonkClient } from "@honk/core";
import type { Workspace } from "@honk/core/workspace";
import { Button, FileTypeIcon, Icon, IconButton, Spinner, Text } from "@honk/ui";
import {
  IconArrowRotateClockwise,
  IconChevronDownMedium,
  IconChevronRightMedium,
  IconFolder1,
  IconFolderOpen,
} from "@honk/ui/icons";
import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  iconVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import { basename, normalizePathSeparators } from "@honk/shared/paths";
import * as React from "react";

import { getHonkClient } from "./chat/client";
import { errorMessage } from "./error-message";
import { WorkbenchFileViewer } from "./workbench-file-viewer";

// Honk Core exposes `files.list` (direct children of one directory) and `files.find` (a capped
// substring search). There is no recursive listing route, so the explorer fetches one directory per
// expansion and caches it. Directory rows expand; file rows select a viewer in the adjacent editor
// region.
//
// `files.list` is a raw readdir: no gitignore filtering, no hidden filtering, no ignored flag.
// `.git` and `node_modules` come back like anything else and stay as single collapsed rows; Honk
// has no ignore data and will not invent an exclusion list.

const FILES_RESOURCE_GRACE_MS = 30_000;
const ROOT_PATH = "";
const NOT_CONNECTED_MESSAGE = "Honk Core is not connected yet.";
// Cursor's explorer stays scannable at the workbench minimum without overtaking file content.
const EXPLORER_MIN_WIDTH = "160px";
const EXPLORER_MAX_WIDTH = "240px";

type FilesEntry = {
  readonly path: string;
  readonly name: string;
  readonly type: "file" | "directory";
};

type FilesDirState =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly entries: readonly FilesEntry[] };

type FilesSnapshot = {
  readonly dirs: ReadonlyMap<string, FilesDirState>;
  readonly expanded: ReadonlySet<string>;
  // Git decorations Honk's data can express. `git.status` folds untracked into "added" and drops
  // the raw porcelain code, so there is no U/R/C/ignored distinction to render.
  readonly decorations: ReadonlyMap<string, Git.ChangeStatus>;
  readonly changedDescendants: ReadonlyMap<string, number>;
};

type FilesResource = {
  readonly getSnapshot: () => FilesSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly load: (path: string) => void;
  readonly toggle: (path: string) => void;
  readonly refresh: () => void;
  readonly observeThreadRunning: (isRunning: boolean) => void;
};

type FilesClient = {
  readonly files: Pick<HonkClient["files"], "list">;
  readonly git: Pick<HonkClient["git"], "status">;
};
type FilesClientResolver = () => FilesClient | null;

const filesResources = new Map<string, FilesResource>();
const INITIAL_FILES_SNAPSHOT: FilesSnapshot = Object.freeze({
  dirs: new Map<string, FilesDirState>(),
  expanded: new Set<string>(),
  decorations: new Map<string, Git.ChangeStatus>(),
  changedDescendants: new Map<string, number>(),
});

function createFilesResource(
  workspaceId: Workspace.WorkspaceId,
  resolveClient: FilesClientResolver = getHonkClient,
): FilesResource {
  let snapshot = INITIAL_FILES_SNAPSHOT;
  let requested = false;
  let generation = 0;
  let lastThreadRunning: boolean | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const inFlight = new Set<string>();

  const publish = (next: FilesSnapshot): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const publishDir = (path: string, state: FilesDirState): void => {
    publish({ ...snapshot, dirs: new Map(snapshot.dirs).set(path, Object.freeze(state)) });
  };

  const load = (path: string): void => {
    if (inFlight.has(path)) return;
    const client = resolveClient();
    if (client === null) {
      publishDir(path, { phase: "error", message: NOT_CONNECTED_MESSAGE });
      return;
    }
    inFlight.add(path);
    const currentGeneration = generation;
    // A refresh of an already-listed directory keeps its rows on screen instead of blanking them.
    if (snapshot.dirs.get(path)?.phase !== "ready") publishDir(path, { phase: "loading" });
    void client.files
      .list({ workspaceId, ...(path === ROOT_PATH ? {} : { path }) })
      .then((result) => {
        if (currentGeneration !== generation) return;
        publishDir(path, { phase: "ready", entries: Object.freeze(result.flatMap(toEntry)) });
      })
      .catch((error: unknown) => {
        if (currentGeneration !== generation) return;
        publishDir(path, { phase: "error", message: errorMessage(error) });
      })
      .finally(() => {
        // A refresh already cleared the set and re-armed this path, so a stale settlement must not
        // release the fresh request's slot.
        if (currentGeneration !== generation) return;
        inFlight.delete(path);
      });
  };

  // Decorations are additive: a repository-less directory or a failing `git.status` leaves the tree
  // uncoloured rather than blocking or erroring the listing it annotates.
  const loadDecorations = (): void => {
    const client = resolveClient();
    if (client === null) return;
    const currentGeneration = generation;
    void client.git
      .status({ workspaceId })
      .then(({ files }) => {
        if (currentGeneration !== generation) return;
        publish({ ...snapshot, ...buildDecorations(files) });
      })
      .catch(() => {});
  };

  const refresh = (): void => {
    requested = true;
    // Discard every in-flight listing so a stale directory response cannot land after the refresh.
    generation += 1;
    inFlight.clear();
    loadDecorations();
    load(ROOT_PATH);
    for (const path of [...snapshot.expanded]) load(path);
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
            if (listeners.size === 0) filesResources.delete(workspaceId);
          }, FILES_RESOURCE_GRACE_MS);
        }
      };
    },
    load,
    toggle(path) {
      const expanded = new Set(snapshot.expanded);
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      publish({ ...snapshot, expanded });
      // Collapsing keeps the cached listing so re-opening is instant; a failed directory retries.
      if (expanded.has(path) && snapshot.dirs.get(path)?.phase !== "ready") load(path);
    },
    refresh,
    observeThreadRunning(isRunning) {
      if (lastThreadRunning === true && !isRunning) refresh();
      lastThreadRunning = isRunning;
    },
  };
}

function filesResourceFor(workspaceId: Workspace.WorkspaceId): FilesResource {
  const existing = filesResources.get(workspaceId);
  if (existing !== undefined) return existing;
  const created = createFilesResource(workspaceId);
  filesResources.set(workspaceId, created);
  return created;
}

// `files.list` answers workspace-relative paths. Normalize separators before they reach render or
// the decoration lookup, and drop anything that normalizes away. A symlink renders as a file row:
// reads resolve it below the workspace root or refuse, so the viewer stays the honest probe.
function toEntry(raw: Files.Entry): readonly FilesEntry[] {
  const path = normalizePathSeparators(raw.path).replace(/\/+$/, "");
  if (path.length === 0) return [];
  return [{ path, name: basename(path), type: raw.kind === "directory" ? "directory" : "file" }];
}

// `git.status` returns the whole changed set in one call, so a directory's rollup is a prefix count
// rather than another listing. Paths are workspace-relative — the same shape `files.list` answers,
// so the two maps join without translation.
function buildDecorations(files: readonly Git.FileChange[]): {
  readonly decorations: ReadonlyMap<string, Git.ChangeStatus>;
  readonly changedDescendants: ReadonlyMap<string, number>;
} {
  const decorations = new Map<string, Git.ChangeStatus>();
  const changedDescendants = new Map<string, number>();
  for (const file of files) {
    const path = normalizePathSeparators(file.file);
    decorations.set(path, file.status);
    path
      .split("/")
      .slice(0, -1)
      .reduce((prefix, segment) => {
        const dir = prefix === ROOT_PATH ? segment : `${prefix}/${segment}`;
        changedDescendants.set(dir, (changedDescendants.get(dir) ?? 0) + 1);
        return dir;
      }, ROOT_PATH);
  }
  return { decorations, changedDescendants };
}

function fileStatusGlyph(status: Git.ChangeStatus): "A" | "D" | "M" {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "row",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
  },
  explorer: {
    flexShrink: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    width: "38%",
    minWidth: EXPLORER_MIN_WIDTH,
    maxWidth: EXPLORER_MAX_WIDTH,
    borderInlineEndWidth: borderVars["--honk-border-hairline"],
    borderInlineEndStyle: "solid",
    borderInlineEndColor: colorVars["--honk-color-border-muted"],
  },
  toolbar: {
    flexShrink: 0,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    height: controlVars["--honk-control-h-lg"],
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  toolbarName: {
    minWidth: 0,
    flexGrow: 1,
  },
  tree: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    paddingInline: spaceVars["--honk-space-gutter"],
    paddingBlockEnd: spaceVars["--honk-space-gutter"],
    fontFamily: fontVars["--honk-font-family-ui"],
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
  editor: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  editorEmptyHeader: {
    flexShrink: 0,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    height: controlVars["--honk-control-h-lg"],
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  row: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor --cursor-spacing-1 (4px) between row glyphs; --honk-control-gap is 6px
    gap: "4px",
    width: "100%",
    minWidth: 0,
    minHeight: controlVars["--honk-control-h-sm"],
    paddingInlineEnd: spaceVars["--honk-space-gutter"],
    paddingBlock: 0,
    textAlign: "start",
  },
  // Both row kinds are controls and share one treatment: a directory expands, a file opens its
  // viewer tab. Nothing here mutates the working tree.
  rowControl: {
    appearance: "none",
    borderStyle: "none",
    // Glass overrides --cursor-radius-base to 8px for these rows, not the 6px control radius.
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
      ":active": colorVars["--honk-color-state-press"],
    },
    userSelect: "none",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
  },
  rowSelected: {
    backgroundColor: {
      default: colorVars["--honk-color-control-selected"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-control-selected"] },
    },
  },
  indent: (depth: number) => ({
    paddingInlineStart: `calc(${spaceVars["--honk-space-gutter"]} + ${depth} * ${spaceVars["--honk-space-gutter"]})`,
  }),
  disclosure: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    minWidth: iconVars["--honk-icon-size-sm"],
    color: colorVars["--honk-color-text-faint"],
  },
  glyphSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    minWidth: iconVars["--honk-icon-size-sm"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: 1,
  },
  name: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  dirName: {
    color: colorVars["--honk-color-text-muted"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  // A directory has no single Git status, so the rollup is a count rather than a colored letter:
  // coloring a folder would over-claim, and the number says more for the same pixels.
  changedCount: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontVariantNumeric: "tabular-nums",
  },
  // Filename + trailing status glyph share one status color, drawn from Cursor's gitDecoration
  // ramp rather than the diff-count ramp: --honk-color-diff-addition's dark stop (#3FA266) is the
  // +N count green and reads too saturated on a filename.
  statusAdded: {
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass gitDecoration.addedResourceForeground; no honk token carries this pair
    color: "light-dark(#007041, #70B489)",
  },
  statusModified: {
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor Glass gitDecoration.modifiedResourceForeground; --honk-color-warn-fg's light stop (#8B5700) is a different amber
    color: "light-dark(#A46700, #F1B467)",
  },
  statusDeleted: {
    color: colorVars["--honk-color-diff-deletion"],
  },
  deletedName: {
    textDecorationLine: "line-through",
  },
  noteText: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function statusColorStyle(status: Git.ChangeStatus) {
  if (status === "added") return styles.statusAdded;
  if (status === "deleted") return styles.statusDeleted;
  return styles.statusModified;
}

type FilesRow =
  | {
      readonly kind: "entry";
      readonly key: string;
      readonly depth: number;
      readonly entry: FilesEntry;
    }
  | {
      readonly kind: "note";
      readonly key: string;
      readonly depth: number;
      readonly text: string;
      readonly retryPath: string | null;
    };

// Flatten the visible tree in one pass so render stays a plain list; a loading directory contributes
// no rows because its own row already carries the spinner.
function buildRows(dirPath: string, depth: number, snapshot: FilesSnapshot): readonly FilesRow[] {
  const state = snapshot.dirs.get(dirPath);
  if (state === undefined || state.phase === "loading") return [];
  if (state.phase === "error") {
    return [{ kind: "note", key: `!${dirPath}`, depth, text: state.message, retryPath: dirPath }];
  }
  if (state.entries.length === 0) {
    return [{ kind: "note", key: `0${dirPath}`, depth, text: "Empty folder", retryPath: null }];
  }
  return state.entries.flatMap((entry) => {
    const row: FilesRow = { kind: "entry", key: entry.path, depth, entry };
    if (entry.type !== "directory" || !snapshot.expanded.has(entry.path)) return [row];
    return [row, ...buildRows(entry.path, depth + 1, snapshot)];
  });
}

function WorkbenchFiles({
  workspaceId,
  directory,
  isThreadRunning,
  isVisible,
  selectedPath,
  onOpenFile,
}: {
  readonly workspaceId: Workspace.WorkspaceId;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly isVisible: boolean;
  readonly selectedPath: string | null;
  readonly onOpenFile: (path: string) => void;
}): React.ReactElement {
  const resource = filesResourceFor(workspaceId);
  const snapshot = React.useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  React.useEffect(() => {
    resource.observeThreadRunning(isThreadRunning);
  }, [isThreadRunning, resource]);

  const root = snapshot.dirs.get(ROOT_PATH);

  return (
    <div {...stylex.props(styles.root)}>
      <section aria-label="Files explorer" {...stylex.props(styles.explorer)}>
        {isVisible ? (
          <>
            <div {...stylex.props(styles.toolbar)}>
              <Text
                size="xs"
                tone="faint"
                family="mono"
                truncate
                title={directory}
                style={styles.toolbarName}
              >
                {basename(directory)}
              </Text>
              <IconButton
                type="button"
                size="sm"
                variant="quiet"
                aria-label="Refresh files"
                title="Refresh files"
                onClick={resource.refresh}
              >
                <Icon icon={IconArrowRotateClockwise} size="sm" tone="muted" />
              </IconButton>
            </div>
            {root === undefined || root.phase === "loading" ? (
              <div {...stylex.props(styles.center)}>
                <Spinner label="Loading files" tone="muted" />
              </div>
            ) : root.phase === "error" ? (
              <div {...stylex.props(styles.center)}>
                <Text as="p" size="sm" tone="muted" weight="regular">
                  Can&apos;t list files
                </Text>
                <Text as="p" size="xs" tone="faint">
                  {root.message}
                </Text>
                <Button size="sm" variant="quiet" onClick={resource.refresh}>
                  Try again
                </Button>
              </div>
            ) : root.entries.length === 0 ? (
              <div {...stylex.props(styles.center)}>
                <Text as="p" size="sm" tone="muted" weight="regular">
                  No files
                </Text>
                <Text as="p" size="xs" tone="faint" family="mono">
                  {directory}
                </Text>
              </div>
            ) : (
              <div data-honk-scrollport="" {...stylex.props(styles.tree)}>
                {buildRows(ROOT_PATH, 0, snapshot).map((row) =>
                  row.kind === "note" ? (
                    <FilesNoteRow key={row.key} row={row} onRetry={resource.load} />
                  ) : (
                    <FilesEntryRow
                      key={row.key}
                      entry={row.entry}
                      depth={row.depth}
                      isExpanded={snapshot.expanded.has(row.entry.path)}
                      isLoading={snapshot.dirs.get(row.entry.path)?.phase === "loading"}
                      isSelected={selectedPath === row.entry.path}
                      decoration={snapshot.decorations.get(row.entry.path)}
                      changedDescendants={snapshot.changedDescendants.get(row.entry.path) ?? 0}
                      onSelect={onOpenFile}
                      onToggle={resource.toggle}
                    />
                  ),
                )}
              </div>
            )}
          </>
        ) : null}
      </section>
      <section aria-label="File preview" {...stylex.props(styles.editor)}>
        {selectedPath === null ? (
          <>
            <div {...stylex.props(styles.editorEmptyHeader)}>
              <Text size="xs" tone="faint">
                Editor
              </Text>
            </div>
            <div {...stylex.props(styles.center)}>
              <Text as="p" size="sm" tone="muted" weight="regular">
                Select a file
              </Text>
              <Text as="p" size="xs" tone="faint">
                Choose a file from the explorer to preview it.
              </Text>
            </div>
          </>
        ) : (
          <WorkbenchFileViewer
            path={selectedPath}
            workspaceId={workspaceId}
            isThreadRunning={isThreadRunning}
            isVisible={isVisible}
          />
        )}
      </section>
    </div>
  );
}

function FilesEntryRow({
  entry,
  depth,
  isExpanded,
  isLoading,
  isSelected,
  decoration,
  changedDescendants,
  onSelect,
  onToggle,
}: {
  readonly entry: FilesEntry;
  readonly depth: number;
  readonly isExpanded: boolean;
  readonly isLoading: boolean;
  readonly isSelected: boolean;
  readonly decoration: Git.ChangeStatus | undefined;
  readonly changedDescendants: number;
  readonly onSelect: (path: string) => void;
  readonly onToggle: (path: string) => void;
}): React.ReactElement {
  if (entry.type === "directory") {
    return (
      <button
        type="button"
        data-canonical-control-exception="Files explorer folder row: custom disclosure composite; no @honk/ui tree primitive exists."
        aria-expanded={isExpanded}
        {...stylex.props(styles.row, styles.rowControl, styles.indent(depth))}
        onClick={() => {
          onToggle(entry.path);
        }}
      >
        <span {...stylex.props(styles.disclosure)}>
          <Icon
            icon={isExpanded ? IconChevronDownMedium : IconChevronRightMedium}
            size="sm"
            tone="faint"
          />
        </span>
        <span {...stylex.props(styles.glyphSlot)}>
          {isLoading ? (
            <Spinner size="sm" tone="muted" />
          ) : (
            <Icon icon={isExpanded ? IconFolderOpen : IconFolder1} size="sm" tone="muted" />
          )}
        </span>
        <span {...stylex.props(styles.name, styles.dirName)}>{entry.name}</span>
        {changedDescendants > 0 ? (
          <span
            aria-label={`${String(changedDescendants)} changed files`}
            title={`${String(changedDescendants)} changed files`}
            {...stylex.props(styles.changedCount)}
          >
            {changedDescendants}
          </span>
        ) : null}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-canonical-control-exception="Files explorer file row: custom glyph/status composite matched to the folder row; no @honk/ui tree primitive exists."
      title={entry.path}
      aria-current={isSelected ? "page" : undefined}
      {...stylex.props(
        styles.row,
        styles.rowControl,
        isSelected && styles.rowSelected,
        styles.indent(depth),
      )}
      onClick={() => {
        onSelect(entry.path);
      }}
    >
      <span {...stylex.props(styles.disclosure)} />
      <span {...stylex.props(styles.glyphSlot)}>
        <FileTypeIcon path={entry.path} size="sm" />
      </span>
      <span
        {...stylex.props(
          styles.name,
          decoration !== undefined && statusColorStyle(decoration),
          decoration === "deleted" && styles.deletedName,
        )}
      >
        {entry.name}
      </span>
      {decoration === undefined ? null : (
        // role=img is what folds the single letter into the row's accessible name as its status
        // word rather than the character "M".
        <span
          role="img"
          aria-label={decoration}
          {...stylex.props(styles.glyphSlot, statusColorStyle(decoration))}
        >
          {fileStatusGlyph(decoration)}
        </span>
      )}
    </button>
  );
}

function FilesNoteRow({
  row,
  onRetry,
}: {
  readonly row: Extract<FilesRow, { readonly kind: "note" }>;
  readonly onRetry: (path: string) => void;
}): React.ReactElement {
  const retryPath = row.retryPath;
  return (
    // The two empty leading slots line the note up with the filenames it sits among.
    <div {...stylex.props(styles.row, styles.indent(row.depth))}>
      <span {...stylex.props(styles.disclosure)} />
      <span {...stylex.props(styles.glyphSlot)} />
      <Text size="xs" tone="faint" truncate title={row.text} style={styles.noteText}>
        {row.text}
      </Text>
      {retryPath === null ? null : (
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            onRetry(retryPath);
          }}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

export { WorkbenchFiles };
