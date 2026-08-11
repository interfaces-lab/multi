// Per-device appearance. Persists to localStorage and applies --honk-* on <html> via setProperty
// so inline values beat StyleX defineVars defaults (same as packages/ui/dev/dials.ts).
// Apply at action time and once at module init, never in a component effect.

import { useSyncExternalStore } from "react";

import { honkTheme } from "@honk/ui/theme";
import { colorVars, fontVars, workbenchSurfaceVars } from "@honk/ui/tokens.stylex";

import {
  APPEARANCE_STORAGE_KEY,
  readAppearanceBlob,
  type AppearanceSnapshot,
  type FontSmoothing,
  type ThemePreference,
} from "./appearance-blob";
import { fontFamilyCssValue, normalizeFontFamily } from "./font-family";

export type { AppearanceSnapshot, FontSmoothing, ThemePreference } from "./appearance-blob";

export const DEFAULT_APPEARANCE: AppearanceSnapshot = Object.freeze({
  theme: "system",
  tintHue: 210,
  tintIntensity: 0,
  uiFontFamily: null,
  codeFontFamily: null,
  uiFontSize: 13,
  codeFontSize: 12,
  fontSmoothing: "antialiased",
});

export const UI_FONT_MIN = 11;
export const UI_FONT_MAX = 23;
export const CODE_FONT_MIN = 10;
export const CODE_FONT_MAX = 22;

// Glass (backdrop + card) tints on an eased curve of tint intensity: negligible through the
// low/mid range, only reading near the top. Opaque surfaces keep the linear response above.
const GLASS_TINT_EXPONENT = 2.5;

// StyleX defineVars compile to { '--honk-…': 'var(--honk-…)' }. Unwrap the reference
// back to the property name setProperty needs (dials.ts cssVarName).
function cssVarName(reference: unknown): string {
  const match = /^var\((--[^),\s]+)/.exec(String(reference));
  if (match?.[1] === undefined) {
    throw new Error(`appearance-store: not a StyleX var reference: ${String(reference)}`);
  }
  return match[1];
}

const tintColorVars = {
  bgDeep: cssVarName(colorVars["--honk-color-bg-deep"]),
  bgBase: cssVarName(colorVars["--honk-color-bg-base"]),
  layer01: cssVarName(colorVars["--honk-color-layer-01"]),
  layer02: cssVarName(colorVars["--honk-color-layer-02"]),
  layer03: cssVarName(colorVars["--honk-color-layer-03"]),
  layer04: cssVarName(colorVars["--honk-color-layer-04"]),
  tabHover: cssVarName(colorVars["--honk-color-tab-hover"]),
  control: cssVarName(colorVars["--honk-color-control"]),
  controlHover: cssVarName(colorVars["--honk-color-control-hover"]),
  controlPress: cssVarName(colorVars["--honk-color-control-press"]),
  messageBubbleBg: cssVarName(colorVars["--honk-color-message-bubble-bg"]),
  glassTint: cssVarName(workbenchSurfaceVars["--honk-workbench-glass-tint"]),
  accent: cssVarName(colorVars["--honk-color-accent"]),
  accentFill: cssVarName(colorVars["--honk-color-accent-fill"]),
  accentSubtle: cssVarName(colorVars["--honk-color-accent-subtle"]),
} as const;

