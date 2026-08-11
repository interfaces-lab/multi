import { describe, expect, it } from "vitest";

import { normalizeDesktopSettingsDocument } from "./desktop-app-settings";

describe("normalizeDesktopSettingsDocument", () => {
  it("fills defaults for an empty document", () => {
    const settings = normalizeDesktopSettingsDocument({}, "0.0.0-test");

    expect(settings.themeSource).toBe("system");
    expect(settings.hasCompletedOnboarding).toBe(false);
    expect(settings).not.toHaveProperty("lastBackendPort");
  });

  it("keeps saved values and drops an out-of-range backend port", () => {
    const settings = normalizeDesktopSettingsDocument(
      { themeSource: "dark", hasCompletedOnboarding: true, lastBackendPort: 70_000 },
      "0.0.0-test",
    );

    expect(settings.themeSource).toBe("dark");
    expect(settings.hasCompletedOnboarding).toBe(true);
    expect(settings).not.toHaveProperty("lastBackendPort");
  });

  it("ignores the retired display zoom field", () => {
    const legacyDocument = { displayZoomLevel: 4, themeSource: "dark" } as const;
    const settings = normalizeDesktopSettingsDocument(legacyDocument, "0.0.0-test");

    expect(settings.themeSource).toBe("dark");
    expect(settings).not.toHaveProperty("displayZoomLevel");
  });
});
