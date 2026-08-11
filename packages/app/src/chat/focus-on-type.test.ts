import { describe, expect, it } from "vitest";

import {
  PROTECTED_TARGET_SELECTORS,
  SPACE_ACTIVATED_TARGET_SELECTORS,
  protectedTarget,
  qualifiesForSteal,
} from "./focus-on-type";

interface StealKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
  readonly defaultPrevented: boolean;
}

const key = (overrides: Partial<StealKey> = {}): StealKey => ({
  key: "a",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 65,
  defaultPrevented: false,
  ...overrides,
});

// A stand-in for document.activeElement: closest() answers by membership in
// the joined selector list the guard actually passes.
interface ClosestTarget {
  readonly closest: (selectors: string) => object | null;
}

const activeElement = (matched: readonly string[]): ClosestTarget => ({
  closest: (selectors) =>
    matched.some((entry) => selectors.split(", ").includes(entry)) ? {} : null,
});

function invokeProtectedTarget(active: ClosestTarget | null, keyValue: string): boolean {
  const invoke: Function = protectedTarget;
  return Reflect.apply(invoke, undefined, [active, keyValue]);
}

describe("focus-on-type guard table", () => {
  it("pins the released protected-target table, all eighteen selectors", () => {
    expect(PROTECTED_TARGET_SELECTORS).toEqual([
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
    ]);
  });

  it("pins the space-activated set", () => {
    expect(SPACE_ACTIVATED_TARGET_SELECTORS).toEqual([
      "button",
      "a[href]",
      "summary",
      '[role="button"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]',
      '[role="link"]',
    ]);
  });

  it("every protected target keeps its own keystrokes", () => {
    for (const selector of PROTECTED_TARGET_SELECTORS) {
      expect(invokeProtectedTarget(activeElement([selector]), "a")).toBe(true);
    }
  });

  it("space-activated controls keep only the space key", () => {
    for (const selector of SPACE_ACTIVATED_TARGET_SELECTORS) {
      expect(invokeProtectedTarget(activeElement([selector]), " ")).toBe(true);
      expect(invokeProtectedTarget(activeElement([selector]), "a")).toBe(false);
    }
  });

  it("no active element means nothing is protected", () => {
    expect(invokeProtectedTarget(null, "a")).toBe(false);
    expect(invokeProtectedTarget(activeElement([]), "a")).toBe(false);
  });
});

describe("focus-on-type keystroke qualification", () => {
  it("steals plain printable keys", () => {
    expect(qualifiesForSteal(key(), true)).toBe(true);
    expect(qualifiesForSteal(key({ key: "@", keyCode: 50 }), true)).toBe(true);
    expect(qualifiesForSteal(key({ key: " ", keyCode: 32 }), true)).toBe(true);
  });

  it("never steals named keys or modifier chords", () => {
    expect(qualifiesForSteal(key({ key: "Enter", keyCode: 13 }), true)).toBe(false);
    expect(qualifiesForSteal(key({ key: "ArrowUp", keyCode: 38 }), true)).toBe(false);
    expect(qualifiesForSteal(key({ metaKey: true }), true)).toBe(false);
    expect(qualifiesForSteal(key({ ctrlKey: true }), true)).toBe(false);
    expect(qualifiesForSteal(key({ altKey: true }), true)).toBe(false);
  });

  it("steals the paste chord so focus moves and the native paste lands", () => {
    expect(qualifiesForSteal(key({ key: "v", metaKey: true }), true)).toBe(true);
    expect(qualifiesForSteal(key({ key: "V", ctrlKey: true }), true)).toBe(true);
    expect(qualifiesForSteal(key({ key: "v", metaKey: true, altKey: true }), true)).toBe(false);
  });

  it("defers to IME composition, handled events, and an unfocused document", () => {
    expect(qualifiesForSteal(key({ isComposing: true }), true)).toBe(false);
    expect(qualifiesForSteal(key({ keyCode: 229 }), true)).toBe(false);
    expect(qualifiesForSteal(key({ defaultPrevented: true }), true)).toBe(false);
    expect(qualifiesForSteal(key(), false)).toBe(false);
  });
});
