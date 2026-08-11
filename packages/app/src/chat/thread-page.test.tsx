import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Session } from "@honk/core/session";

import { initialState, type ChatState } from "./chat-model";
import type { CoreChat } from "./chat-store";
import { mountTestElement } from "../test-dom";
import { ChatThreadPage } from "./thread-page";
import type { ThreadComposerEditContext } from "./thread-composer";
import type { TranscriptMessageEditing } from "./transcript";

type EnabledMessageEditing = Extract<TranscriptMessageEditing, { readonly kind: "enabled" }>;

const threadMocks = vi.hoisted(() => {
  const state: { current: ChatState | null } = { current: null };
  const editing: { current: EnabledMessageEditing | null } = { current: null };
  const composer: {
    mounts: number;
    unmounts: number;
    context: ThreadComposerEditContext | null;
  } = {
    mounts: 0,
    unmounts: 0,
    context: null,
  };
  return {
    state,
    editing,
    editMessage: vi.fn<CoreChat["editMessage"]>(),
    composer,
  };
});

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ sessionId: "ses_pending" }),
}));

vi.mock("../app-settings-store", () => ({
  useConversationDensity: () => "balanced",
}));

vi.mock("../workbench", () => ({
  Workbench: () => <div>Workbench</div>,
}));

vi.mock("../workbench-controller", () => ({
  useWorkbench: () => false,
  workbenchActions: { rememberTab: vi.fn() },
}));

vi.mock("../workbench-tab-store", () => ({
  useWorkbenchTabs: () => ({ expanded: false }),
  workbenchTabActions: { openFile: vi.fn(), openTool: vi.fn() },
}));

vi.mock("./chat-store", () => ({
  markSessionTabVisited: vi.fn(),
  useCoreSession: () => ({
    state: threadMocks.state.current,
    editMessage: threadMocks.editMessage,
    stop: vi.fn(async () => ({ clearedSteer: [], clearedFollowUp: [] })),
    runGitAction: vi.fn(async () => undefined),
  }),
}));

vi.mock("./session-workspace", () => ({
  useSessionWorkspace: () => ({ status: "loading" }),
}));

vi.mock("./thread-composer", async () => {
  const React = await import("react");
  return {
    ThreadComposer: ({ messageEdit }: { readonly messageEdit: ThreadComposerEditContext }) => {
      threadMocks.composer.context = messageEdit;
      React.useEffect(() => {
        threadMocks.composer.mounts += 1;
        return () => {
          threadMocks.composer.unmounts += 1;
        };
      }, []);
      return <div>Thread composer</div>;
    },
  };
});

vi.mock("./transcript", () => ({
  ChatTranscript: ({ messageEditing }: { readonly messageEditing?: TranscriptMessageEditing }) => {
    threadMocks.editing.current = messageEditing?.kind === "enabled" ? messageEditing : null;
    return <div>Thread transcript</div>;
  },
}));

const sessionId = Session.SessionId.make("ses_pending");
const image = { data: "pixel", mimeType: "image/png" };

const readyState = (): ChatState => ({
  ...initialState,
  sessionId,
  status: "ready",
  entries: [
    {
      type: "model_change",
      id: "model-first",
      parentId: null,
      timestamp: "2026-08-09T12:00:00.000Z",
      provider: "faux",
      modelId: "faux-first",
    },
    {
      type: "thinking_level_change",
      id: "thinking-medium",
      parentId: "model-first",
      timestamp: "2026-08-09T12:00:00.001Z",
      thinkingLevel: "medium",
    },
  ],
});

beforeEach(() => {
  threadMocks.state.current = null;
  threadMocks.editing.current = null;
  threadMocks.editMessage.mockReset().mockResolvedValue(undefined);
  threadMocks.composer.mounts = 0;
  threadMocks.composer.unmounts = 0;
  threadMocks.composer.context = null;
});

describe("chat thread opening state", () => {
  it("keeps the opening status visible after the watch attaches but before its first frame", () => {
    threadMocks.state.current = { ...initialState, sessionId };

    const html = renderToStaticMarkup(<ChatThreadPage />);

    expect(html).toContain('aria-label="Opening chat"');
    expect(html).not.toContain("Thread transcript");
    expect(html).not.toContain("Thread composer");
  });
});

