import { act, type ChangeEvent, type KeyboardEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { Session } from "@honk/core/session";

import { mountTestElement } from "../test-dom";
import type { ComposerMessage } from "./composer-store";
import { InlineMessageEdit } from "./inline-message-edit";
import type { ActiveMessageEdit } from "./message-edit";

interface HarnessMessage {
  readonly text: string;
  readonly images: readonly { readonly data: string; readonly mimeType: string }[];
}

interface EditorHarness {
  readonly chooseImages: Mock;
  readonly reconcile: Mock;
  initialMessage: HarnessMessage | null;
  menuOpen: boolean | null;
}

const editorHarness = vi.hoisted<EditorHarness>(() => ({
  chooseImages: vi.fn(),
  reconcile: vi.fn(),
  initialMessage: null,
  menuOpen: null,
}));

vi.mock("./composer-editor", async () => {
  const React = await import("react");
  type Image = { readonly data: string; readonly mimeType: string };
  type Message = { readonly text: string; readonly images: readonly Image[] };
  type Handle = {
    readonly focus: () => void;
    readonly insertMention: () => void;
    readonly insertResource: () => void;
    readonly insertText: () => void;
    readonly appendText: () => void;
    readonly read: () => Message & { readonly resource: null };
    readonly replace: (message: Message) => void;
    readonly reconcile: (message: Message) => void;
    readonly chooseImages: () => void;
    readonly clear: () => void;
    readonly triggerRect: () => null;
  };
  type Props = {
    readonly handleRef: { current: Handle | null };
    readonly initialText: string;
    readonly initialImages: readonly Image[];
    readonly placeholder: string;
    readonly ariaLabel: string;
    readonly autoFocus?: boolean;
    readonly readOnly?: boolean;
    readonly onChange: (message: Message, caret: number) => void;
    readonly onImageReadPendingChange: (pending: boolean) => void;
    readonly onEscape?: () => void;
    readonly menu: { readonly open: boolean } | null;
  };

  return {
    ComposerEditor: (props: Props) => {
      const messageRef = React.useRef<Message>({
        text: props.initialText,
        images: props.initialImages,
      });
      editorHarness.initialMessage = messageRef.current;
      editorHarness.menuOpen = props.menu?.open ?? null;
      React.useEffect(() => {
        props.onImageReadPendingChange(false);
        return () => {
          props.onImageReadPendingChange(false);
        };
      }, [props.onImageReadPendingChange]);
      React.useImperativeHandle(props.handleRef, () => ({
        focus: () => undefined,
        insertMention: () => undefined,
        insertResource: () => undefined,
        insertText: () => undefined,
        appendText: () => undefined,
        read: () => ({ ...messageRef.current, resource: null }),
        replace: (message) => {
          messageRef.current = message;
        },
        reconcile: (message) => {
          messageRef.current = message;
          editorHarness.reconcile(message);
        },
        chooseImages: editorHarness.chooseImages,
        clear: () => {
          messageRef.current = { text: "", images: [] };
        },
        triggerRect: () => null,
      }));
      return React.createElement("textarea", {
        placeholder: props.placeholder,
        "aria-label": props.ariaLabel,
        autoFocus: props.autoFocus,
        readOnly: props.readOnly,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
          const value = event.currentTarget.value;
          const next = { ...messageRef.current, text: value };
          messageRef.current = next;
          props.onChange(next, value.length);
        },
        onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === "Escape") props.onEscape?.();
        },
      });
    },
  };
});

vi.mock("./model-menu", async () => {
  const React = await import("react");
  return {
    CoreModelSelector: (props: {
      readonly selection: ActiveMessageEdit["selection"];
      readonly onSelectionChange: (selection: ActiveMessageEdit["selection"]) => void;
    }) =>
      React.createElement(
        "button",
        {
          type: "button",
          "aria-label":
            props.selection.kind === "fusion"
              ? "Model: Fusion"
              : `Model: ${props.selection.model?.modelId ?? "default"}`,
          onClick: () => {
            props.onSelectionChange({
              kind: "model",
              model: { providerId: "faux", modelId: "faux-second" },
              thinkingLevel: "high",
            });
          },
        },
        "Model",
      ),
  };
});

const sessionId = Session.SessionId.make("ses_inline_edit");
const image = { data: "pixel", mimeType: "image/png" };

const editing = (
  message: ComposerMessage,
  error: string | null = null,
): Extract<ActiveMessageEdit, { readonly phase: "editing" }> => ({
  phase: "editing",
  sessionId,
  entryId: "entry-original",
  message,
  error,
  selection: {
    kind: "model",
    model: { providerId: "faux", modelId: "faux-first" },
    thinkingLevel: "medium",
  },
  selectionChanged: false,
});

beforeEach(() => {
  editorHarness.chooseImages.mockReset();
  editorHarness.reconcile.mockReset();
  editorHarness.initialMessage = null;
  editorHarness.menuOpen = null;
});