const uiFontVars = {
  chromeBody: cssVarName(fontVars["--honk-font-size-body"]),
  chromeDetail: cssVarName(fontVars["--honk-font-size-detail"]),
  chromeCaption: cssVarName(fontVars["--honk-font-size-caption"]),
  chromeMicro: cssVarName(fontVars["--honk-font-size-micro"]),
  chromeBodyLarge: cssVarName(fontVars["--honk-font-size-body-lg"]),
  proseCaption: cssVarName(fontVars["--honk-text-caption"]),
  proseDetail: cssVarName(fontVars["--honk-text-detail"]),
  proseBody: cssVarName(fontVars["--honk-text-body"]),
  proseTitle: cssVarName(fontVars["--honk-text-title"]),
  proseHeading: cssVarName(fontVars["--honk-text-heading"]),
  leadingCaption: cssVarName(fontVars["--honk-leading-caption"]),
  leadingDetail: cssVarName(fontVars["--honk-leading-detail"]),
  leadingBody: cssVarName(fontVars["--honk-leading-body"]),
  leadingBodyLarge: cssVarName(fontVars["--honk-leading-body-lg"]),
  leadingTitle: cssVarName(fontVars["--honk-leading-title"]),
  leadingHeading: cssVarName(fontVars["--honk-leading-heading"]),
} as const;

const CODE_SIZE_VAR = cssVarName(fontVars["--honk-font-size-code"]);
const CODE_LEADING_VAR = cssVarName(fontVars["--honk-leading-code"]);
const UI_FAMILY_VAR = cssVarName(fontVars["--honk-font-family-ui"]);
const CODE_FAMILY_VAR = cssVarName(fontVars["--honk-font-family-mono"]);
const ROUNDED_FAMILY_VAR = cssVarName(fontVars["--honk-font-family-rounded"]);
const FONT_SMOOTHING_VAR = cssVarName(fontVars["--honk-font-smoothing"]);
const FONT_SMOOTHING_MOZ_VAR = cssVarName(fontVars["--honk-font-smoothing-moz"]);

const listeners = new Set<() => void>();

let snapshot = hydrate();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): AppearanceSnapshot {
  return snapshot;
}

export function getServerSnapshot(): AppearanceSnapshot {
  return DEFAULT_APPEARANCE;
}

export function useAppearance(): AppearanceSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useAppearanceTheme(): ThemePreference {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().theme,
    () => DEFAULT_APPEARANCE.theme,
  );
}

export const actions = {
  setTheme(theme: ThemePreference): void {
    publish({ ...snapshot, theme });
  },

  setTintHue(tintHue: number): void {
    publish({ ...snapshot, tintHue: clamp(tintHue, 0, 360) });
  },

  setTintIntensity(tintIntensity: number): void {
    publish({ ...snapshot, tintIntensity: clamp(tintIntensity, 0, 100) });
  },

  setUiFontFamily(uiFontFamily: string | null): void {
    publish({ ...snapshot, uiFontFamily: normalizeFontFamily(uiFontFamily) });
  },

  setCodeFontFamily(codeFontFamily: string | null): void {
    publish({ ...snapshot, codeFontFamily: normalizeFontFamily(codeFontFamily) });
  },

  setUiFontSize(uiFontSize: number): void {
    publish({ ...snapshot, uiFontSize: clamp(uiFontSize, UI_FONT_MIN, UI_FONT_MAX) });
  },

  setCodeFontSize(codeFontSize: number): void {
    publish({
      ...snapshot,
      codeFontSize: clamp(codeFontSize, CODE_FONT_MIN, CODE_FONT_MAX),
    });
  },

  stepFontSizes(delta: number): void {
    publish({
      ...snapshot,
      uiFontSize: clamp(snapshot.uiFontSize + delta, UI_FONT_MIN, UI_FONT_MAX),
      codeFontSize: clamp(snapshot.codeFontSize + delta, CODE_FONT_MIN, CODE_FONT_MAX),
    });
  },

  setFontSmoothing(fontSmoothing: FontSmoothing): void {
    publish({ ...snapshot, fontSmoothing: fontSmoothing === "auto" ? "auto" : "antialiased" });
  },

  resetTheme(): void {
    publish({ ...snapshot, theme: DEFAULT_APPEARANCE.theme });
  },

  resetTintHue(): void {
    publish({ ...snapshot, tintHue: DEFAULT_APPEARANCE.tintHue });
  },

  resetTintIntensity(): void {
    publish({ ...snapshot, tintIntensity: DEFAULT_APPEARANCE.tintIntensity });
  },

  resetUiFontFamily(): void {
    publish({ ...snapshot, uiFontFamily: DEFAULT_APPEARANCE.uiFontFamily });
  },

  resetCodeFontFamily(): void {
    publish({ ...snapshot, codeFontFamily: DEFAULT_APPEARANCE.codeFontFamily });
  },

  resetUiFontSize(): void {
    publish({ ...snapshot, uiFontSize: DEFAULT_APPEARANCE.uiFontSize });
  },

  resetCodeFontSize(): void {
    publish({ ...snapshot, codeFontSize: DEFAULT_APPEARANCE.codeFontSize });
  },

  resetFontSizes(): void {
    publish({
      ...snapshot,
      uiFontSize: DEFAULT_APPEARANCE.uiFontSize,
      codeFontSize: DEFAULT_APPEARANCE.codeFontSize,
    });
  },

  resetFontSmoothing(): void {
    publish({ ...snapshot, fontSmoothing: DEFAULT_APPEARANCE.fontSmoothing });
  },

  // Section-level reset (parity: typography/appearance Reset).
  resetAll(): void {
    publish(DEFAULT_APPEARANCE);
  },
} as const;

