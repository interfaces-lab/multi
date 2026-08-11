// Mount-level regression tests for every settings panel. Unit tests missed an
// infinite render loop in the MCP panel because nothing ever mounted it; these
// tests mount each panel for real (createRoot + effects) against a minimal DOM
// stub, in Node, with the panel's data boundaries mocked.

import { act } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Models } from "@honk/core/models";

import { AddProviderForm } from "./settings-add-provider";
import { SettingsAppearance } from "./settings-appearance";
import { SettingsGeneral } from "./settings-general";
import { SettingsMcp } from "./settings-mcp";
import { SettingsProviders } from "./settings-providers";
import { mountTestElement } from "./test-dom";
import { providerSummary } from "./test-fixtures";

type TestCorePhase =
  | { readonly status: "connecting" | "unavailable" }
  | { readonly status: "ready"; readonly client: { readonly models: object } };

type TestCatalogPhase =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly providers: readonly Models.ProviderSummary[];
      readonly error: string | null;
    };

type TestWorkspacePhase =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly workspace: { readonly workspaceId: string; readonly directory: string };
    };

interface SettingsTestState {
  core: TestCorePhase;
  client: object;
  catalog: TestCatalogPhase;
  workspace: TestWorkspacePhase;
  remoteAccess: "web" | "restart-required" | "ready";
  readonly refreshCatalog: Mock<() => Promise<void>>;
}

const state = vi.hoisted(
  (): SettingsTestState => ({
    core: { status: "ready", client: { models: {} } },
    client: {},
    catalog: { status: "loading" },
    workspace: {
      status: "ready",
      workspace: { workspaceId: "ws_settings_test", directory: "/tmp/goose-nest" },
    },
    remoteAccess: "web",
    refreshCatalog: vi.fn(() => Promise.resolve()),
  }),
);

vi.mock("./chat/client", () => ({
  useHonkCore: () => state.core,
  requireHonkClient: () => state.client,
  describeError: (error: unknown) => String(error),
}));

vi.mock("./chat/model-catalog", () => ({
  useCatalogPhase: () => state.catalog,
  refreshCatalog: state.refreshCatalog,
}));

vi.mock("./chat/session-workspace", () => ({
  useSessionWorkspace: () => state.workspace,
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ sessionId: "ses_settings_test" }),
}));

vi.mock("./desktop-bridge", () => ({
  readDesktopRemoteAccessAvailability: () => ({ status: state.remoteAccess }),
  canShowItemInFolder: () => false,
  pickFolder: vi.fn(async () => null),
  showItemInFolder: vi.fn(async () => false),
  openDesktopExternal: vi.fn(async () => false),
}));

vi.mock("./update-pill", () => ({
  useUpdatePill: () => ({ bridgePresent: false, state: null }),
  updatePillActions: { check: vi.fn(), download: vi.fn(), install: vi.fn() },
}));

vi.mock("./notification-permission", () => ({
  useNotificationPermission: () => "unsupported",
  buildNotificationSettingsSupportText: () => "Notifications are not supported in this host.",
  requestBrowserNotificationPermission: vi.fn(),
}));

vi.mock("./completion-sound", () => ({
  playAlertSound: vi.fn(async () => "built-in"),
  saveCustomAlertSound: vi.fn(async () => undefined),
  deleteCustomAlertSound: vi.fn(async () => undefined),
}));

vi.mock("./desktop-extensions/runtime", () => ({
  useHonkDesktopSettings: () => [],
  useHonkDesktopCell: () => false,
}));

