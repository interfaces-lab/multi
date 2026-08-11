import { ChangeReceipt, FileTypeIcon } from "@honk/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("ChangeReceipt file icons", () => {
  it("uses the shared colored Application File Icons renderer", () => {
    const receipt = renderToStaticMarkup(
      <ChangeReceipt
        files={[
          { path: "src/component.ts", additions: 2, deletions: 0 },
          { path: "src/config.json", additions: 1, deletions: 1 },
        ]}
      />,
    );
    const typescriptIconClass = renderToStaticMarkup(
      <FileTypeIcon path="src/component.ts" size="sm" />,
    ).match(/class="([^"]+)"/)?.[1];
    const jsonIconClass = renderToStaticMarkup(
      <FileTypeIcon path="src/config.json" size="sm" />,
    ).match(/class="([^"]+)"/)?.[1];

    expect(receipt).toContain('data-icon-token="typescript"');
    expect(receipt).toContain('href="#file-tree-builtin-typescript"');
    expect(receipt).toContain(`class="${typescriptIconClass}"`);
    expect(receipt).toContain(`class="${jsonIconClass}"`);
    expect(typescriptIconClass).not.toBe(jsonIconClass);
  });
});
