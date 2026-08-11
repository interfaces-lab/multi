// Real mount/effect coverage for the first submit. The editor and menus are
// reduced to inert leaves; the start composer, catalog gate, reducer, Core
// calls, and navigation remain production code.

import type { Ref } from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Models } from "@honk/core/models";
import { Session } from "@honk/core/session";
import { Workspace } from "@honk/core/workspace";

import { mountTestElement, type MountedTestElement } from "../test-dom";
import type { CoreChat } from "./chat-store";
import { ChatComposer } from "./composer";
import type { ComposerEditorHandle } from "./composer-editor";
import { draftKeyOf, readDraft, writeDraft, type ComposerMessage } from "./composer-store";
import type { CatalogPhase } from "./model-catalog";
import type { ModelSelection } from "./selection";
import { NO_SELECTION } from "./selection";
import { ThreadComposer } from "./thread-composer";

interface CreateSessionInput {
  readonly workspaceId: Workspace.WorkspaceId;
  readonly selection: ModelSelection;
}

interface ComposerTestState {
  catalog: CatalogPhase;
  remembered: ModelSelection;
  readonly workspaceOpen: Mock<
    (input: { readonly directory: string }) => Promise<Workspace.OpenResult>
  >;
  readonly createSession: Mock<(input: CreateSessionInput) => Promise<Session.SessionId>>;
  readonly sendInitialPrompt: Mock<
    (sessionId: Session.SessionId, message: ComposerMessage) => void
  >;
  readonly navigate: Mock<(input: unknown) => void>;
  readonly rememberSelection: Mock<(selection: ModelSelection) => void>;
  readonly prompt: Mock<CoreChat["prompt"]>;
  readonly editMessage: Mock<CoreChat["editMessage"]>;
  readonly steer: Mock<CoreChat["steer"]>;
  readonly followUp: Mock<CoreChat["followUp"]>;
  readonly stop: Mock<CoreChat["stop"]>;
  chatRunning: boolean;
  imagePending: boolean;
  readonly editorClear: Mock<() => void>;
  readonly editorFocus: Mock<() => void>;
  readonly editorReplace: Mock<(message: ComposerMessage) => void>;
  readonly editorReconcile: Mock<(message: ComposerMessage) => void>;
}

const state = vi.hoisted(
  (): ComposerTestState => ({
    catalog: { status: "loading" },
    remembered: { kind: "model", model: null, thinkingLevel: null },
    workspaceOpen: vi.fn(),
    createSession: vi.fn(),
    sendInitialPrompt: vi.fn(),
    navigate: vi.fn(),
    rememberSelection: vi.fn(),
    prompt: vi.fn(),
    editMessage: vi.fn(),
    steer: vi.fn(),
    followUp: vi.fn(),
    stop: vi.fn(),
    chatRunning: false,
    imagePending: false,
    editorClear: vi.fn(),
    editorFocus: vi.fn(),
    editorReplace: vi.fn(),
    editorReconcile: vi.fn(),
  }),
);

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));

vi.mock("../desktop-bridge", () => ({
  canPickFolder: () => false,
  pickFolder: vi.fn(async () => null),
}));

vi.mock("./client", () => ({
  describeError: (error: unknown) => String(error),
  getHonkClient: () => ({ workspace: { open: state.workspaceOpen } }),
}));

vi.mock("./chat-controller", () => ({
  createCoreSession: state.createSession,
  sendInitialPrompt: state.sendInitialPrompt,
}));

vi.mock("./chat-store", () => ({
  useCoreSession: () =>
    coreChat({
      prompt: state.prompt,
      editMessage: state.editMessage,
      steer: state.steer,
      followUp: state.followUp,
      stop: state.stop,
    }),
}));
vi.mock("./session-workspace", () => ({
  useSessionWorkspace: () => ({
    status: "ready",
    workspace: { workspaceId: "ws_submit_test", directory: "/tmp/honk-submit-test" },
  }),
}));

vi.mock("./model-catalog", () => ({
  useCatalogPhase: () => state.catalog,
  refreshCatalog: vi.fn(async () => undefined),
}));

vi.mock("./selection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./selection")>();
  return {
    ...actual,
    readModelSelection: () => state.remembered,
    readRecent: () => [],
    rememberRecent: vi.fn(),
    rememberSelection: state.rememberSelection,
  };
});

vi.mock("./model-menu", () => ({ CoreModelSelector: () => null }));
vi.mock("./focus-on-type", () => ({ useFocusOnType: () => undefined }));
vi.mock("./prompt-menu-resource", () => ({ loadPromptMenu: vi.fn() }));
vi.mock("./use-prompt-menu", () => ({
  usePromptMenu: () => ({
    open: false,
    listboxId: "prompt-menu-test",
    selectedIndex: 0,
    anchor: null,
    items: [],
    emptyLabel: "",
    footer: null,
    isLoading: false,
    isKeyboardNavigation: false,
    noteEdit: () => undefined,
    acceptHighlighted: () => undefined,
    dismiss: () => undefined,
    moveSelection: () => undefined,
    accept: () => undefined,
    highlight: () => undefined,
  }),
}));

