import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EMPTY_QUEUE } from "./chat-model";
import { ComposerQueueTray } from "./queue-tray";

describe("composer queue tray", () => {
  it("renders nothing while Pi holds no queue", () => {
    expect(renderToStaticMarkup(<ComposerQueueTray queue={EMPTY_QUEUE} />)).toBe("");
  });

  it("counts every bucket in the header and rows in delivery order", () => {
    const html = renderToStaticMarkup(
      <ComposerQueueTray
        queue={{
          steer: [{ text: "nudge the run", images: [] }],
          followUp: [{ text: "then the tests", images: [] }],
          nextTurn: [{ text: "next turn text", images: [] }],
        }}
      />,
    );

    expect(html).toContain("3 Queued");
    const order = ["nudge the run", "then the tests", "next turn text"].map((text) =>
      html.indexOf(text),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("is read-only: no per-row edit, send, or remove affordances", () => {
    const html = renderToStaticMarkup(
      <ComposerQueueTray
        queue={{ steer: [{ text: "only row", images: [] }], followUp: [], nextTurn: [] }}
      />,
    );

    expect(html).toContain("1 Queued");
    expect(html).not.toContain('aria-label="Edit"');
    expect(html).not.toContain('aria-label="Send now"');
    expect(html).not.toContain('aria-label="Remove"');
    // The collapse toggle is the tray's only control.
    expect(html).toContain('aria-label="Collapse queue"');
    expect(html).toContain('aria-expanded="true"');
  });

  it("keeps an image-only queued message visible", () => {
    const html = renderToStaticMarkup(
      <ComposerQueueTray
        queue={{
          steer: [],
          followUp: [{ text: "", images: [{ data: "pixel", mimeType: "image/png" }] }],
          nextTurn: [],
        }}
      />,
    );

    expect(html).toContain("1 Queued");
    expect(html).toContain('src="data:image/png;base64,pixel"');
  });
});
