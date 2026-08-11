// The persisted appearance blob, read and parsed once per page load.
// index.html reads the same key inline before any module can run; every
// module-side consumer (the startup shell, the appearance store) shares this
// single synchronous storage hit instead of each re-parsing on the boot path.

export const APPEARANCE_STORAGE_KEY = "honk:app:appearance";

export type ThemePreference = "system" | "light" | "dark";
export type FontSmoothing = "antialiased" | "auto";

export interface AppearanceSnapshot {
  readonly theme: ThemePreference;
  readonly tintHue: number;
  readonly tintIntensity: number;
  readonly uiFontFamily: string | null;
  readonly codeFontFamily: string | null;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
  readonly fontSmoothing: FontSmoothing;
}

let read = false;
let cached: Partial<AppearanceSnapshot> | null = null;

function stringValue(value: unknown): string | undefined {
  const candidate = String(value);
  return value === candidate ? candidate : undefined;
}

function numberValue(value: unknown): number | undefined {
  const candidate = Number(value);
  return value === candidate ? candidate : undefined;
}

function fontValue(value: unknown): string | null | undefined {
  return value === null ? null : stringValue(value);
}

function decodeAppearanceBlob(value: unknown): Partial<AppearanceSnapshot> | null {
  if (!(value instanceof Object)) return null;

  const rawTheme = Reflect.get(value, "theme");
  const theme =
    rawTheme === "system" || rawTheme === "light" || rawTheme === "dark" ? rawTheme : undefined;
  const rawSmoothing = Reflect.get(value, "fontSmoothing");
  const fontSmoothing =
    rawSmoothing === "antialiased" || rawSmoothing === "auto" ? rawSmoothing : undefined;
  const tintHue = numberValue(Reflect.get(value, "tintHue"));
  const tintIntensity = numberValue(Reflect.get(value, "tintIntensity"));
  const uiFontFamily = fontValue(Reflect.get(value, "uiFontFamily"));
  const codeFontFamily = fontValue(Reflect.get(value, "codeFontFamily"));
  const uiFontSize = numberValue(Reflect.get(value, "uiFontSize"));
  const codeFontSize = numberValue(Reflect.get(value, "codeFontSize"));

  return {
    ...(theme === undefined ? {} : { theme }),
    ...(tintHue === undefined ? {} : { tintHue }),
    ...(tintIntensity === undefined ? {} : { tintIntensity }),
    ...(uiFontFamily === undefined ? {} : { uiFontFamily }),
    ...(codeFontFamily === undefined ? {} : { codeFontFamily }),
    ...(uiFontSize === undefined ? {} : { uiFontSize }),
    ...(codeFontSize === undefined ? {} : { codeFontSize }),
    ...(fontSmoothing === undefined ? {} : { fontSmoothing }),
  };
}

export function readAppearanceBlob(): Partial<AppearanceSnapshot> | null {
  if (!read) {
    read = true;
    if (globalThis.window !== undefined) {
      try {
        const stored: unknown = JSON.parse(
          globalThis.window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "null",
        );
        cached = decodeAppearanceBlob(stored);
      } catch {
        cached = null;
      }
    }
  }
  return cached;
}
