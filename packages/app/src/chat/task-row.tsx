// The delegation row: one task call rendered as a status row over the child
// session it ran in, with the child's transcript folding open inline. The
// released build also docked a live subagent tray against the composer; core
// has no mid-run permission or question asks, so the row answers everything
// and the tray does not return.

import { NoticeRow } from "@honk/ui/notice-row";
import { CompactionDivider } from "@honk/ui/compaction-divider";
import { Button, ToolCallLine, WorkGroup, UserMessage, type ToolCallState } from "@honk/ui";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import type { Session } from "@honk/core/session";

import { Markdown } from "../markdown";
import { conversationItems, type TurnStep, type TurnView } from "./chat-model";
import { useCoreSession } from "./chat-store";
import type { TaskLink } from "./task-links";

/** The child is between visible moves — the release's waiting label, verbatim. */
export const WAITING_PLANNING_LABEL = "Planning next moves";

// The released row's bounded scroll region: the inline transcript reads like
// a tray, not a second thread column.
const CHILD_SCROLL_MAX_HEIGHT_PX = 280;

export function taskToolControlID(stepKey: string): string {
  return `task-control:${stepKey}`;
}

export function taskToolRegionID(stepKey: string): string {
  return `task-region:${stepKey}`;
}

const styles = stylex.create({
  // Mirrors the transcript card inset so the region reads as the row's body.
  region: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    marginBlockStart: spaceVars["--honk-space-gutter"],
    marginInline: spaceVars["--honk-space-gutter"],
  },
  scroll: {
    maxHeight: `${String(CHILD_SCROLL_MAX_HEIGHT_PX)}px`,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
  },
  openAsThread: {
    alignSelf: "flex-start",
  },
  muted: {
    fontSize: fontVars["--honk-font-size-caption"],
    color: colorVars["--honk-color-text-muted"],
  },
  notice: {
    textAlign: "center",
    fontSize: fontVars["--honk-font-size-caption"],
    color: colorVars["--honk-color-text-muted"],
  },
});

const stepToolCallState: Record<TurnStep["state"], ToolCallState> = {
  running: "running",
  ok: "done",
  error: "failed",
};

/**
 * One task call at any layer. The row's primary text is the mission, the
 * detail is the delegated role, and the accessible name carries a stable
 * status word — never the live activity, so the name is not re-announced on
 * every move the child makes.
 */
export function TaskRow({
  step,
  link,
  isThreadRunning,
  isExpanded,
  onToggle,
}: {
  readonly step: TurnStep;
  readonly link: TaskLink | null;
  readonly isThreadRunning: boolean;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}): React.ReactElement {
  const projected: ToolCallState = link?.state ?? stepToolCallState[step.state];
  // A row that reads running without owning the child's live state is stale
  // the moment the thread itself settles; it can only have finished.
  const state: ToolCallState =
    projected === "running" && link?.ownsLiveState !== true && !isThreadRunning
      ? "done"
      : projected;
  const mission = step.detail ?? "Background work";
  const role = step.taskRole;
  const error = step.state === "error" && step.output.length > 0 ? step.output : null;
  const canToggle = link !== null || error !== null || step.output.length > 0;
  const statusLabel =
    state === "done" ? "Completed" : state === "failed" ? "Failed" : "In progress";
  const toggleHint =
    link !== null
      ? isExpanded
        ? "Minimize work details"
        : "Open work details"
      : error !== null
        ? isExpanded
          ? "Hide failure details"
          : "Show failure details"
        : isExpanded
          ? "Hide result details"
          : "Show result details";

  return (
    <div>
      <ToolCallLine
        id={taskToolControlID(step.key)}
        verb={mission}
        {...(role === null ? {} : { detail: role })}
        supportingText={
          state === "done" ? "Completed" : state === "failed" ? "Failed" : WAITING_PLANNING_LABEL
        }
        state={state}
        isExpanded={isExpanded}
        workingGlyph
        statusGlyphVariant="working"
        {...(canToggle
          ? {
              onToggle,
              "aria-controls": taskToolRegionID(step.key),
              "aria-label": `${mission}${role === null ? "" : `, ${role}`}. ${statusLabel}. ${toggleHint}`,
            }
          : {})}
      />
      {isExpanded && link !== null && (
        <div id={taskToolRegionID(step.key)} {...stylex.props(styles.region)}>
          <ChildTranscript sessionId={link.child.id} />
        </div>
      )}
      {isExpanded &&
        link === null &&
        step.output.length > 0 && (
          // An unlinked settled task has only its result text; a failed one
          // folds its error open the same way.
          <div id={taskToolRegionID(step.key)}>
            <WorkGroup.OutputStrip>{step.output}</WorkGroup.OutputStrip>
          </div>
        )}
    </div>
  );
}

/**
 * The child's transcript inline, through the same per-session watch handle a
 * full thread page uses. Mounted only while the row is open, so a collapsed
 * row never opens a child watch. Rows render flat: a task inside the child
 * shows as a plain line, never a nested expansion.
 */
function ChildTranscript({
  sessionId,
}: {
  readonly sessionId: Session.SessionId;
}): React.ReactElement {
  const { state } = useCoreSession(sessionId);
  const navigate = useNavigate();
  const items = conversationItems(state.entries, state.streamingMessage, state.turns);
  return (
    <>
      <div {...stylex.props(styles.openAsThread)}>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            void navigate({ to: "/chat/$sessionId", params: { sessionId } });
          }}
        >
          Open as thread
        </Button>
      </div>
      {state.status === "connecting" ? (
        <div {...stylex.props(styles.muted)}>Opening…</div>
      ) : (
        <div data-task-child-transcript="" {...stylex.props(styles.scroll)}>
          {state.error !== null && <NoticeRow severity="error" message={state.error} />}
          {items.map((item) => {
            switch (item.kind) {
              case "turn":
                return <ChildTurn key={item.turn.id} turn={item.turn} />;
              case "git_action_failed":
                return (
                  <NoticeRow
                    key={item.id}
                    severity="error"
                    message={`${item.action} didn't start.`}
                  />
                );
              case "compaction":
                return (
                  <CompactionDivider
                    key={item.id}
                    summary={item.summary}
                    tokensBefore={item.tokensBefore}
                  />
                );
              case "notice":
                return (
                  <div key={item.id} {...stylex.props(styles.notice)}>
                    {item.text}
                  </div>
                );
            }
          })}
        </div>
      )}
    </>
  );
}

function ChildTurn({ turn }: { readonly turn: TurnView }): React.ReactElement {
  return (
    <div>
      <UserMessage>{turn.userText}</UserMessage>
      {turn.segments.map((segment) => (
        <div key={segment.id}>
          {segment.headline !== null && <Markdown text={segment.headline} />}
          {segment.steps.map((child) => (
            <ToolCallLine
              key={child.key}
              verb={child.verb}
              {...(child.detail === null ? {} : { detail: child.detail })}
              state={stepToolCallState[child.state]}
              added={child.added}
              removed={child.removed}
            />
          ))}
        </div>
      ))}
      {turn.summary !== null && <Markdown text={turn.summary} />}
      {turn.error !== null && <NoticeRow severity="error" message={turn.error} />}
    </div>
  );
}