function publish(next: AppearanceSnapshot): void {
  if (
    next.theme === snapshot.theme &&
    next.tintHue === snapshot.tintHue &&
    next.tintIntensity === snapshot.tintIntensity &&
    next.uiFontFamily === snapshot.uiFontFamily &&
    next.codeFontFamily === snapshot.codeFontFamily &&
    next.uiFontSize === snapshot.uiFontSize &&
    next.codeFontSize === snapshot.codeFontSize &&
    next.fontSmoothing === snapshot.fontSmoothing
  ) {
    return;
  }

  snapshot = Object.freeze({ ...next });
  persist(snapshot);
  applyAppearance(snapshot);

  for (const listener of listeners) {
    listener();
  }
}

// dials.ts applyPanelValues: at the config default → un-pin (removeProperty) so the
// stylesheet token (both arms of a light-dark() pair) paints again; otherwise setProperty.
function applyAppearance(next: AppearanceSnapshot): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const rootStyle = root.style;

  // Theme is a color-scheme keyword for light-dark(), not a --honk-* var (dials.ts Theme panel).
  // The shell still needs its own xstyle pin; this covers everything outside the frame and
  // keeps first paint honest before React mounts.
  rootStyle.colorScheme =
    next.theme === "light" || next.theme === "dark" ? next.theme : "light dark";
  void window.desktopBridge?.setTheme?.(next.theme);

  applyTint(rootStyle, next.tintHue, next.tintIntensity);

  if (next.uiFontFamily === null) {
    rootStyle.removeProperty(UI_FAMILY_VAR);
    rootStyle.removeProperty(ROUNDED_FAMILY_VAR);
  } else {
    const family = fontFamilyCssValue(next.uiFontFamily, honkTheme.web.font.familyUi);
    rootStyle.setProperty(UI_FAMILY_VAR, family);
    rootStyle.setProperty(ROUNDED_FAMILY_VAR, family);
  }

  if (next.codeFontFamily === null) {
    rootStyle.removeProperty(CODE_FAMILY_VAR);
  } else {
    rootStyle.setProperty(
      CODE_FAMILY_VAR,
      fontFamilyCssValue(next.codeFontFamily, honkTheme.web.font.familyMono),
    );
  }

  // UI chrome and prose share the same user-selected base while retaining their own offsets.
  if (next.uiFontSize === DEFAULT_APPEARANCE.uiFontSize) {
    for (const property of Object.values(uiFontVars)) {
      rootStyle.removeProperty(property);
    }
  } else {
    const body = next.uiFontSize;
    const sizes: Readonly<Record<keyof typeof uiFontVars, number>> = {
      chromeBody: body,
      chromeDetail: body - 1,
      chromeCaption: body - 2,
      chromeMicro: body - 3,
      chromeBodyLarge: body + 1,
      proseCaption: body - 2,
      proseDetail: body - 1,
      proseBody: body,
      proseTitle: body + 1,
      proseHeading: body + 3,
      leadingCaption: body + 1,
      leadingDetail: body + 3,
      leadingBody: body + 5,
      leadingBodyLarge: body + 8,
      leadingTitle: body + 7,
      leadingHeading: body + 8,
    };
    for (const [name, property] of Object.entries(uiFontVars) as readonly [
      keyof typeof uiFontVars,
      string,
    ][]) {
      rootStyle.setProperty(property, `${Math.max(sizes[name], 8)}px`);
    }
  }

  if (next.codeFontSize === DEFAULT_APPEARANCE.codeFontSize) {
    rootStyle.removeProperty(CODE_SIZE_VAR);
    rootStyle.removeProperty(CODE_LEADING_VAR);
  } else {
    rootStyle.setProperty(CODE_SIZE_VAR, `${next.codeFontSize}px`);
    rootStyle.setProperty(CODE_LEADING_VAR, `${next.codeFontSize + 6}px`);
  }

  // Inline root vars cover the shell and every portaled overlay.
  if (next.fontSmoothing === DEFAULT_APPEARANCE.fontSmoothing) {
    rootStyle.removeProperty(FONT_SMOOTHING_VAR);
    rootStyle.removeProperty(FONT_SMOOTHING_MOZ_VAR);
  } else {
    rootStyle.setProperty(FONT_SMOOTHING_VAR, "auto");
    rootStyle.setProperty(FONT_SMOOTHING_MOZ_VAR, "auto");
  }
}