vi.mock("./composer-editor", async () => {
  const React = await import("react");
  return {
    ComposerEditor: (props: {
      readonly handleRef: Ref<ComposerEditorHandle>;
      readonly placeholder: string;
      readonly ariaLabel: string;
      readonly autoFocus?: boolean;
      readonly initialText: string;
      readonly initialImages: readonly { readonly data: string; readonly mimeType: string }[];
      readonly onImageReadPendingChange: (pending: boolean) => void;
    }) => {
      const message = React.useRef({
        text: props.initialText,
        images: props.initialImages,
        resource: null,
      });
      React.useEffect(() => {
        props.onImageReadPendingChange(state.imagePending);
        return () => {
          props.onImageReadPendingChange(false);
        };
      }, [props.onImageReadPendingChange]);
      React.useImperativeHandle(props.handleRef, () => ({
        focus: state.editorFocus,
        insertMention: () => undefined,
        insertResource: () => undefined,
        insertText: () => undefined,
        appendText: () => undefined,
        read: () => message.current,
        replace: (next) => {
          message.current = { ...next, resource: null };
          state.editorReplace(next);
        },
        reconcile: (next) => {
          message.current = { ...next, resource: null };
          state.editorReconcile(next);
        },
        chooseImages: () => undefined,
        triggerRect: () => null,
        clear: () => {
          message.current = { text: "", images: [], resource: null };
          state.editorClear();
        },
      }));
      return React.createElement("textarea", {
        placeholder: props.placeholder,
        "aria-label": props.ariaLabel,
        autoFocus: props.autoFocus,
      });
    },
  };
});

const provider = (
  id: string,
  configured: boolean,
  modelIds: readonly string[],
): Models.ProviderSummary => ({
  id,
  name: id,
  configured,
  methods: id === "openai-codex" ? ["oauth"] : ["api_key"],
  models: modelIds.map((modelId) => ({ id: modelId, name: modelId })),
});

const ready = (...providers: readonly Models.ProviderSummary[]): void => {
  state.catalog = { status: "ready", providers, error: null };
};

const selection = (providerId: string, modelId: string): ModelSelection => ({
  kind: "model",
  model: { providerId, modelId },
  thinkingLevel: null,
});

const coreChat = (overrides: Partial<CoreChat> = {}): CoreChat => ({
  state: {
    status: state.chatRunning ? "running" : "ready",
    sessionId: Session.SessionId.make("ses_submit_test"),
    entries: [],
    queue: { steer: [], followUp: [], nextTurn: [] },
    turns: [],
    streamingMessage: null,
    thinkingLevel: null,
    model: null,
    fusionStop: null,
    error: null,
  },
  prompt: vi.fn(() => Promise.resolve()),
  editMessage: vi.fn(() => Promise.resolve()),
  steer: vi.fn(() => Promise.resolve()),
  followUp: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve({ clearedSteer: [], clearedFollowUp: [] })),
  runGitAction: vi.fn(() => Promise.resolve()),
  setThinkingLevel: vi.fn(() => Promise.resolve()),
  setModel: vi.fn(() => Promise.resolve()),
  ...overrides,
});

async function submit(panel: MountedTestElement): Promise<void> {
  await act(async () => {
    panel.invoke("form", "onSubmit", { preventDefault: () => undefined });
    await Promise.resolve();
  });
}

async function submitFromDirectory(chosen: ModelSelection): Promise<CreateSessionInput> {
  state.remembered = chosen;
  const panel = await mountTestElement(<ChatComposer directory="/tmp/honk-submit-test" />);
  await submit(panel);
  await vi.waitFor(() => expect(state.createSession).toHaveBeenCalledTimes(1));
  const input = state.createSession.mock.calls[0]?.[0];
  await panel.unmount();
  if (input === undefined) throw new Error("Expected create input");
  return input;
}

beforeEach(() => {
  state.catalog = { status: "loading" };
  state.remembered = NO_SELECTION;
  state.workspaceOpen.mockReset().mockResolvedValue({
    type: "ready",
    id: Workspace.WorkspaceId.make("ws_submit_test"),
    directory: Workspace.WorkspaceDirectory.make("/tmp/honk-submit-test"),
  });
  state.createSession.mockReset().mockResolvedValue(Session.SessionId.make("ses_submit_test"));
  state.sendInitialPrompt.mockReset();
  state.navigate.mockReset();
  state.rememberSelection.mockReset();
  state.chatRunning = false;
  state.imagePending = false;
  state.editorClear.mockReset();
  state.editorFocus.mockReset();
  state.editorReplace.mockReset();
  state.editorReconcile.mockReset();
  state.prompt.mockReset().mockResolvedValue(undefined);
  state.editMessage.mockReset().mockResolvedValue(undefined);
  state.steer.mockReset().mockResolvedValue(undefined);
  state.followUp.mockReset().mockResolvedValue(undefined);
  state.stop.mockReset().mockResolvedValue({ clearedSteer: [], clearedFollowUp: [] });
  writeDraft(draftKeyOf(null), { text: "ship the goose", images: [] });
});