describe("chat thread message edit lifecycle", () => {
  it("keeps Reply visible and lets focusing it leave inline editing", async () => {
    threadMocks.state.current = readyState();
    const panel = await mountTestElement(<ChatThreadPage />);
    const target = { entryId: "entry-original", message: { text: "Revision", images: [image] } };

    expect(panel.text()).toContain("Thread composer");
    expect(threadMocks.composer).toMatchObject({ mounts: 1, unmounts: 0 });
    await act(async () => {
      threadMocks.editing.current?.onBegin(target);
    });

    const context = threadMocks.composer.context;
    expect(context?.kind).toBe("editing");
    if (context?.kind !== "editing") throw new Error("Expected editing composer context");
    await act(async () => {
      context.onReplyFocus();
    });

    expect(threadMocks.editing.current?.active).toBeNull();
    expect(threadMocks.composer).toMatchObject({ mounts: 1, unmounts: 0 });
    expect(threadMocks.composer.context).toEqual({ kind: "none" });
    expect(panel.text()).toContain("Thread composer");
    await panel.unmount();
  });

  it("keeps the reply draft owner mounted and restores a refused edit inline", async () => {
    let rejectEdit: ((error: unknown) => void) | undefined;
    const editRequest = new Promise<void>((_resolve, reject) => {
      rejectEdit = reject;
    });
    threadMocks.editMessage.mockReturnValue(editRequest);
    threadMocks.state.current = readyState();
    const panel = await mountTestElement(<ChatThreadPage />);
    const target = { entryId: "entry-original", message: { text: "Revision", images: [image] } };

    expect(threadMocks.composer).toMatchObject({ mounts: 1, unmounts: 0 });
    await act(async () => {
      threadMocks.editing.current?.onBegin(target);
    });
    expect(threadMocks.editing.current?.active?.phase).toBe("editing");
    expect(threadMocks.editing.current?.active).toMatchObject({
      selection: {
        kind: "model",
        model: { providerId: "faux", modelId: "faux-first" },
        thinkingLevel: "medium",
      },
      selectionChanged: false,
    });
    expect(threadMocks.composer).toMatchObject({ mounts: 1, unmounts: 0 });

    await act(async () => {
      threadMocks.editing.current?.onSelectionChange({
        kind: "model",
        model: { providerId: "faux", modelId: "faux-second" },
        thinkingLevel: "high",
      });
    });
    await act(async () => {
      threadMocks.editing.current?.onSubmit(target.message);
    });
    expect(threadMocks.editing.current?.active?.phase).toBe("submitting");
    expect(threadMocks.editMessage).toHaveBeenCalledWith(target.entryId, target.message, {
      model: { providerId: "faux", modelId: "faux-second" },
      thinkingLevel: "high",
    });

    await act(async () => {
      rejectEdit?.(new Error("session.busy"));
      await editRequest.catch(() => undefined);
    });
    expect(threadMocks.editing.current?.active).toMatchObject({
      phase: "editing",
      entryId: target.entryId,
      message: target.message,
      error: "Error: session.busy",
      selection: {
        kind: "model",
        model: { providerId: "faux", modelId: "faux-second" },
        thinkingLevel: "high",
      },
      selectionChanged: true,
    });
    expect(threadMocks.composer).toMatchObject({ mounts: 1, unmounts: 0 });
    await panel.unmount();
  });

  it("trusts core's durable commit marker instead of a stale transcript snapshot", async () => {
    let rejectEdit: ((error: unknown) => void) | undefined;
    const editRequest = new Promise<void>((_resolve, reject) => {
      rejectEdit = reject;
    });
    threadMocks.editMessage.mockReturnValue(editRequest);
    threadMocks.state.current = readyState();
    const panel = await mountTestElement(<ChatThreadPage />);
    const target = { entryId: "entry-original", message: { text: "Revision", images: [image] } };

    await act(async () => {
      threadMocks.editing.current?.onBegin(target);
    });
    await act(async () => {
      threadMocks.editing.current?.onSubmit(target.message);
    });
    await act(async () => {
      rejectEdit?.(
        new Session.EditMessageCommittedError({
          stage: "run",
          reason: "provider unavailable",
        }),
      );
      await editRequest.catch(() => undefined);
    });

    expect(threadMocks.editing.current?.active).toBeNull();
    expect(panel.text()).not.toContain("provider unavailable");
    expect(threadMocks.composer).toMatchObject({ mounts: 1, unmounts: 0 });
    await panel.unmount();
  });
});
