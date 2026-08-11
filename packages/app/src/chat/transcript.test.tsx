import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Session } from "@honk/core/session";

import {
  assistantMessageEntry,
  type AssistantContent,
  toolResultMessageEntry,
  userContentMessageEntry,
  userMessageEntry,
} from "../test-fixtures";
import { conversationItems } from "./chat-model";
import { ChatTranscript } from "./transcript";

const userEntry = userMessageEntry;

const assistantEntry = (id: string, content: readonly AssistantContent[]) =>
  assistantMessageEntry(id, content);

const toolResult = (
  id: string,
  toolCallId: string,
  text: string,
  details?: unknown,
): Session.SessionTreeEntry => toolResultMessageEntry({ id, toolCallId, text, details });

const render = (entries: readonly Session.SessionTreeEntry[]): string =>
  renderToStaticMarkup(
    <ChatTranscript
      items={conversationItems(entries, null)}
      running={false}
      ticker={{ kind: "idle" }}
      density="detailed"
      onGitAction={() => undefined}
    />,
  );

const renderEditable = (entries: readonly Session.SessionTreeEntry[]): string =>
  renderToStaticMarkup(
    <ChatTranscript
      items={conversationItems(entries, null)}
      running={false}
      ticker={{ kind: "idle" }}
      density="detailed"
      onGitAction={() => undefined}
      messageEditing={{
        kind: "enabled",
        active: null,
        available: true,
        onBegin: () => undefined,
        onChange: () => undefined,
        onSelectionChange: () => undefined,
        onCancel: () => undefined,
        onSubmit: () => undefined,
      }}
    />,
  );

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

const SHORT_PATCH = ["--- a.ts", "+++ a.ts", "@@ -1 +1 @@", "-const a = 1;", "+const a = 2;"].join(
  "\n",
);

const LONG_PATCH = [
  "--- a.ts",
  "+++ a.ts",
  "@@ -1,6 +1,6 @@",
  " one",
  " two",
  "-three",
  "-four",
  "+THREE",
  "+FOUR",
  " five",
  " six",
].join("\n");

describe("the transcript's tool rows", () => {
  it("a read shows its path and never repeats the file it read", () => {
    const html = render([
      userEntry("u1", "look"),
      assistantEntry("a1", [
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "src/value.ts" } },
      ]),
      toolResult("t1", "c1", "1  export const value = 1;"),
    ]);

    expect(html).toContain(">Read<");
    expect(html).toContain("src/value.ts");
    expect(html).not.toContain("export const value = 1;");
    expect(html).not.toContain("data-work-preview-output");
    // Nothing to open means no disclosure control at all.
    expect(html).not.toContain("data-tool-call-line-chevron");
  });

  it("a write renders its own text as a source card and invents no stats", () => {
    const html = render([
      userEntry("u1", "make it"),
      assistantEntry("a1", [
        {
          type: "toolCall",
          id: "c1",
          name: "write",
          arguments: { path: "src/new.ts", content: "const one = 1;\nconst two = 2;\n" },
        },
      ]),
      toolResult("t1", "c1", "Wrote src/new.ts"),
    ]);

    expect(html).toContain(">Wrote<");
    expect(html).toContain("src/new.ts");
    expect(html).toContain('data-tool-card="source"');
    expect(html).not.toContain('data-tool-card="diff"');
    // A write saw no prior file, so the row carries no +N/-N.
    expect(html).not.toContain(">+1<");
    expect(html).not.toContain(">-1<");
    expect(html).not.toContain("Wrote src/new.ts</");
  });

  it("an edit renders Pi's patch as a diff card with its stats", () => {
    const html = render([
      userEntry("u1", "bump it"),
      assistantEntry("a1", [
        { type: "toolCall", id: "c1", name: "edit", arguments: { path: "a.ts" } },
      ]),
      toolResult("t1", "c1", "Edit applied", { patch: SHORT_PATCH }),
    ]);

    expect(html).toContain(">Edited<");
    expect(html).toContain('data-tool-card="diff"');
    expect(html).toContain(">+1<");
    expect(html).toContain(">-1<");
    expect(html).not.toContain("Showing raw patch");
  });

  it("offers disclosure only past the four-row collapsed preview", () => {
    const rowOf = (patch: string) =>
      render([
        userEntry("u1", "edit"),
        assistantEntry("a1", [
          { type: "toolCall", id: "c1", name: "edit", arguments: { path: "a.ts" } },
        ]),
        toolResult("t1", "c1", "Edit applied", { patch }),
      ]);

    expect(rowOf(SHORT_PATCH)).not.toContain("data-tool-call-line-chevron");
    expect(rowOf(LONG_PATCH)).toContain("data-tool-call-line-chevron");
  });

  it("shows an honest raw fallback when Pierre cannot read the patch", () => {
    const html = render([
      userEntry("u1", "edit"),
      assistantEntry("a1", [
        { type: "toolCall", id: "c1", name: "edit", arguments: { path: "a.ts" } },
      ]),
      toolResult("t1", "c1", "Edit applied", { patch: "not a unified patch" }),
    ]);

    expect(html).toContain("Showing raw patch");
    expect(html).toContain("not a unified patch");
  });

  it("a settled turn never renders an escape sequence as text", () => {
    const html = render([
      userEntry("u1", "run the suite"),
      assistantEntry("a1", [
        { type: "text", text: "Running it now." },
        {
          type: "toolCall",
          id: "c1",
          name: "bash",
          arguments: { command: "pnpm test\npnpm lint" },
        },
      ]),
      toolResult("t1", "c1", "first line\nsecond line"),
      assistantEntry("a2", [{ type: "text", text: "Both green." }]),
    ]);

    expect(html).toContain(">Ran<");
    expect(html).toContain("Both green.");
    // The command is shown as the user wrote it. A JSON dump of the arguments
    // would print its newline as two characters, which is the regression.
    expect(html).toContain("pnpm test");
    expect(html).not.toContain(String.raw`\n`);
  });

  it("hangs headline prose on the same conversation inset as the rows under it", () => {
    const html = render([
      userEntry("u1", "look"),
      assistantEntry("a1", [
        { type: "text", text: "Reading the config." },
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } },
      ]),
      toolResult("t1", "c1", "1  ok"),
    ]);

    const rowClasses = new Set(
      (/data-tool-call-line=""[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "").split(" "),
    );
    const wrapperClasses = (/class="([^"]*)"><div data-slot="prose"/.exec(html)?.[1] ?? "").split(
      " ",
    );

    // The wrapper exists only to inset, so it carries exactly one class, and
    // that class must be one the tool row already carries. Asserting the shared
    // class rather than the StyleX hash keeps this readable across rebuilds.
    expect(rowClasses.size).toBeGreaterThan(0);
    expect(wrapperClasses).toHaveLength(1);
    expect(rowClasses.has(wrapperClasses[0] ?? "")).toBe(true);
  });
});

