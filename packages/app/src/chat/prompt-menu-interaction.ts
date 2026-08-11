import type { MouseEvent, PointerEvent } from "react";

export function promptMenuItemInteractionProps<Item>(
  item: Item & { readonly key: string },
  onSelect: (item: Item) => void,
  highlighted: boolean,
  pointerDownItemKey: { current: string | null },
): {
  readonly onPointerDownCapture: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerCancel: () => void;
  readonly onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onClick: () => void;
  readonly onMouseUp: (event: MouseEvent<HTMLButtonElement>) => void;
} {
  // Base UI's combobox contract: preserve the input selection during every press phase, then
  // commit on click. Mouseup covers a press that started elsewhere and ended over the highlighted
  // option, which does not receive a click; a press that becomes a drag or scroll never commits.
  return {
    onPointerDownCapture: (event) => {
      pointerDownItemKey.current = item.key;
      event.preventDefault();
    },
    onPointerCancel: () => {
      if (pointerDownItemKey.current === item.key) pointerDownItemKey.current = null;
    },
    onMouseDown: (event) => {
      event.preventDefault();
    },
    onClick: () => {
      onSelect(item);
    },
    onMouseUp: (event) => {
      const pointerStartedOnItem = pointerDownItemKey.current === item.key;
      pointerDownItemKey.current = null;
      if (event.button !== 0 || pointerStartedOnItem || !highlighted) return;
      onSelect(item);
    },
  };
}
