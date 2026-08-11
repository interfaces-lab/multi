// The delegation row's pinned rules: mission and role, a stable status word
// in the accessible name, no raw arguments or output in any state, and a
// child transcript that mounts only while the row is open — a collapsed row
// creates no child session handle.

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Session } from "@honk/core/session";

import {
  assistantMessageEntry,
  sessionSummary,
  toolResultMessageEntry,
  userMessageEntry,
} from "../test-fixtures";
import { conversationItems, type TurnStep } from "./chat-model";
import type { TaskLink } from "./task-links";
import { TaskRow, WAITING_PLANNING_LABEL } from "./task-row";
import { ChatTranscript } from "./transcript";

const PROMPT = "Audit the store.\nRead every file and report the findings verbatim.";

const step = (input: {
  readonly state?: TurnStep["state"];
  readonly output?: string;
}): TurnStep => ({
  key: "call_1",
  name: "task",
  verb: "Working",
  detail: "Audit the store.",
  state: input.state ?? "running",
  output: input.output ?? "",
  patch: null,
  content: null,
  added: 0,
  removed: 0,
  readShaped: false,
  taskRole: "sidekick",
  taskChildId: null,
});

const link = (input?: {
  readonly state?: TaskLink["state"];
  readonly ownsLiveState?: boolean;
}): TaskLink => ({
  child: sessionSummary({
    id: "ses_child",
    workspaceId: "ws_1",
    directory: "/repo",
    createdAt: "2026-08-05T10:00:00.000Z",
    phase: "turn",
    updatedAt: "2026-08-05T10:00:00.000Z",
    delegation: { delegationOf: "ses_parent", role: "sidekick" },
  }),
  ownsLiveState: input?.ownsLiveState ?? true,
  state: input?.state ?? "running",
});

const renderRow = async (props: {
  readonly step: TurnStep;
  readonly link: TaskLink | null;
  readonly isExpanded: boolean;
  readonly isThreadRunning?: boolean;
}): Promise<string> => {
  const rootRoute = createRootRoute({
    component: () => (
      <TaskRow
        step={props.step}
        link={props.link}
        isThreadRunning={props.isThreadRunning ?? true}
        isExpanded={props.isExpanded}
        onToggle={() => undefined}
      />
    ),
  });
  const router = createRouter({
    defaultStructuralSharing: true,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute,
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
};

describe("the delegation row", () => {
  it("shows the mission and role, never the raw arguments or result blob", async () => {
    for (const html of await Promise.all([
      renderRow({ step: step({}), link: link(), isExpanded: false }),
      renderRow({
        step: step({ state: "ok", output: '{"blob":true}' }),
        link: null,
        isExpanded: false,
      }),
      renderRow({
        step: step({ state: "error", output: "boom" }),
        link: link({ state: "failed" }),
        isExpanded: false,
      }),
    ])) {
      expect(html).toContain("Audit the store.");
      expect(html).toContain("sidekick");
      expect(html).not.toContain("subagent_type");
      expect(html).not.toContain("Read every file");
      expect(html).not.toContain("blob");
    }
  });

  it("keeps a stable status word in the accessible name, not the live activity", async () => {
    const html = await renderRow({ step: step({}), link: link(), isExpanded: false });
    expect(html).toContain(
      'aria-label="Audit the store., sidekick. In progress. Open work details"',
    );
    expect(html).not.toContain('aria-label="Audit the store., sidekick. Planning next moves');
  });

  it("a collapsed linked row mounts no child transcript and no child handle", async () => {
    const html = await renderRow({ step: step({}), link: link(), isExpanded: false });
    expect(html).not.toContain("Open as thread");
    expect(html).not.toContain("data-task-child-transcript");
    expect(html).not.toContain("Opening…");
  });

  it("an open linked row offers the thread link over the inline transcript", async () => {
    const html = await renderRow({
      step: step({ state: "ok" }),
      link: link({ state: "done" }),
      isExpanded: true,
    });
    expect(html).toContain("Open as thread");
    // The child watch has not answered yet in a static render.
    expect(html).toContain("Opening…");
    // The toggle points at the region it folds open, or the fold is silent to
    // a screen reader.
    expect(html).toContain('aria-controls="task-region:call_1"');
    expect(html).toContain('id="task-region:call_1"');
  });

  it("settles a row that reads running but does not own the child's live state", async () => {
    const stale = { step: step({}), link: link({ ownsLiveState: false }) };

    // While the thread still runs, the row has no grounds to overrule itself.
    const live = await renderRow({ ...stale, isExpanded: false, isThreadRunning: true });
    expect(live).toContain("In progress");

    // Once the thread settles, a row that never owned the live state cannot
    // still be running; it would otherwise read "In progress" forever.
    const settled = await renderRow({ ...stale, isExpanded: false, isThreadRunning: false });
    expect(settled).toContain("Completed");
    expect(settled).not.toContain("In progress");
    expect(settled).not.toContain(WAITING_PLANNING_LABEL);
  });

  it("an unlinked failed task hides its error until toggled, then shows it inline", async () => {
    const failed = step({ state: "error", output: "delegation failed, the child broke" });
    const collapsed = await renderRow({ step: failed, link: null, isExpanded: false });
    expect(collapsed).toContain("Show failure details");
    expect(collapsed).not.toContain("the child broke");

    const open = await renderRow({ step: failed, link: null, isExpanded: true });
    expect(open).toContain("the child broke");
  });

  it("an unlinked settled task folds its result text in as prose", async () => {
    const settled = step({ state: "ok", output: "All findings reported." });
    const open = await renderRow({ step: settled, link: null, isExpanded: true });
    expect(open).toContain("All findings reported.");
  });
});

describe("the transcript's task branch", () => {
  it("renders a task step as a delegation row, not a generic tool row", () => {
    const entries: readonly Session.SessionTreeEntry[] = [
      userMessageEntry("u1", "delegate it"),
      assistantMessageEntry("a1", [
        {
          type: "toolCall",
          id: "c1",
          name: "task",
          arguments: { subagent_type: "sidekick", prompt: PROMPT },
        },
      ]),
      toolResultMessageEntry({
        id: "t1",
        toolCallId: "c1",
        toolName: "task",
        text: "All done.",
        details: { sessionId: "ses_child" },
      }),
    ];

    const html = renderToStaticMarkup(
      <ChatTranscript
        items={conversationItems(entries, null)}
        running={false}
        ticker={{ kind: "idle" }}
        density="detailed"
        onGitAction={() => undefined}
      />,
    );

    expect(html).toContain("Audit the store.");
    expect(html).toContain("sidekick");
    expect(html).toContain("Completed");
    expect(html).not.toContain("subagent_type");
    expect(html).not.toContain("Read every file");
    // The settled result folds in only on demand.
    expect(html).not.toContain("All done.");
  });
});