describe("user message content", () => {
  it("renders committed content beside a separate idle edit action", () => {
    const imageUser = userContentMessageEntry("u-image", [
      { type: "image", data: "pixel", mimeType: "image/png" },
      { type: "text", text: "what is this?" },
    ]);

    const html = renderEditable([imageUser]);
    expect(html).toContain('src="data:image/png;base64,pixel"');
    expect(html).toContain("what is this?");
    expect(html).toContain(">Edit</button>");
    const bubbleAttributes = /<div data-message-bubble="user"([^>]*)>/.exec(html)?.[1] ?? "";
    expect(bubbleAttributes).not.toContain('role="button"');
    expect(bubbleAttributes).not.toContain("tabindex=");
    expect(html).not.toContain('aria-label="Edit message"');
  });

  it("replaces the selected message in place and disables every other edit entry point", () => {
    const entries = [
      userEntry("u1", "first question"),
      assistantEntry("a1", [{ type: "text", text: "first answer" }]),
      userEntry("u2", "second question"),
    ];
    const html = renderToStaticMarkup(
      <ChatTranscript
        items={conversationItems(entries, null)}
        running={false}
        ticker={{ kind: "idle" }}
        density="detailed"
        onGitAction={() => undefined}
        messageEditing={{
          kind: "enabled",
          available: true,
          active: {
            phase: "editing",
            sessionId: Session.SessionId.make("ses_inline_transcript"),
            entryId: "u1",
            message: { text: "revised first question", images: [] },
            error: null,
            selection: {
              kind: "model",
              model: { providerId: "faux", modelId: "faux-first" },
              thinkingLevel: "medium",
            },
            selectionChanged: false,
          },
          onBegin: () => undefined,
          onChange: () => undefined,
          onSelectionChange: () => undefined,
          onCancel: () => undefined,
          onSubmit: () => undefined,
        }}
      />,
    );

    expect(html).toContain('data-inline-message-edit=""');
    expect(html).toContain('aria-label="Edit message"');
    expect(html).toContain("second question");
    expect(html).not.toContain(">Edit</button>");
  });
});

const conversation = (turnCount: number): readonly Session.SessionTreeEntry[] =>
  Array.from({ length: turnCount }, (_unused, index) => [
    userEntry(`u${String(index)}`, `question ${String(index)}`),
    assistantEntry(`a${String(index)}`, [{ type: "text", text: `answer ${String(index)}` }]),
  ]).flat();

describe("the transcript's virtual row plane", () => {
  it("pins each user message in a sticky region and leaves work in flow", () => {
    const html = render(conversation(2));

    // Two sticky rows plus two work rows, all measured.
    expect(countOf(html, "data-virtual-transcript-row")).toBe(4);
    // Each sticky region spans from its own message to the next one's start,
    // so the regions tile the plane: that abutment is what pushes a pinned
    // message off the top as the following turn arrives. Regions are placed
    // with top (not transform) so CSS sticky resolves against the scrollport.
    const regions = [
      ...html.matchAll(
        /data-virtual-transcript-region[^>]*--x-insetBlockStart:(\d+)px;--x-height:(\d+)px/g,
      ),
    ].map((match) => ({ top: Number(match[1]), height: Number(match[2]) }));
    expect(regions).toHaveLength(2);
    expect(regions[0]?.top).toBe(0);
    expect(regions[1]?.top).toBe((regions[0]?.top ?? 0) + (regions[0]?.height ?? 0));
    // Rows that are not pinned ride a transform inside the plane.
    expect(html).toContain("translate3d(0, 92px, 0)");
  });

  it("mounts only the rows near the viewport", () => {
    const html = render(conversation(20));

    expect(html).toContain("question 0");
    expect(html).not.toContain("question 19");
    expect(countOf(html, "data-virtual-transcript-row")).toBeLessThan(40);
  });

  it("offers the empty state instead of a plane when nothing has been said", () => {
    const html = render([]);

    expect(html).not.toContain("data-virtual-transcript-row");
    expect(html).toContain("Nothing here yet");
  });
});
