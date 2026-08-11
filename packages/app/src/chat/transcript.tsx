// The chat transcript, rendered in the turn grammar (spec/conversation.md):
// every turn shows at its effective disclosure layer — L0 collapses to the
// worked-for header and summary, L1 shows headlines with read-shaped work
// grouped, L2 shows every row, L3 is a row's own expansion. The live turn
// streams prose as ordinary markdown while the TurnStatus ticker names the
// active tool, and every settled turn shows what the agent edited.

import {
  Button,
  ChangeReceipt,
  Matrix,
  Text,
  ToolCallLine,
  UserMessage,
  WorkGroup,
  type ToolCallState,
} from "@honk/ui";
import { AssistantMessage } from "@honk/ui/assistant-message";
import { CompactionDivider } from "@honk/ui/compaction-divider";
import { NoticeRow } from "@honk/ui/notice-row";
import { TimelineNavigator } from "@honk/ui/timeline-navigator";
import {
  colorVars,
  conversationVars,
  fontVars,
  proseVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import { File, PatchDiff } from "@pierre/diffs/react";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import type { ConversationDensity } from "@honk/shared/conversation-density";
import type { Session } from "@honk/core/session";

import { useAppSettings } from "../app-settings-store";
import {
  buildDiffOptions,
  buildPatchCacheKey,
  COLLAPSED_PATCH_CONTEXT_LINES,
  COLLAPSED_PATCH_ROWS,
  EXPANDED_PATCH_CONTEXT_LINES,
  patchExceedsPreview,
  PIERRE_DIFF_THEME_CSS,
  renderablePatch,
  resolveDiffThemeName,
} from "../lib/diff-rendering";
import { useResolvedTheme } from "../lib/use-resolved-theme";
import { GIT_AGENT_ACTIONS } from "../lib/git-agent-actions";
import { Markdown } from "../markdown";
import type {
  ConversationItem,
  DisclosureLayer,
  TickerState,
  TurnSegment,
  TurnStep,
  TurnView,
} from "./chat-model";
import { effectiveLayer, segmentRows } from "./chat-model";
import { useInventory } from "./inventory-store";
import { InlineMessageEdit } from "./inline-message-edit";
import type { ActiveMessageEdit, MessageEditTarget } from "./message-edit";
import { MessageImages } from "./message-images";
import type { ModelSelection } from "./selection";
import { projectTaskLinks, type TaskLink } from "./task-links";
import { TaskRow } from "./task-row";
import { activeTimelineId, railPlacement, type RailPlacement } from "./transcript-rail";
import {
  timelineItems,
  TRANSCRIPT_EDGE_PAD_PX,
  transcriptRowEstimatePx,
  transcriptRowLeadingGapPx,
  transcriptRows,
  transcriptRowTrailingGapPx,
  type TranscriptRow,
} from "./transcript-rows";
import { PLANNING_LABEL, TurnStatus } from "./turn-status";
import { VirtualTranscript, type VirtualTranscriptController } from "./virtual-transcript";

// The thread column's measure: wide enough for prose plus an inset diff card,
// narrow enough that a line of transcript text never exceeds a readable length.
export const TRANSCRIPT_MAX_WIDTH = "796px";
// First-paint plane geometry, before the scrollport resolves its own height.
const INITIAL_VIEWPORT_HEIGHT_PX = 720;
// How far from the bottom still counts as following the conversation.
const NEAR_END_PX = 48;
// A collapsed edit or write card shows about four code rows before the row's
// own disclosure opens it; the cap is the geometry those rows occupy.
const COLLAPSED_CARD_MAX_HEIGHT = "80px";
// The source card sits inside the row's own frame, so Pierre's editor
// background gives way to it; the rest of the bridge is the workbench's.
const SOURCE_CARD_CSS = `${PIERRE_DIFF_THEME_CSS}\n:host { --diffs-bg: transparent; }`;

const styles = stylex.create({
  frame: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    width: "100%",
  },
  scroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  column: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: TRANSCRIPT_MAX_WIDTH,
    marginInline: "auto",
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  // Before the first prompt there is no conversation to lay out, only the
  // agent waiting to be told something.
  empty: {
    display: "grid",
    flexGrow: 1,
    alignContent: "center",
    justifyItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  // The rail floats beside the thread panel, outside the transcript column,
  // and never takes pointer events except on its own stops.
  railLayer: {
    position: "fixed",
    zIndex: 1,
    width: 0,
    pointerEvents: "none",
    overflow: "visible",
  },
  // The card sits inset under its row, framed like the prose code block so
  // the transcript reads as one surface.
  card: {
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
    marginBlockStart: spaceVars["--honk-space-gutter"],
    marginInline: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: proseVars["--honk-prose-code-paint"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-code"],
  },
  cardCollapsed: {
    maxHeight: COLLAPSED_CARD_MAX_HEIGHT,
  },
  cardReason: {
    padding: spaceVars["--honk-space-gutter"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-caption"],
    color: colorVars["--honk-color-text-muted"],
  },
  cardRaw: {
    margin: 0,
    padding: spaceVars["--honk-space-gutter"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  // The settled header is the turn's collapse control; the button chrome is
  // the header itself, so the wrapper stays bare.
  headerButton: {
    display: "block",
    width: "fit-content",
    maxWidth: "100%",
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    textAlign: "left",
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  // Transcript markers (model choice, workspace moves) are context, not
  // messages: a quiet centered line, not a warning banner.
  notice: {
    textAlign: "center",
    fontSize: fontVars["--honk-font-size-caption"],
    color: colorVars["--honk-color-text-muted"],
  },
  // The canonical action instructions, readable at the detailed layer.
  instructions: {
    fontSize: fontVars["--honk-font-size-detail"],
    color: colorVars["--honk-color-text-muted"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  actionOffer: {
    display: "flex",
    gap: spaceVars["--honk-space-gutter"],
  },
  // Every conversation element carries this inset itself: tool rows, the status
  // organ, notices. Headline prose is the one that renders bare, so it takes
  // the inset here or it hangs a token to the left of the rows beneath it.
  headline: {
    paddingInline: conversationVars["--honk-conversation-inset"],
  },
});

const dynamic = stylex.create({
  railFrame: (leftPx: number, topPx: number, heightPx: number) => ({
    insetInlineStart: `${String(leftPx)}px`,
    top: `${String(topPx)}px`,
    height: `${String(heightPx)}px`,
  }),
});

const toolCallState: Record<TurnStep["state"], ToolCallState> = {
  running: "running",
  ok: "done",
  error: "failed",
};

// The chat surface offers the judgment-shaped actions that make sense after
// a turn changed files; branch workflows stay in source control surfaces.
const OFFERED_ACTIONS: readonly Session.GitActionId[] = ["commit", "commitAndPush"];

const gitActionLabels = new Map<string, string>(
  Object.entries(GIT_AGENT_ACTIONS).map<readonly [string, string]>(([action, presentation]) => [
    action,
    presentation.label,
  ]),
);

/** The chip and the offer speak the same label the action buttons ship. */
const actionLabel = (action: string): string => gitActionLabels.get(action) ?? action;

/** An edit, as the diff Pi applied. Pierre owns the parse and the paint. */
function StepDiffCard({
  patch,
  isExpanded,
}: {
  readonly patch: string;
  readonly isExpanded: boolean;
}): React.ReactElement | null {
  const theme = useResolvedTheme();
  const { diffWordWrap } = useAppSettings();
  const renderable = renderablePatch(
    patch,
    isExpanded ? EXPANDED_PATCH_CONTEXT_LINES : COLLAPSED_PATCH_CONTEXT_LINES,
  );
  const prepared = renderable?.kind === "patch" ? renderable.text : "";
  const diffOptions = buildDiffOptions(theme, "unified", diffWordWrap, prepared);
  if (renderable === null) return null;
  if (renderable.kind === "raw") {
    // A patch Pierre cannot read is shown as it arrived: an empty card would
    // hide a real edit behind a silent failure.
    return (
      <div data-tool-card="raw" {...stylex.props(styles.card, !isExpanded && styles.cardCollapsed)}>
        <div {...stylex.props(styles.cardReason)}>{renderable.reason}</div>
        <pre {...stylex.props(styles.cardRaw)}>{renderable.text}</pre>
      </div>
    );
  }
  return (
    <div data-tool-card="diff" {...stylex.props(styles.card, !isExpanded && styles.cardCollapsed)}>
      <PatchDiff patch={prepared} options={diffOptions} disableWorkerPool />
    </div>
  );
}

/** A write, as the text the call carried. No stats: it saw no prior file. */
function StepSourceCard({
  path,
  contents,
  isExpanded,
}: {
  readonly path: string;
  readonly contents: string;
  readonly isExpanded: boolean;
}): React.ReactElement {
  const theme = useResolvedTheme();
  const { diffWordWrap } = useAppSettings();
  const shown = isExpanded
    ? contents
    : contents.split("\n").slice(0, COLLAPSED_PATCH_ROWS).join("\n");
  return (
    <div
      data-tool-card="source"
      {...stylex.props(styles.card, !isExpanded && styles.cardCollapsed)}
    >
      <File
        file={{ name: path, contents: shown, cacheKey: buildPatchCacheKey(shown, "tool-source") }}
        options={{
          theme: resolveDiffThemeName(theme),
          themeType: theme,
          unsafeCSS: SOURCE_CARD_CSS,
          overflow: diffWordWrap ? "wrap" : "scroll",
          disableFileHeader: true,
          disableLineNumbers: true,
          preferredHighlighter: "shiki-js",
        }}
      />
    </div>
  );
}

// Task links and the thread's running flag, threaded to the rows that need
// them. Only task steps read it, so plain rows pay nothing.
interface TaskContext {
  readonly links: ReadonlyMap<string, TaskLink>;
  readonly isThreadRunning: boolean;
}

const EMPTY_TASK_CONTEXT: TaskContext = { links: new Map(), isThreadRunning: false };

/**
 * One tool call at L2 (spec §4). An edit and a write bring their own card;
 * every other call's evidence is its output, which opens on the row's own
 * disclosure. A successful read shows neither: the file it read is a surface
 * of its own, and repeating it here would be duplication, not evidence.
 */
function StepRow({
  step,
  tasks = EMPTY_TASK_CONTEXT,
}: {
  readonly step: TurnStep;
  readonly tasks?: TaskContext;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  if (step.name === "task") {
    return (
      <TaskRow
        step={step}
        link={tasks.links.get(step.key) ?? null}
        isThreadRunning={tasks.isThreadRunning}
        isExpanded={expanded}
        onToggle={() => {
          setExpanded((open) => !open);
        }}
      />
    );
  }
  const bodyId = `tool-body-${step.key}`;
  const canExpand =
    step.patch !== null
      ? patchExceedsPreview(step.patch)
      : step.content !== null
        ? step.content.split("\n").length > COLLAPSED_PATCH_ROWS
        : step.output.length > 0;
  return (
    <div>
      <ToolCallLine
        verb={step.verb}
        {...(step.detail === null ? {} : { detail: step.detail })}
        state={toolCallState[step.state]}
        added={step.added}
        removed={step.removed}
        isExpanded={expanded}
        {...(canExpand
          ? {
              "aria-controls": bodyId,
              onToggle: () => {
                setExpanded((open) => !open);
              },
            }
          : {})}
      />
      <div id={bodyId}>
        {step.patch !== null ? (
          <StepDiffCard patch={step.patch} isExpanded={expanded} />
        ) : step.content !== null ? (
          <StepSourceCard
            path={step.detail ?? "file"}
            contents={step.content}
            isExpanded={expanded}
          />
        ) : (
          expanded &&
          step.output.length > 0 && <WorkGroup.OutputStrip>{step.output}</WorkGroup.OutputStrip>
        )}
      </div>
    </div>
  );
}

/** A rolled run of reads: one line until opened, then every row (spec §4). */
function ReadGroup({ steps }: { readonly steps: readonly TurnStep[] }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const isRunning = steps.some((step) => step.state === "running");
  return (
    <WorkGroup isRunning={isRunning}>
      <WorkGroup.Header
        verb="Read"
        detail={`${String(steps.length)} files`}
        isRunning={isRunning}
        isExpanded={expanded}
        onToggle={() => {
          setExpanded((open) => !open);
        }}
      />
      {expanded && steps.map((step) => <StepRow key={step.key} step={step} />)}
    </WorkGroup>
  );
}

function SegmentView({
  segment,
  layer,
  live,
  tasks,
}: {
  readonly segment: TurnSegment;
  readonly layer: DisclosureLayer;
  readonly live: boolean;
  readonly tasks: TaskContext;
}): React.ReactElement {
  return (
    <div>
      {segment.headline !== null && (
        <div {...stylex.props(styles.headline)}>
          <Markdown text={segment.headline} isStreaming={live} />
        </div>
      )}
      {layer >= 2
        ? segment.steps.map((step) => <StepRow key={step.key} step={step} tasks={tasks} />)
        : segmentRows(segment.steps).map((row) =>
            row.kind === "step" ? (
              <StepRow key={row.step.key} step={row.step} tasks={tasks} />
            ) : (
              <ReadGroup key={row.steps[0]?.key ?? segment.id} steps={row.steps} />
            ),
          )}
    </div>
  );
}

/** The user's half of a turn: the row that pins to the top while work runs. */
function TurnUserRow({
  turn,
  gitAction,
  layer,
  onEdit,
  editActionRef,
  editComposer,
}: {
  readonly turn: TurnView;
  /** Set when a `honk.git_action` marker precedes this turn: render a chip. */
  readonly gitAction: string | null;
  readonly layer: DisclosureLayer;
  readonly onEdit: (() => void) | null;
  readonly editActionRef: React.Ref<HTMLButtonElement> | undefined;
  readonly editComposer: React.ReactElement | null;
}): React.ReactElement {
  if (gitAction === null) {
    if (editComposer !== null) return editComposer;
    return (
      <UserMessage onEdit={onEdit === null ? undefined : onEdit} editActionRef={editActionRef}>
        <MessageImages images={turn.userImages} />
        {turn.userText.length === 0 ? null : turn.userText}
      </UserMessage>
    );
  }
  // The chip is the user's one click rendered as their message; the canonical
  // instructions stay readable at the detailed layer, so the transcript never
  // hides what the model was told (spec §8).
  return (
    <>
      <UserMessage>{actionLabel(gitAction)}</UserMessage>
      {layer >= 2 && <div {...stylex.props(styles.instructions)}>{turn.userText}</div>}
    </>
  );
}

/** The agent's half: segments, the status organ, the receipt, the offer. */
function TurnWorkRow({
  turn,
  live,
  ticker,
  layer,
  density,
  tasks,
  onGitAction,
  onSetLayer,
  onReviewChanges,
  onOpenFile,
}: {
  readonly turn: TurnView;
  readonly live: boolean;
  readonly ticker: TickerState;
  readonly layer: DisclosureLayer;
  readonly density: ConversationDensity;
  readonly tasks: TaskContext;
  /** Present only on the turn whose receipt currently offers actions. */
  readonly onGitAction: ((action: Session.GitActionId) => void) | null;
  readonly onSetLayer: (layer: DisclosureLayer) => void;
  readonly onReviewChanges: (() => void) | null;
  readonly onOpenFile: ((path: string) => void) | null;
}): React.ReactElement {
  const phase = live ? "running" : "settled";
  const status = (
    <TurnStatus phase={phase} ticker={ticker} outcome={turn.outcome} durationMs={turn.durationMs} />
  );
  const statusExpanded = live ? layer >= 2 : layer >= 1;
  return (
    <AssistantMessage isStreaming={live}>
      {layer >= 1 &&
        turn.segments.map((segment) => (
          <SegmentView key={segment.id} segment={segment} layer={layer} live={live} tasks={tasks} />
        ))}
      {/* The preview and settled header are one disclosure control, so the
          TurnStatus child stays mounted while its label and phase change. */}
      <button
        key="turn-status"
        type="button"
        aria-expanded={statusExpanded}
        data-canonical-control-exception="Turn disclosure header: the TurnStatus surface is the control's whole chrome; button styling would double it."
        onClick={() => {
          if (live) {
            onSetLayer(layer >= 2 ? 1 : 2);
            return;
          }
          onSetLayer(layer === 0 ? (density === "detailed" ? 2 : 1) : 0);
        }}
        {...stylex.props(styles.headerButton)}
      >
        {status}
      </button>
      {turn.summary !== null && (
        <div {...stylex.props(styles.headline)}>
          <Markdown text={turn.summary} isStreaming={live} />
        </div>
      )}
      {turn.error !== null && <NoticeRow severity="error" message={turn.error} />}
      {!live &&
        turn.files.length > 0 && (
          // What the agent edited, at every settle — the change receipt maps
          // Git's statuses one to one, and its rows open the workbench sitting
          // beside this transcript.
          <ChangeReceipt
            files={turn.files.map((file) => ({
              path: file.file,
              additions: file.additions,
              deletions: file.deletions,
              status: file.status,
            }))}
            onReview={onReviewChanges ?? undefined}
            onFileClick={
              onOpenFile === null
                ? undefined
                : (file) => {
                    onOpenFile(file.path);
                  }
            }
          />
        )}
      {onGitAction !== null &&
        !live &&
        turn.files.length > 0 && (
          // The offer is chrome (spec §8): it exists nowhere in the transcript
          // until clicked, and clicking starts an ordinary turn.
          <div {...stylex.props(styles.actionOffer)}>
            {OFFERED_ACTIONS.map((action) => (
              <Button
                key={action}
                size="sm"
                onClick={() => {
                  onGitAction(action);
                }}
              >
                {actionLabel(action)}
              </Button>
            ))}
          </div>
        )}
    </AssistantMessage>
  );
}

function AsideRow({
  item,
}: {
  readonly item: Extract<TranscriptRow, { readonly kind: "aside" }>["item"];
}): React.ReactElement {
  switch (item.kind) {
    case "git_action_failed":
      return <NoticeRow severity="error" message={`${actionLabel(item.action)} didn't start.`} />;
    case "compaction":
      return <CompactionDivider summary={item.summary} tokensBefore={item.tokensBefore} />;
    case "notice":
      return <div {...stylex.props(styles.notice)}>{item.text}</div>;
  }
}

type RailState = RailPlacement & { readonly activeId: string | null };

export type TranscriptMessageEditing =
  | { readonly kind: "disabled" }
  | {
      readonly kind: "enabled";
      readonly active: ActiveMessageEdit | null;
      readonly available: boolean;
      readonly onBegin: (target: MessageEditTarget) => void;
      readonly onChange: (message: MessageEditTarget["message"]) => void;
      readonly onSelectionChange: (selection: ModelSelection) => void;
      readonly onCancel: () => void;
      readonly onSubmit: (message: MessageEditTarget["message"]) => void;
    };

const MESSAGE_EDITING_DISABLED: TranscriptMessageEditing = { kind: "disabled" };

const INITIAL_RAIL: RailState = {
  activeId: null,
  isVisible: false,
  leftPx: 0,
  topPx: 0,
  heightPx: 0,
  availableWidthPx: 0,
};

const railChanged = (current: RailState, next: RailState): boolean =>
  current.activeId !== next.activeId ||
  current.isVisible !== next.isVisible ||
  Math.abs(current.leftPx - next.leftPx) >= 0.5 ||
  Math.abs(current.topPx - next.topPx) >= 0.5 ||
  Math.abs(current.heightPx - next.heightPx) >= 0.5 ||
  Math.abs(current.availableWidthPx - next.availableWidthPx) >= 0.5;

export function ChatTranscript({
  items,
  running,
  ticker,
  density,
  sessionId,
  restorationKey,
  onGitAction,
  messageEditing = MESSAGE_EDITING_DISABLED,
  onReviewChanges = null,
  onOpenFile = null,
}: {
  readonly items: readonly ConversationItem[];
  readonly running: boolean;
  readonly ticker: TickerState;
  readonly density: ConversationDensity;
  /** The thread's own session: what task rows link their children against. */
  readonly sessionId?: Session.SessionId;
  /** Scroll offset and follow intent are retained per session under this key. */
  readonly restorationKey?: string;
  readonly onGitAction: (action: Session.GitActionId) => void;
  readonly messageEditing?: TranscriptMessageEditing;
  readonly onReviewChanges?: (() => void) | null;
  readonly onOpenFile?: ((path: string) => void) | null;
}): React.ReactElement {
  const rows = transcriptRows(items);
  const stops = timelineItems(items);
  // The inventory is the sanctioned read for a collapsed task row's child
  // phase; per-child session watches open only when a row folds open.
  const inventory = useInventory();
  const tasks: TaskContext = {
    links:
      sessionId === undefined
        ? EMPTY_TASK_CONTEXT.links
        : projectTaskLinks({
            steps: items.flatMap((item) =>
              item.kind === "turn" ? item.turn.segments.flatMap((segment) => segment.steps) : [],
            ),
            sessions: inventory.sessions,
            parentId: sessionId,
          }),
    isThreadRunning: running,
  };
  const lastTurn = items.findLast(
    (item): item is Extract<ConversationItem, { kind: "turn" }> => item.kind === "turn",
  );
  const activeEdit = messageEditing.kind === "enabled" ? messageEditing.active : null;
  const editActionRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());
  const restoreEditFocusRef = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const entryId = restoreEditFocusRef.current;
    if (activeEdit !== null || entryId === null) return;
    restoreEditFocusRef.current = null;
    editActionRefs.current.get(entryId)?.focus();
  }, [activeEdit]);

  // The per-turn override: a click wins over the setting for that turn only.
  // It lives here because a turn's two rows are separate mounts and either may
  // be unmounted by the virtual plane while the other is on screen.
  const [overrides, setOverrides] = React.useState<ReadonlyMap<string, DisclosureLayer>>(
    () => new Map(),
  );
  const [lastDensity, setLastDensity] = React.useState(density);
  if (lastDensity !== density) {
    // Changing the density is a statement about the whole conversation, so the
    // per-turn clicks it overrules are stale the moment it lands.
    setLastDensity(density);
    setOverrides(new Map());
  }
  const layerOf = (turn: TurnView, live: boolean): DisclosureLayer =>
    effectiveLayer(overrides.get(turn.id) ?? null, density, live ? "running" : "settled");

  const scrollportRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const controllerRef = React.useRef<VirtualTranscriptController | null>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const measureFrameRef = React.useRef(0);
  const turnElementsRef = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const [scrollElement, setScrollElement] = React.useState<HTMLDivElement | null>(null);
  const [rail, setRail] = React.useState<RailState>(INITIAL_RAIL);

  // The follow key: turn identity plus everything that grows while a turn
  // streams — steps, headline text, summary text. Headline length matters on
  // its own, because a segment can stream prose for seconds without gaining a
  // step, and the view must keep pace with it.
  const streamedSize =
    lastTurn === undefined
      ? 0
      : lastTurn.turn.segments.reduce(
          (total, segment) => total + segment.steps.length + (segment.headline?.length ?? 0),
          lastTurn.turn.summary?.length ?? 0,
        );
  const editVersion =
    activeEdit?.phase === "editing"
      ? `${activeEdit.entryId}:${String(activeEdit.message.text.length)}:${String(activeEdit.message.images.length)}`
      : (activeEdit?.phase ?? "idle");
  const contentVersion =
    lastTurn === undefined
      ? editVersion
      : `${lastTurn.turn.id}:${String(rows.length)}:${String(streamedSize)}:${editVersion}`;

  const measureRail = (): void => {
    const scrollport = scrollportRef.current;
    const content = contentRef.current;
    if (scrollport === null || content === null) return;
    const scrollportRect = scrollport.getBoundingClientRect();
    const maxScroll = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight);
    const placement = railPlacement({
      scrollport: {
        top: scrollportRect.top,
        left: scrollportRect.left,
        right: scrollportRect.right,
        height: scrollportRect.height,
      },
      panelLeft: scrollport.closest("[data-thread-panel]")?.getBoundingClientRect().left ?? null,
      contentLeft: content.getBoundingClientRect().left,
      maxScroll,
    });
    const next: RailState = {
      ...placement,
      activeId: activeTimelineId({
        stops: [...turnElementsRef.current].map(([id, element]) => ({
          id,
          top: element.getBoundingClientRect().top - scrollportRect.top + scrollport.scrollTop,
        })),
        scrollTop: scrollport.scrollTop,
        clientHeight: scrollport.clientHeight,
        maxScroll,
      }),
    };
    setRail((current) => (railChanged(current, next) ? next : current));
  };
  const scheduleRailMeasure = (): void => {
    cancelAnimationFrame(measureFrameRef.current);
    measureFrameRef.current = requestAnimationFrame(measureRail);
  };

  const attachScrollport: React.RefCallback<HTMLDivElement> = (element) => {
    scrollportRef.current = element;
    setScrollElement(element);
    if (element === null) return;
    const observer = new ResizeObserver(scheduleRailMeasure);
    observerRef.current = observer;
    // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- React 19 runs the returned callback-ref teardown, which disconnects this observer.
    observer.observe(element);
    // Refs attach children first, so the content column is already mounted and
    // had no observer to register with when its own callback ran.
    if (contentRef.current !== null) observer.observe(contentRef.current);
    scheduleRailMeasure();
    return () => {
      cancelAnimationFrame(measureFrameRef.current);
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
      if (scrollportRef.current === element) scrollportRef.current = null;
    };
  };

  const attachContent: React.RefCallback<HTMLDivElement> = (element) => {
    contentRef.current = element;
    if (element === null) return;
    const observer = observerRef.current;
    // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- The callback-ref teardown below unobserves this exact element.
    observer?.observe(element);
    scheduleRailMeasure();
    return () => {
      observer?.unobserve(element);
      if (contentRef.current === element) contentRef.current = null;
    };
  };

  const navigateToTurn = (id: string): void => {
    const index = rows.findIndex((row) => row.kind === "user" && row.item.turn.id === id);
    if (index < 0) return;
    // The click owns the viewport, so the controller releases follow before it
    // jumps; a reader who asked for no motion gets none.
    setRail((current) => ({ ...current, activeId: id }));
    controllerRef.current?.scrollToIndex(index, {
      align: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  const renderRow = (row: TranscriptRow): React.ReactNode => {
    if (row.kind === "aside") return <AsideRow item={row.item} />;
    const { turn } = row.item;
    const live = running && turn.id === lastTurn?.turn.id;
    const layer = layerOf(turn, live);
    if (row.kind === "user") {
      const editingThisTurn =
        activeEdit?.phase === "editing" && activeEdit.entryId === turn.id ? activeEdit : null;
      const canBeginEdit =
        !running &&
        activeEdit === null &&
        messageEditing.kind === "enabled" &&
        row.item.gitAction === null;
      return (
        <TurnUserRow
          turn={turn}
          gitAction={row.item.gitAction}
          layer={layer}
          editComposer={
            editingThisTurn === null || messageEditing.kind !== "enabled" ? null : (
              <InlineMessageEdit
                edit={editingThisTurn}
                running={running}
                available={messageEditing.available}
                onChange={messageEditing.onChange}
                onSelectionChange={messageEditing.onSelectionChange}
                onCancel={(reason) => {
                  if (reason === "escape") {
                    restoreEditFocusRef.current = editingThisTurn.entryId;
                  }
                  messageEditing.onCancel();
                }}
                onSubmit={messageEditing.onSubmit}
              />
            )
          }
          editActionRef={
            canBeginEdit
              ? (element) => {
                  if (element === null) editActionRefs.current.delete(turn.id);
                  else editActionRefs.current.set(turn.id, element);
                }
              : undefined
          }
          onEdit={
            !canBeginEdit || messageEditing.kind !== "enabled"
              ? null
              : () => {
                  messageEditing.onBegin({
                    entryId: turn.id,
                    message: { text: turn.userText, images: turn.userImages },
                  });
                }
          }
        />
      );
    }
    return (
      <TurnWorkRow
        turn={turn}
        live={live}
        ticker={ticker}
        layer={layer}
        density={density}
        tasks={tasks}
        // Only the latest settled work is offerable: an older receipt may
        // already be committed, and a running turn is refused by core anyway.
        onGitAction={!running && turn.id === lastTurn?.turn.id ? onGitAction : null}
        onSetLayer={(next) => {
          setOverrides((current) => new Map(current).set(turn.id, next));
        }}
        onReviewChanges={onReviewChanges}
        onOpenFile={onOpenFile}
      />
    );
  };

  if (rows.length === 0) {
    return (
      <div {...stylex.props(styles.frame)}>
        <div {...stylex.props(styles.empty)}>
          <Matrix variant="compass" color={colorVars["--honk-color-text-muted"]} />
          <Text as="p" size="sm" tone="muted">
            {running ? PLANNING_LABEL : "Nothing here yet"}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.frame)}>
      {rail.isVisible && (
        <div
          {...stylex.props(
            styles.railLayer,
            dynamic.railFrame(rail.leftPx, rail.topPx, rail.heightPx),
          )}
        >
          <TimelineNavigator
            items={stops}
            activeId={rail.activeId}
            availableWidthPx={rail.availableWidthPx}
            onNavigate={navigateToTurn}
          />
        </div>
      )}
      <div
        ref={attachScrollport}
        data-honk-scrollport="balanced"
        aria-label="Chat transcript"
        onScroll={scheduleRailMeasure}
        {...stylex.props(styles.scroll)}
      >
        <div ref={attachContent} {...stylex.props(styles.column)}>
          <VirtualTranscript
            rows={rows}
            scrollElement={scrollElement}
            controllerRef={controllerRef}
            getRowId={(row) => row.key}
            stickyRow={(row) => row.kind === "user"}
            estimateRowSize={transcriptRowEstimatePx}
            getRowLeadingGapPx={transcriptRowLeadingGapPx}
            getRowTrailingGapPx={transcriptRowTrailingGapPx}
            endClearancePx={TRANSCRIPT_EDGE_PAD_PX}
            initialViewportHeightPx={INITIAL_VIEWPORT_HEIGHT_PX}
            nearEndThresholdPx={NEAR_END_PX}
            contentVersion={contentVersion}
            {...(activeEdit?.phase === "editing"
              ? { retainedRowId: `user:${activeEdit.entryId}` }
              : {})}
            {...(restorationKey === undefined ? {} : { restorationKey })}
            onRowElement={(row, _index, element) => {
              if (row.kind !== "user") return;
              if (element === null) turnElementsRef.current.delete(row.item.turn.id);
              else turnElementsRef.current.set(row.item.turn.id, element);
              scheduleRailMeasure();
            }}
            renderRow={renderRow}
          />
        </div>
      </div>
    </div>
  );
}