describe("inline message edit", () => {
  it("opens the committed message in the shared plain-message editor and cancels with Escape", async () => {
    const onChange = vi.fn();
    const onCancel = vi.fn();
    const panel = await mountTestElement(
      <InlineMessageEdit
        edit={editing({ text: "Original question", images: [image] })}
        running={false}
        available
        onChange={onChange}
        onSelectionChange={vi.fn()}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );

    expect(editorHarness.initialMessage).toEqual({ text: "Original question", images: [image] });
    expect(editorHarness.menuOpen).toBeNull();
    expect(panel.labels()).toEqual(
      expect.arrayContaining(["Edit message", "Add images", "Save and rerun"]),
    );
    expect(panel.propsOf("textarea").autoFocus).toBe(true);

    await act(async () => {
      panel.invoke("textarea", "onChange", { currentTarget: { value: "Revised question" } });
      panel.invoke("textarea", "onKeyDown", { key: "Escape" });
    });

    expect(onChange).toHaveBeenCalledWith({ text: "Revised question", images: [image] });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledWith("escape");
    expect(panel.text()).not.toContain("Cancel");
    await panel.unmount();
  });

  it("keeps a one-line edit and its fixed controls in one compact row", () => {
    const html = renderToStaticMarkup(
      <InlineMessageEdit
        edit={editing({ text: "hi", images: [] })}
        running={false}
        available
        onChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('data-inline-message-edit-row=""');
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('data-inline-message-edit-controls=""');
    expect(html).toContain('aria-label="Model: faux-first"');
    expect(html).toContain('aria-label="Add images"');
    expect(html).toContain('aria-label="Save and rerun"');
    expect(html).not.toContain("Cancel");
  });

  it("keeps model selection local to the edit intent", async () => {
    const onSelectionChange = vi.fn();
    const panel = await mountTestElement(
      <InlineMessageEdit
        edit={editing({ text: "hi", images: [] })}
        running={false}
        available
        onChange={vi.fn()}
        onSelectionChange={onSelectionChange}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await act(async () => {
      panel.invokeLabel("Model: faux-first", "onClick", {});
    });

    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "model",
      model: { providerId: "faux", modelId: "faux-second" },
      thinkingLevel: "high",
    });
    await panel.unmount();
  });

  it("does not dismiss while focus is inside the portaled model menu", async () => {
    const onCancel = vi.fn();
    const addListener = vi.spyOn(document, "addEventListener");
    const contains = vi.spyOn(HTMLElement.prototype, "contains").mockReturnValue(false);
    const panel = await mountTestElement(
      <InlineMessageEdit
        edit={editing({ text: "hi", images: [] })}
        running={false}
        available
        onChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );

    try {
      const listener = addListener.mock.calls.find(
        ([type, _listener, options]) => type === "focusin" && options === true,
      )?.[1];
      if (!(listener instanceof Function)) throw new Error("Expected focusin capture listener");
      const target = document.createElement("button");
      target.setAttribute("data-message-edit-control", "");
      const event = new Event("focusin");
      Object.defineProperty(event, "target", { value: target });
      await act(async () => {
        listener(event);
      });

      expect(onCancel).not.toHaveBeenCalled();
      await panel.unmount();
    } finally {
      contains.mockRestore();
      addListener.mockRestore();
    }
  });

  it.each(["pointerdown", "focusin"])(
    "cancels once when %s moves outside the edit",
    async (eventType) => {
      const onCancel = vi.fn();
      const addListener = vi.spyOn(document, "addEventListener");
      const removeListener = vi.spyOn(document, "removeEventListener");
      const contains = vi.spyOn(HTMLElement.prototype, "contains").mockReturnValue(true);
      const panel = await mountTestElement(
        <InlineMessageEdit
          edit={editing({ text: "hi", images: [] })}
          running={false}
          available
          onChange={vi.fn()}
          onSelectionChange={vi.fn()}
          onCancel={onCancel}
          onSubmit={vi.fn()}
        />,
      );

      try {
        const listener = addListener.mock.calls.find(
          ([type, _listener, options]) => type === eventType && options === true,
        )?.[1];
        if (!(listener instanceof Function)) {
          throw new Error(`Expected ${eventType} capture listener`);
        }
        const event = new Event(eventType);
        Object.defineProperty(event, "target", { value: document.createElement("button") });
        await act(async () => {
          listener(event);
        });
        expect(onCancel).not.toHaveBeenCalled();

        contains.mockReturnValue(false);
        await act(async () => {
          listener(event);
          listener(event);
        });

        expect(onCancel).toHaveBeenCalledOnce();
        expect(onCancel).toHaveBeenCalledWith("outside");
        await panel.unmount();
        expect(removeListener).toHaveBeenCalledWith(eventType, listener, true);
      } finally {
        contains.mockRestore();
        removeListener.mockRestore();
        addListener.mockRestore();
      }
    },
  );

  it("submits an image-only revision and exposes the image picker", async () => {
    const onSubmit = vi.fn();
    const panel = await mountTestElement(
      <InlineMessageEdit
        edit={editing({ text: "", images: [image] })}
        running={false}
        available
        onChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await act(async () => {
      panel.invokeLabel("Add images", "onClick", {});
      panel.invoke("form", "onSubmit", { preventDefault: () => undefined });
    });

    expect(editorHarness.chooseImages).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ text: "", images: [image] });
    await panel.unmount();
  });

  it("keeps the draft editable but disables save while another run is active", async () => {
    const onSubmit = vi.fn();
    const edit = editing({ text: "Keep this revision", images: [] }, "Previous save was refused");
    const html = renderToStaticMarkup(
      <InlineMessageEdit
        edit={edit}
        running
        available
        onChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(html).toContain("Wait for the current run to finish");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Previous save was refused");
    expect(html).toMatch(
      /(?:aria-label="Save and rerun"[^>]*disabled|disabled[^>]*aria-label="Save and rerun")/,
    );

    const panel = await mountTestElement(
      <InlineMessageEdit
        edit={edit}
        running
        available
        onChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await act(async () => {
      panel.invoke("form", "onSubmit", { preventDefault: () => undefined });
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(panel.propsOf("textarea").readOnly).not.toBe(true);
    await panel.unmount();

    const unavailable = renderToStaticMarkup(
      <InlineMessageEdit
        edit={edit}
        running={false}
        available={false}
        onChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(unavailable).toContain("Reconnect to save this edit");
    expect(unavailable).toMatch(
      /(?:aria-label="Save and rerun"[^>]*disabled|disabled[^>]*aria-label="Save and rerun")/,
    );
  });
});