function applyTint(rootStyle: CSSStyleDeclaration, hue: number, intensity: number): void {
  if (intensity === 0) {
    for (const property of Object.values(tintColorVars)) {
      rootStyle.removeProperty(property);
    }
    return;
  }

  const light = honkTheme.colors.light;
  const dark = honkTheme.colors.dark;
  const surfaces = [
    ["bgDeep", 1],
    ["bgBase", 0.5],
    ["layer01", 0.45],
    ["layer02", 0.55],
    ["layer03", 0.65],
    ["layer04", 0.75],
    ["tabHover", 0.55],
    ["control", 0.45],
    ["controlHover", 0.55],
    ["controlPress", 0.65],
    ["messageBubbleBg", 0.45],
  ] as const;

  for (const [name, scale] of surfaces) {
    rootStyle.setProperty(
      tintColorVars[name],
      `light-dark(${tintHex(light[name], hue, intensity, scale)}, ${tintHex(dark[name], hue, intensity, scale)})`,
    );
  }

  // Glass rides its own eased intensity so the translucent field stays clean until the slider is high.
  const glassIntensity = 100 * (intensity / 100) ** GLASS_TINT_EXPONENT;
  rootStyle.setProperty(
    tintColorVars.glassTint,
    `light-dark(${tintHex(light.bgDeep, hue, glassIntensity, 1)}, ${tintHex(dark.bgDeep, hue, glassIntensity, 1)})`,
  );

  rootStyle.setProperty(
    tintColorVars.accent,
    `light-dark(${tintHex(light.accent, hue, intensity, 1)}, ${tintHex(dark.accent, hue, intensity, 1)})`,
  );
  rootStyle.setProperty(
    tintColorVars.accentFill,
    `light-dark(${tintHex(light.accentFill, hue, intensity, 1)}, ${tintHex(dark.accentFill, hue, intensity, 1)})`,
  );
  rootStyle.setProperty(
    tintColorVars.accentSubtle,
    `light-dark(${tintHex(light.accentSubtle, hue, intensity, 0.65)}, ${tintHex(dark.accentSubtle, hue, intensity, 0.65)})`,
  );
}

