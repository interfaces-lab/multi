// Ported from the released composer (f3965987e composer/focus-on-type.ts):
// stray printable keystrokes route into the prompt editor, the way Cursor's
// composer does. Window scope is hard-coded — this build has no scoped side
// surfaces — and the guard table ports whole.

import * as React from "react";

// Fields, popup layers, and typeahead surfaces keep their own keystrokes.
export const PROTECTED_TARGET_SELECTORS: readonly string[] = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-slot="popover"]',
  '[data-slot^="picker-"]',
  "[data-directory-picker]",
];
const PROTECTED_TARGETS = PROTECTED_TARGET_SELECTORS.join(", ");

// Space activates a focused control; only letters and symbols fall through to the composer.
export const SPACE_ACTIVATED_TARGET_SELECTORS: readonly string[] = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="link"]',
];
const SPACE_ACTIVATED_TARGETS = SPACE_ACTIVATED_TARGET_SELECTORS.join(", ");

/** What the stolen keystroke lands in: focus for a paste chord, text for a key. */
export interface FocusOnTypeEditor {
  readonly focus: () => void;
  readonly insertText: (text: string) => void;
}

type StealKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "isComposing" | "keyCode" | "defaultPrevented"
>;

/**
 * Route stray printable keystrokes into the prompt editor: when no field owns
 * the keyboard, typing focuses the composer and the first character lands in
 * the draft. Paste chords only move focus so the native paste reaches the
 * editor untouched.
 */
export function useFocusOnType(editorRef: React.RefObject<FocusOnTypeEditor | null>): void {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!qualifiesForSteal(event, document.hasFocus())) return;
      const active = document.activeElement;
      if (protectedTarget(active, event.key)) return;
      const editor = editorRef.current;
      if (editor === null) return;

      if (event.metaKey || event.ctrlKey) {
        // Paste chord: focus only, so the browser delivers the paste event to the editor.
        editor.focus();
        return;
      }
      editor.insertText(event.key);
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editorRef]);
}

export function qualifiesForSteal(event: StealKey, hasFocus: boolean): boolean {
  if (event.defaultPrevented) return false;
  // Explicit IME guard: mid-composition keys must never leak into the editor.
  if (event.isComposing || event.keyCode === 229) return false;
  if (!hasFocus) return false;
  const pasteChord =
    event.key.toLowerCase() === "v" && (event.metaKey || event.ctrlKey) && !event.altKey;
  if (pasteChord) return true;
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

export function protectedTarget(active: Pick<Element, "closest"> | null, key: string): boolean {
  if (active === null || active === globalThis.document?.body) return false;
  if (active.closest(PROTECTED_TARGETS) !== null) return true;
  return key === " " && active.closest(SPACE_ACTIVATED_TARGETS) !== null;
}
