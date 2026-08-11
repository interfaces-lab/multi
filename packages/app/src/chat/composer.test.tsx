import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Session } from "@honk/core/session";

import { ChatComposer } from "./composer";
import { draftKeyOf, EMPTY_MESSAGE, writeDraft } from "./composer-store";
import { ThreadComposer } from "./thread-composer";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../desktop-bridge", () => ({
  canPickFolder: () => false,
  pickFolder: vi.fn(async () => null),
}));

const SESSION_ID = Session.SessionId.make("ses_composer_test");

afterEach(() => {
  writeDraft(draftKeyOf(null), EMPTY_MESSAGE);
  writeDraft(draftKeyOf(SESSION_ID), EMPTY_MESSAGE);
});

describe("start surface", () => {
  it("offers a prompt and a folder to run it in, with no chat started yet", () => {
    const html = renderToStaticMarkup(<ChatComposer />);

    expect(html).toContain("What can I help you build?");
    expect(html).toContain("Send");
    // No recent directory in this host, so the affordance asks for one.
    expect(html).toContain("Choose a folder");
    // The trust question belongs to core's refusal, not to a resting composer.
    expect(html).not.toContain("Do you trust");
  });

  // The draft round-trip itself is proven where it happens: composer-store
  // owns the keying and composer-editor.test.ts seeds a real editor from it.
  // The editor writes its content in a layout effect, so server markup cannot
  // show it and asserting on that markup would only pin the harness.
});

describe("thread surface", () => {
  it("offers the reply placeholder until something is typed", () => {
    expect(renderToStaticMarkup(<ThreadComposer sessionId={SESSION_ID} />)).toContain("Reply…");
  });

  it("takes focus on arrival, ready for the next thought", () => {
    const html = renderToStaticMarkup(<ThreadComposer sessionId={SESSION_ID} />);

    expect(html).toContain("autofocus");
    expect(renderToStaticMarkup(<ChatComposer />)).not.toContain("autofocus");
  });

  it("names the idle Enter verb on the one submit button", () => {
    // Before any watch frame the session is not running: Enter prompts.
    const html = renderToStaticMarkup(<ThreadComposer sessionId={SESSION_ID} />);

    expect(html).toContain('aria-label="Send"');
    expect(html).not.toContain('aria-label="Stop"');
  });

  it("keeps the mention menu closed at rest, combobox collapsed", () => {
    const html = renderToStaticMarkup(<ThreadComposer sessionId={SESSION_ID} />);

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
  });

  it("shows no queue tray while Pi holds nothing", () => {
    const html = renderToStaticMarkup(<ThreadComposer sessionId={SESSION_ID} />);

    expect(html).not.toContain("Queued");
  });
});
