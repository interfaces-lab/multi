import { describe, expect, it } from "vitest";

import { Session } from "@honk/core/session";

import { sessionSummary } from "../test-fixtures";
import type { TurnStep } from "./chat-model";
import { projectTaskLinks } from "./task-links";

const PARENT = Session.SessionId.make("ses_parent");

const step = (input: {
  readonly key: string;
  readonly state?: TurnStep["state"];
  readonly role?: string;
  readonly childId?: string;
}): TurnStep => ({
  key: input.key,
  name: "task",
  verb: "Working",
  detail: "Do the thing",
  state: input.state ?? "ok",
  output: "",
  patch: null,
  content: null,
  added: 0,
  removed: 0,
  readShaped: false,
  taskRole: input.role ?? null,
  taskChildId: input.childId ?? null,
});

const child = (input: {
  readonly id: string;
  readonly role?: string;
  readonly phase?: Session.Phase;
  readonly createdAt?: string;
  readonly parent?: string;
}): Session.SessionSummary =>
  sessionSummary({
    id: input.id,
    workspaceId: "ws_1",
    directory: "/repo",
    createdAt: input.createdAt ?? "2026-08-05T10:00:00.000Z",
    phase: input.phase ?? "idle",
    updatedAt: input.createdAt ?? "2026-08-05T10:00:00.000Z",
    delegation: { delegationOf: input.parent ?? PARENT, role: input.role ?? "sidekick" },
  });

const project = (
  steps: readonly TurnStep[],
  sessions: readonly Session.SessionSummary[],
): ReadonlyMap<string, { child: Session.SessionSummary; ownsLiveState: boolean; state: string }> =>
  projectTaskLinks({ steps, sessions, parentId: PARENT });

describe("task child resolution", () => {
  it("the settled result's sessionId is authoritative and resolves only to a real child", () => {
    const links = project(
      [step({ key: "s1", childId: "ses_current", role: "sidekick" })],
      [child({ id: "ses_current" }), child({ id: "ses_other" })],
    );
    expect(links.get("s1")?.child.id).toBe("ses_current");
  });

  it("an explicit id that resolves to nothing omits the link, never a substitute", () => {
    const links = project(
      [step({ key: "s1", childId: "ses_missing", role: "sidekick" })],
      [child({ id: "ses_other" })],
    );
    expect(links.has("s1")).toBe(false);
  });

  it("a running call reverse-joins the single child born with its role", () => {
    const links = project(
      [step({ key: "s1", state: "running", role: "explorer" })],
      [
        child({ id: "ses_match", role: "explorer", phase: "turn" }),
        child({ id: "ses_other", role: "sidekick" }),
        child({ id: "ses_foreign", role: "explorer", parent: "ses_someone_else" }),
      ],
    );
    expect(links.get("s1")?.child.id).toBe("ses_match");
  });

  it("skips children another call already claims, so the first sidekick call stays unambiguous", () => {
    const links = project(
      [
        step({ key: "s_abandoned", childId: "ses_abandoned" }),
        step({ key: "s_first", state: "running", role: "sidekick" }),
      ],
      [child({ id: "ses_abandoned" }), child({ id: "ses_fresh", phase: "turn" })],
    );
    expect(links.get("s_abandoned")?.child.id).toBe("ses_abandoned");
    expect(links.get("s_first")?.child.id).toBe("ses_fresh");
  });

  it("omits the link when creation order cannot break a same-role tie", () => {
    const links = project(
      [step({ key: "s1", state: "running", role: "sidekick" })],
      [
        child({ id: "ses_one", createdAt: "2026-08-05T10:00:00.000Z" }),
        child({ id: "ses_two", createdAt: "2026-08-05T10:00:00.000Z" }),
      ],
    );
    expect(links.has("s1")).toBe(false);
  });

  it("the newest same-role session wins a running one-shot join", () => {
    const links = project(
      [step({ key: "s1", state: "running", role: "sidekick" })],
      [
        child({ id: "ses_old", createdAt: "2026-08-05T10:00:00.000Z" }),
        child({ id: "ses_new", createdAt: "2026-08-05T11:00:00.000Z", phase: "turn" }),
      ],
    );
    expect(links.get("s1")?.child.id).toBe("ses_new");
  });

  it("a settled call with no recorded child never joins by role", () => {
    const links = project([step({ key: "s1", role: "sidekick" })], [child({ id: "ses_only" })]);
    expect(links.has("s1")).toBe(false);
  });

  it("two settled same-role delegations never cross-link", () => {
    const links = project(
      [
        step({ key: "s1", childId: "ses_a", role: "sidekick" }),
        step({ key: "s2", childId: "ses_b", role: "sidekick" }),
      ],
      [child({ id: "ses_a" }), child({ id: "ses_b" })],
    );
    expect(links.get("s1")?.child.id).toBe("ses_a");
    expect(links.get("s2")?.child.id).toBe("ses_b");
  });
});

describe("task link state", () => {
  it("only the newest call for a reused child owns its live state", () => {
    const steps = [
      step({ key: "s_old", childId: "ses_child" }),
      step({ key: "s_new", childId: "ses_child" }),
    ];
    const at = (phase: Session.Phase) => project(steps, [child({ id: "ses_child", phase })]);

    expect(at("turn").get("s_old")).toMatchObject({ ownsLiveState: false, state: "done" });
    expect(at("turn").get("s_new")).toMatchObject({ ownsLiveState: true, state: "running" });
    expect(at("idle").get("s_new")).toMatchObject({ ownsLiveState: true, state: "done" });
    expect(at("idle").get("s_old")).toMatchObject({ ownsLiveState: false, state: "done" });
  });

  it("a failed or still-running call keeps its own state regardless of child phase", () => {
    const links = project(
      [
        step({ key: "s_error", childId: "ses_child", state: "error" }),
        step({ key: "s_running", childId: "ses_child", state: "running" }),
      ],
      [child({ id: "ses_child", phase: "idle" })],
    );
    expect(links.get("s_error")).toMatchObject({ ownsLiveState: false, state: "failed" });
    expect(links.get("s_running")).toMatchObject({ ownsLiveState: true, state: "running" });
  });

  it("ignores non-task steps entirely", () => {
    const bash: TurnStep = { ...step({ key: "s1" }), name: "bash", taskRole: null };
    expect(project([bash], [child({ id: "ses_child" })]).size).toBe(0);
  });
});
