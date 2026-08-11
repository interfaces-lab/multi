// How a task step finds the delegation-owned session it ran in. Pure, and
// deliberately unwilling to guess: the settled tool result's `details`
// sessionId is authoritative, a still-running call reverse-joins through the
// inventory's delegation birth marks (SessionSummary.delegation), and an
// ambiguous join omits the link rather than pointing the row at another
// subagent's transcript.

import type { Session } from "@honk/core/session";

import type { TurnStep } from "./chat-model";

export interface TaskLink {
  readonly child: Session.SessionSummary;
  /**
   * Core reuses one sidekick session across calls, so only the newest call
   * for a child speaks for its live state; older rows stay settled.
   */
  readonly ownsLiveState: boolean;
  readonly state: "running" | "done" | "failed";
}

const createdAtOf = (child: Session.SessionSummary): number => {
  const time = Date.parse(child.createdAt);
  return Number.isFinite(time) ? time : Number.NaN;
};

/**
 * The reverse join for a call that has no result yet: same parent, same
 * birth role, not already claimed by a settled call's explicit id. Repeated
 * one-shot preset calls leave same-role sessions behind, and creation order
 * is the only honest tiebreak — the newest is the one the runner just opened.
 * Two candidates the timestamps cannot order stay unlinked.
 */
const joinRunningStep = (
  step: TurnStep,
  children: readonly Session.SessionSummary[],
  claimed: ReadonlySet<string>,
): Session.SessionSummary | null => {
  if (step.taskRole === null) return null;
  const candidates = children.filter(
    (child) => child.delegation?.role === step.taskRole && !claimed.has(child.id),
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;
  const ordered = [...candidates].sort((a, b) => createdAtOf(b) - createdAtOf(a));
  const [newest, next] = ordered;
  if (newest === undefined || next === undefined) return newest ?? null;
  const newestAt = createdAtOf(newest);
  const nextAt = createdAtOf(next);
  return Number.isFinite(newestAt) && Number.isFinite(nextAt) && newestAt > nextAt ? newest : null;
};

const resolveChild = (
  step: TurnStep,
  children: readonly Session.SessionSummary[],
  claimed: ReadonlySet<string>,
): Session.SessionSummary | null => {
  if (step.taskChildId !== null) {
    // Explicit is authoritative; resolving to nothing means the child is
    // gone or not in the inventory yet, never that another one will do.
    return children.find((child) => child.id === step.taskChildId) ?? null;
  }
  return step.state === "running" ? joinRunningStep(step, children, claimed) : null;
};

const stateOf = (
  step: TurnStep,
  child: Session.SessionSummary,
  ownsLiveState: boolean,
): TaskLink["state"] => {
  if (step.state === "error") return "failed";
  if (step.state === "running") return "running";
  return ownsLiveState && child.phase !== "idle" ? "running" : "done";
};

/**
 * Links every task step it can defend to its child session, keyed by step
 * key. Steps of other tools, refusals (no child opened), and ambiguous joins
 * are simply absent.
 */
export const projectTaskLinks = (input: {
  readonly steps: readonly TurnStep[];
  readonly sessions: readonly Session.SessionSummary[];
  readonly parentId: Session.SessionId;
}): ReadonlyMap<string, TaskLink> => {
  const tasks = input.steps.filter((step) => step.name === "task");
  const children = input.sessions.filter(
    (session) => session.delegation?.delegationOf === input.parentId,
  );
  const claimed = new Set(
    tasks.flatMap((step) => (step.taskChildId === null ? [] : [step.taskChildId])),
  );
  const resolved = tasks.flatMap((step) => {
    const child = resolveChild(step, children, claimed);
    return child === null ? [] : [{ step, child }];
  });
  const lastIndexByChild = new Map(resolved.map((link, index) => [link.child.id, index]));
  return new Map(
    resolved.map(({ step, child }, index) => {
      const ownsLiveState = lastIndexByChild.get(child.id) === index;
      return [step.key, { child, ownsLiveState, state: stateOf(step, child, ownsLiveState) }];
    }),
  );
};