vi.mock("./local-fonts-store", () => ({
  useLocalFonts: () => ({ phase: "ready", families: [] }),
  loadLocalFonts: vi.fn(),
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const fauxProvider = (configured: boolean): Models.ProviderSummary =>
  providerSummary({
    id: "anthropic",
    name: "Anthropic",
    configured,
    ...(configured ? { source: "OAuth" } : {}),
    methods: ["oauth", "api_key"],
  });

beforeEach(() => {
  state.core = { status: "ready", client: { models: {} } };
  state.client = {};
  state.catalog = { status: "ready", providers: [], error: null };
  state.workspace = {
    status: "ready",
    workspace: { workspaceId: "ws_settings_test", directory: "/tmp/goose-nest" },
  };
  state.remoteAccess = "web";
  state.refreshCatalog.mockClear();
});

describe("settings panel mounts", () => {
  it("SettingsGeneral mounts and renders its primary content", async () => {
    const panel = await mountTestElement(<SettingsGeneral />);
    expect(panel.text()).toContain("Default project folder");
    expect(panel.text()).toContain("Thread finished");
    await panel.unmount();
  });

  it("SettingsGeneral keeps phone pairing visible when the desktop preload needs restarting", async () => {
    state.remoteAccess = "restart-required";
    const panel = await mountTestElement(<SettingsGeneral />);

    expect(panel.text()).toContain("Remote access");
    expect(panel.text()).toContain("Connect phone");
    expect(panel.text()).toContain("Restart required");
    expect(panel.text()).toContain("Restart Honk to load phone pairing");
    expect(panel.text()).not.toContain("Show code…");
    await panel.unmount();
  });

  it("SettingsGeneral exposes the QR-code action when phone pairing is ready", async () => {
    state.remoteAccess = "ready";
    const panel = await mountTestElement(<SettingsGeneral />);

    expect(panel.text()).toContain("Remote access");
    expect(panel.text()).toContain("Connect phone");
    expect(panel.text()).toContain("Show code…");
    await panel.unmount();
  });

  it("SettingsAppearance mounts and renders its primary content", async () => {
    const panel = await mountTestElement(<SettingsAppearance />);
    expect(panel.text()).toContain("Color mode");
    expect(panel.text()).toContain("Interface font");
    await panel.unmount();
  });

  it("SettingsProviders renders the catalog rows over a ready core", async () => {
    state.catalog = {
      status: "ready",
      providers: [fauxProvider(true)],
      error: null,
    };
    const panel = await mountTestElement(<SettingsProviders />);
    expect(panel.text()).toContain("Anthropic");
    expect(panel.text()).toContain("Connected");
    expect(panel.text()).toContain("Add provider");
    expect(state.refreshCatalog).toHaveBeenCalledTimes(1);
    await panel.unmount();
  });

  it("AddProviderForm withholds the key entry until a provider is chosen", async () => {
    const panel = await mountTestElement(
      <AddProviderForm
        providers={[fauxProvider(false)]}
        onSave={async () => undefined}
        onClose={() => undefined}
      />,
    );
    expect(panel.text()).toContain("Choose a provider");
    expect(panel.labels()).toContain("Provider");
    expect(panel.labels()).not.toContain("Anthropic API key");
    // The submit is gated on the same choice, so it stays out until there is a key to send.
    expect(panel.text()).not.toContain("Add provider");
    expect(panel.text()).toContain("Cancel");
    await panel.unmount();
  });

  it("SettingsProviders tells the truth when core is unavailable", async () => {
    state.core = { status: "unavailable" };
    const panel = await mountTestElement(<SettingsProviders />);
    expect(panel.text()).toContain("Honk Core is not available in this host.");
    await panel.unmount();
  });

  it("SettingsProviders renders a status line while its data connects", async () => {
    state.core = { status: "connecting" };
    const corePanel = await mountTestElement(<SettingsProviders />);
    expect(corePanel.text()).toContain("Connecting to Honk Core…");
    await corePanel.unmount();

    state.core = { status: "ready", client: { models: {} } };
    state.catalog = { status: "loading" };
    const catalogPanel = await mountTestElement(<SettingsProviders />);
    expect(catalogPanel.text()).toContain("Loading accounts…");
    await catalogPanel.unmount();
  });

  it("SettingsMcp renders a status line while resolving the chat folder", async () => {
    state.workspace = { status: "loading" };
    const panel = await mountTestElement(<SettingsMcp />);
    expect(panel.text()).toContain("Finding this chat's folder…");
    await panel.unmount();
  });

  it("SettingsMcp settles to ready content with exactly one list call", async () => {
    const listDeferred = deferred<{ servers: readonly unknown[] }>();
    const statusDeferred = deferred<{ servers: readonly unknown[] }>();
    const list = vi.fn(() => listDeferred.promise);
    const status = vi.fn(() => statusDeferred.promise);
    state.client = { mcp: { list, status } };

    const panel = await mountTestElement(<SettingsMcp />);
    expect(panel.text()).toContain("Loading MCP servers…");
    await act(async () => {
      listDeferred.resolve({ servers: [] });
      statusDeferred.resolve({ servers: [] });
    });

    expect(panel.text()).toContain("No MCP servers configured.");
    // The loop regression contract: a re-render loop refires the load effect,
    // so a second list call (or act never settling) fails this test.
    expect(list).toHaveBeenCalledTimes(1);
    await panel.unmount();
  });
});
