import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "../home";
import { ChatStartPage } from "./start-page";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../desktop-bridge", () => ({
  canPickFolder: () => false,
  pickFolder: vi.fn(async () => null),
}));

const coreState = vi.hoisted((): { status: "connecting" | "ready" | "unavailable" } => ({
  status: "ready",
}));

// The page's main branch needs a ready core; every other export keeps its real
// shape for the modules that import the client transitively.
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  useHonkCore: () => {
    if (coreState.status === "connecting") return { status: "connecting" };
    if (coreState.status === "unavailable") return { status: "unavailable" };
    return { status: "ready", client: {} };
  },
}));

vi.mock("./inventory-store", () => ({
  useInventory: () => ({
    status: "ready",
    error: null,
    sessions: [
      {
        id: "ses_recent",
        workspaceId: "ws_recent",
        directory: "/tmp/goose-nest",
        title: "Fix tab title generation",
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
        phase: "idle",
      },
    ],
  }),
}));

const catalogState = vi.hoisted(
  (): {
    phase:
      | { readonly status: "loading" }
      | { readonly status: "ready"; readonly providers: readonly unknown[]; readonly error: null };
  } => ({ phase: { status: "loading" } }),
);

vi.mock("./model-catalog", () => ({
  useCatalogPhase: () => catalogState.phase,
  refreshCatalog: vi.fn(async () => undefined),
}));

const provider = (configured: boolean): unknown => ({
  id: "anthropic",
  name: "Anthropic",
  configured,
  methods: ["api_key"],
  models: [{ id: "claude-fable-5", name: "Fable 5" }],
});

describe("chat start page", () => {
  beforeEach(() => {
    coreState.status = "ready";
    catalogState.phase = { status: "loading" };
  });

  it("is the exact Home component and renders one prompt-first surface", () => {
    catalogState.phase = { status: "ready", providers: [provider(true)], error: null };
    const html = renderToStaticMarkup(<ChatStartPage />);

    expect(HomePage).toBe(ChatStartPage);
    expect(html).toContain("data-start-surface");
    expect(html).toContain("What can I help you build?");
    expect(html).toContain("Choose a workspace");
    expect(html).toContain("Search folders or enter a path…");
    expect(html).toContain("Use folder");
    expect(html).toContain("Recent threads");
    expect(html).toContain("Fix tab title generation");
    expect(html).toContain("/tmp/goose-nest");
    // Exactly one editor — the composer's. The old ladder rendered a second
    // orchestration around it; none of its surfaces may come back.
    expect(html.match(/aria-label="Message"/g)).toHaveLength(1);
    expect(html).not.toContain("autofocus");
    expect(html).not.toContain("Open a workspace");
    expect(html).not.toContain("Recent chats");
    expect(html).not.toContain("Start chat");
    expect(html).not.toContain("Switch workspace");
    expect(html).not.toContain("Add a provider");
    expect(html).not.toContain("Recording trust");
  });

  it("points at Settings when the catalog is ready with nothing configured", () => {
    catalogState.phase = { status: "ready", providers: [provider(false)], error: null };
    const html = renderToStaticMarkup(<ChatStartPage />);

    expect(html).toContain("Connect a model provider");
    expect(html).toContain("Open provider settings");
  });

  it("keeps the provider affordance away while the catalog loads or can run", () => {
    catalogState.phase = { status: "loading" };
    expect(renderToStaticMarkup(<ChatStartPage />)).not.toContain("Open provider settings");

    catalogState.phase = { status: "ready", providers: [provider(true)], error: null };
    expect(renderToStaticMarkup(<ChatStartPage />)).not.toContain("Open provider settings");
  });

  it("uses the shared page frame for core connection states", () => {
    coreState.status = "connecting";
    const connecting = renderToStaticMarkup(<ChatStartPage />);
    expect(connecting).toContain("data-start-surface");
    expect(connecting).toContain("Connecting to Honk Core…");
    expect(connecting).not.toContain('aria-label="Message"');

    coreState.status = "unavailable";
    const unavailable = renderToStaticMarkup(<ChatStartPage />);
    expect(unavailable).toContain("Honk can&#x27;t start threads in this window.");
    expect(unavailable).toContain("Restart Honk, then try again.");
  });
});
