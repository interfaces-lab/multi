import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FileTypeIcon, FileTypeIconSprite } from "./file-type-icon";

describe("file type icon", () => {
  it.each([
    ["settings.json", "json"],
    ["component.tsx", "react"],
    ["vite.config.ts", "vite"],
    ["Dockerfile", "docker"],
    [".gitignore", "git"],
    ["notes.unknown", "default"],
    ["C:\\repo\\Dockerfile", "docker"],
  ])("uses Pierre's complete icon for %s", (path, token) => {
    const html = renderToStaticMarkup(<FileTypeIcon path={path} />);

    expect(html).toContain(`data-icon-token="${token}"`);
    expect(html).toContain(`href="#file-tree-builtin-${token}"`);
  });

  it("ships every referenced icon in the shared Pierre sprite", () => {
    const icon = renderToStaticMarkup(<FileTypeIcon path="settings.json" />);
    const href = /href="#([^"]+)"/.exec(icon)?.[1];
    const sprite = renderToStaticMarkup(<FileTypeIconSprite />);

    expect(href).toBe("file-tree-builtin-json");
    expect(sprite).toContain(`id="${href}"`);
  });

  it("groups file types by the icon pack's semantic colors", () => {
    const iconClass = (path: string) =>
      renderToStaticMarkup(<FileTypeIcon path={path} />).match(/class="([^"]+)"/)?.[1];

    expect(iconClass("component.tsx")).toBe(iconClass("main.go"));
    expect(iconClass("component.tsx")).not.toBe(iconClass("settings.json"));
    expect(iconClass("settings.json")).toBe(iconClass("logo.svg"));
    expect(iconClass("font.woff")).toBe(iconClass("next.config.js"));
    expect(iconClass("next.config.js")).toBe(iconClass(".stylelintrc"));
  });

  it("lets an explicit tone override the icon pack color", () => {
    const iconClass = (path: string) =>
      renderToStaticMarkup(<FileTypeIcon path={path} tone="muted" />).match(/class="([^"]+)"/)?.[1];

    expect(iconClass("component.tsx")).toBe(iconClass("settings.json"));
  });
});