describe("first submit catalog gate", () => {
  const unavailableCatalogs: readonly (readonly [string, CatalogPhase])[] = [
    ["the catalog is loading", { status: "loading" }],
    ["the initial catalog request failed", { status: "failed", message: "offline" }],
    [
      "no provider is configured",
      {
        status: "ready",
        providers: [provider("openai", false, ["gpt-5.6-sol"])],
        error: null,
      },
    ],
  ];

  it.each(unavailableCatalogs)("does nothing while %s", async (_label, catalog) => {
    state.catalog = catalog;
    const panel = await mountTestElement(<ChatComposer />);
    await submit(panel);

    expect(state.workspaceOpen).not.toHaveBeenCalled();
    expect(state.createSession).not.toHaveBeenCalled();
    expect(state.sendInitialPrompt).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    await panel.unmount();
  });
});

describe("pending image reads", () => {
  it("does not start a session before the selected image is part of the message", async () => {
    ready(provider("openai", true, ["gpt-5.6-sol"]));
    state.imagePending = true;
    const panel = await mountTestElement(<ChatComposer directory="/tmp/honk-submit-test" />);
    await submit(panel);

    expect(state.createSession).not.toHaveBeenCalled();
    await panel.unmount();
  });

  it("does not send a thread message before the selected image is ready", async () => {
    state.imagePending = true;
    const panel = await mountTestElement(
      <ThreadComposer sessionId={Session.SessionId.make("ses_pending_image_test")} />,
    );

    await submit(panel);

    expect(state.prompt).not.toHaveBeenCalled();
    await panel.unmount();
  });
});

describe("first submit provider identity", () => {
  it("sends the exact Codex OAuth route when that is the available remembered model", async () => {
    ready(provider("openai-codex", true, ["gpt-5.6-sol"]));
    const chosen = selection("openai-codex", "gpt-5.6-sol");

    expect((await submitFromDirectory(chosen)).selection).toEqual(chosen);
  });

  it("sends the exact OpenAI Platform route when both identities are available", async () => {
    ready(
      provider("openai", true, ["gpt-5.6-sol"]),
      provider("openai-codex", true, ["gpt-5.6-sol"]),
    );
    const chosen = selection("openai", "gpt-5.6-sol");

    expect((await submitFromDirectory(chosen)).selection).toEqual(chosen);
  });

  it("drops a stale Platform route instead of translating it to Codex", async () => {
    ready(provider("openai-codex", true, ["gpt-5.6-sol"]));

    expect((await submitFromDirectory(selection("openai", "gpt-5.6-sol"))).selection).toEqual(
      NO_SELECTION,
    );
  });
});

describe("thread draft restoration", () => {
  it("puts a rejected message and its images back into the mounted editor", async () => {
    const sessionId = Session.SessionId.make("ses_restore_test");
    const image = { data: "pixel", mimeType: "image/png" };
    const message = { text: "keep this", images: [image] };
    writeDraft(draftKeyOf(sessionId), message);
    state.prompt.mockRejectedValue(new Error("session.busy"));
    const panel = await mountTestElement(<ThreadComposer sessionId={sessionId} />);

    await submit(panel);
    await vi.waitFor(() => {
      expect(state.editorReconcile).toHaveBeenCalledWith(message);
    });
    expect(state.prompt).toHaveBeenCalledWith(message);

    await panel.unmount();
    writeDraft(draftKeyOf(sessionId), { text: "", images: [] });
  });

  it("focuses Reply for the edited rerun and keeps its draft clear when Stop returns queues", async () => {
    const sessionId = Session.SessionId.make("ses_edit_stop_test");
    const draftKey = draftKeyOf(sessionId);
    writeDraft(draftKey, { text: "", images: [] });
    state.chatRunning = true;
    state.stop.mockResolvedValue({
      clearedSteer: [
        {
          role: "user",
          content: [
            { type: "text", text: "belongs to the edited rerun" },
            { type: "image", data: "pixel", mimeType: "image/png" },
          ],
          timestamp: 1,
        },
      ],
      clearedFollowUp: [],
    });
    const panel = await mountTestElement(
      <ThreadComposer sessionId={sessionId} messageEdit={{ kind: "submitting", requestId: 1 }} />,
    );

    expect(state.editorFocus).toHaveBeenCalledOnce();
    await act(async () => {
      panel.invokeLabel("Stop", "onClick");
      await Promise.resolve();
    });

    expect(state.stop).toHaveBeenCalledOnce();
    expect(readDraft(draftKey)).toEqual({ text: "", images: [] });
    expect(state.editorReconcile).not.toHaveBeenCalled();
    await panel.unmount();
  });
});
