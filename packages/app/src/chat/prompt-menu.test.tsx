import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const interactionWiring = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock("./prompt-menu-interaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prompt-menu-interaction")>();
  return {
    ...actual,
    promptMenuItemInteractionProps: <Item extends { readonly key: string }>(
      item: Item,
      onSelect: (selected: Item) => void,
      highlighted: boolean,
      pointerDownItemKey: { current: string | null },
    ) => {
      interactionWiring.record(item, onSelect, highlighted, pointerDownItemKey);
      return {
        ...actual.promptMenuItemInteractionProps(item, onSelect, highlighted, pointerDownItemKey),
        "data-prompt-menu-interaction": "wired",
      };
    },
  };
});

vi.mock("@honk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@honk/ui")>();
  return {
    ...actual,
    Popover: {
      ...actual.Popover,
      Root: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
      Popup: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
    },
  };
});

import {
  PromptMenu,
  PromptMenuItemIcon,
  type PromptMenuItem,
  PromptMenuPathPreview,
} from "./prompt-menu";
import { promptMenuItemInteractionProps } from "./prompt-menu-interaction";

const file: PromptMenuItem = {
  key: "file:config/settings.json",
  title: "settings.json",
  detail: "config/settings.json",
  kind: "file",
  path: "config/settings.json",
};

const ZERO_RECT: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
};

interface PreventableEvent {
  readonly preventDefault: () => void;
}

interface ButtonEvent {
  readonly button: number;
}

function invokeEvent(handler: Function, event: PreventableEvent | ButtonEvent): void {
  Reflect.apply(handler, undefined, [event]);
}

describe("composer prompt menu", () => {
  it("renders Pierre file identity in a file suggestion row", () => {
    const html = renderToStaticMarkup(<PromptMenuItemIcon item={file} />);

    expect(html).toContain('data-icon-token="json"');
    expect(html).toContain('data-icon-name="file-tree-builtin-json"');
  });

  it("renders the same Pierre file identity in the path preview", () => {
    const html = renderToStaticMarkup(<PromptMenuPathPreview item={file} />);

    expect(html).toContain("config");
    expect(html).toContain("settings.json");
    expect(html).toContain('data-icon-token="json"');
    expect(html).toContain('data-icon-name="file-tree-builtin-json"');
  });

  it("wires the press-preserving interaction contract into each rendered option", () => {
    interactionWiring.record.mockClear();
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(
      <PromptMenu
        anchor={{ getBoundingClientRect: () => ZERO_RECT }}
        items={[file]}
        selectedIndex={0}
        placement="above"
        emptyLabel="No suggestions"
        isLoading={false}
        listboxId="composer-suggestions"
        onSelect={onSelect}
        onHighlight={vi.fn()}
        isKeyboardNavigation={false}
      />,
    );

    expect(html).toContain('data-prompt-menu-interaction="wired"');
    expect(interactionWiring.record).toHaveBeenCalledWith(
      file,
      onSelect,
      true,
      expect.objectContaining({ current: null }),
    );
  });

  it("surfaces a truncated search in the footer copy", () => {
    const html = renderToStaticMarkup(
      <PromptMenu
        anchor={{ getBoundingClientRect: () => ZERO_RECT }}
        items={[file]}
        selectedIndex={0}
        placement="above"
        emptyLabel="No suggestions"
        footer="More matches than shown — keep typing to narrow"
        isLoading={false}
        listboxId="composer-suggestions"
        onSelect={vi.fn()}
        onHighlight={vi.fn()}
        isKeyboardNavigation={false}
      />,
    );

    expect(html).toContain("More matches than shown — keep typing to narrow");
  });

  it("preserves the editor selection through press and selects once on click", () => {
    const preventDefault = vi.fn();
    const onSelect = vi.fn();
    const pointerDownItemKey = { current: null };
    const interaction = promptMenuItemInteractionProps(file, onSelect, true, pointerDownItemKey);

    invokeEvent(interaction.onPointerDownCapture, { preventDefault });
    invokeEvent(interaction.onMouseDown, { preventDefault });
    // A highlight/item update can rerender the menu between press phases. The shared ref preserves
    // pointer origin across the new handler object.
    invokeEvent(
      promptMenuItemInteractionProps(file, onSelect, true, pointerDownItemKey).onMouseUp,
      { button: 0 },
    );

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();

    interaction.onClick();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it("selects on mouseup only when a press started elsewhere over the highlighted row", () => {
    const onSelect = vi.fn();

    invokeEvent(
      promptMenuItemInteractionProps(file, onSelect, false, { current: null }).onMouseUp,
      {
        button: 0,
      },
    );
    invokeEvent(promptMenuItemInteractionProps(file, onSelect, true, { current: null }).onMouseUp, {
      button: 1,
    });
    expect(onSelect).not.toHaveBeenCalled();

    invokeEvent(promptMenuItemInteractionProps(file, onSelect, true, { current: null }).onMouseUp, {
      button: 0,
    });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(file);
  });
});