function tintHex(hex: string, hue: number, intensity: number, scale: number): string {
  // Light controls/layers use 8-digit hex with alpha; tint RGB only and keep alpha so
  // translucent buttons stay system-aware instead of becoming opaque near-black.
  const source = hexToRgba(hex);
  const target = hslToRgb(hue, 1, rgbLightness(source));
  const amount = (intensity / 100) * scale;
  return rgbaToHex({
    red: source.red + (target.red - source.red) * amount,
    green: source.green + (target.green - source.green) * amount,
    blue: source.blue + (target.blue - source.blue) * amount,
    alpha: source.alpha,
  });
}

type Rgba = {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number | undefined;
};

function hexToRgba(hex: string): Rgba {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
    alpha: hex.length >= 9 ? Number.parseInt(hex.slice(7, 9), 16) : undefined,
  };
}

function rgbLightness(rgb: {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}): number {
  const red = rgb.red / 255;
  const green = rgb.green / 255;
  const blue = rgb.blue / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return (max + min) / 2;
}

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number,
): { readonly red: number; readonly green: number; readonly blue: number } {
  if (saturation === 0) {
    const channel = lightness * 255;
    return { red: channel, green: channel, blue: channel };
  }
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const normalizedHue = hue / 360;
  return {
    red: hueToChannel(p, q, normalizedHue + 1 / 3) * 255,
    green: hueToChannel(p, q, normalizedHue) * 255,
    blue: hueToChannel(p, q, normalizedHue - 1 / 3) * 255,
  };
}

function hueToChannel(p: number, q: number, t: number): number {
  let wrappedHue = t;
  if (wrappedHue < 0) wrappedHue += 1;
  if (wrappedHue > 1) wrappedHue -= 1;
  if (wrappedHue < 1 / 6) return p + (q - p) * 6 * wrappedHue;
  if (wrappedHue < 1 / 2) return q;
  if (wrappedHue < 2 / 3) return p + (q - p) * (2 / 3 - wrappedHue) * 6;
  return p;
}

function rgbaToHex(rgba: Rgba): string {
  const channel = (value: number): string => Math.round(value).toString(16).padStart(2, "0");
  const rgb = `#${channel(rgba.red)}${channel(rgba.green)}${channel(rgba.blue)}`;
  if (rgba.alpha === undefined) return rgb;
  return `${rgb}${channel(rgba.alpha)}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function hydrate(): AppearanceSnapshot {
  const parsed = readAppearanceBlob();
  if (parsed === null) return DEFAULT_APPEARANCE;

  return Object.freeze({
    theme: parsed.theme ?? DEFAULT_APPEARANCE.theme,
    tintHue: clamp(parsed.tintHue ?? DEFAULT_APPEARANCE.tintHue, 0, 360),
    tintIntensity: clamp(parsed.tintIntensity ?? DEFAULT_APPEARANCE.tintIntensity, 0, 100),
    uiFontFamily: normalizeFontFamily(parsed.uiFontFamily),
    codeFontFamily: normalizeFontFamily(parsed.codeFontFamily),
    uiFontSize: clamp(parsed.uiFontSize ?? DEFAULT_APPEARANCE.uiFontSize, UI_FONT_MIN, UI_FONT_MAX),
    codeFontSize: clamp(
      parsed.codeFontSize ?? DEFAULT_APPEARANCE.codeFontSize,
      CODE_FONT_MIN,
      CODE_FONT_MAX,
    ),
    fontSmoothing: parsed.fontSmoothing ?? DEFAULT_APPEARANCE.fontSmoothing,
  });
}

function persist(next: AppearanceSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence must never break the appearance plane.
  }
}

// Apply once at import so a reload restores CSS vars before React paints (dials bind-at-import).
if (typeof document !== "undefined") {
  applyAppearance(snapshot);
}
