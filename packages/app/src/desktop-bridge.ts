// Electron preload seam. The Vite web build has no bridge and every helper
// degrades to a no-op or a null capability.

import type {
  DesktopBrowserViewCommandInput,
  DesktopBrowserViewDetachInput,
  DesktopBrowserViewDestroyInput,
  DesktopBrowserViewState,
  DesktopBrowserViewSyncInput,
  DesktopPtyBridge,
  DesktopRemoteDevice,
  DesktopRemotePairingInvitation,
  DesktopRemotePairingState,
  DesktopTailscaleRemoteAccessState,
  DesktopThreadNotificationInput,
  DesktopThreadNotificationTarget,
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
} from "@honk/shared/desktop-api";
import type { HonkConnection } from "@honk/core";

type DesktopWindowChromeState = {
  readonly fullscreen: boolean;
};

export type { DesktopPtyBridge } from "@honk/shared/desktop-api";

type DesktopBridgeSurface = {
  readonly getWindowID?: () => string;
  readonly getWindowChromeState?: () => DesktopWindowChromeState;
  readonly onWindowChromeState?: (
    listener: (state: DesktopWindowChromeState) => void,
  ) => () => void;
  readonly reportStartupMilestone?: (milestone: "renderer-authenticated") => Promise<void>;
  readonly getHonkCoreConnection?: () => Promise<HonkConnection>;
  readonly getTailscaleRemoteAccess?: () => Promise<DesktopTailscaleRemoteAccessState>;
  readonly enableTailscaleRemoteAccess?: () => Promise<DesktopTailscaleRemoteAccessState>;
  readonly disableTailscaleRemoteAccess?: () => Promise<DesktopTailscaleRemoteAccessState>;
  readonly issueRemotePairing?: () => Promise<DesktopRemotePairingInvitation>;
  readonly getRemotePairingState?: (input: {
    readonly id: string;
  }) => Promise<DesktopRemotePairingState>;
  readonly cancelRemotePairing?: (input: { readonly id: string }) => Promise<boolean>;
  readonly listRemoteDevices?: () => Promise<readonly DesktopRemoteDevice[]>;
  readonly revokeRemoteDevice?: (input: { readonly id: string }) => Promise<boolean>;
  readonly pickFolder?: (options?: {
    readonly initialPath?: string | null;
  }) => Promise<string | null>;
  readonly showItemInFolder?: (path: string) => Promise<boolean>;
  readonly openExternal?: (url: string) => Promise<boolean>;
  readonly onMenuAction?: (listener: (action: string) => void) => () => void;
  readonly showThreadNotification?: (input: DesktopThreadNotificationInput) => Promise<void>;
  readonly onThreadNotificationActivate?: (
    listener: (target: DesktopThreadNotificationTarget) => void,
  ) => () => void;
  readonly getHomeDirectory?: () => Promise<string>;
  readonly completeOnboarding?: () => Promise<void>;
  readonly setTheme?: (theme: "system" | "light" | "dark") => Promise<void>;
  readonly setKeepAwake?: (enabled: boolean) => Promise<boolean>;
  readonly syncBrowserView?: (
    input: DesktopBrowserViewSyncInput,
  ) => Promise<DesktopBrowserViewState>;
  readonly detachBrowserView?: (input: DesktopBrowserViewDetachInput) => Promise<void>;
  readonly commandBrowserView?: (
    input: DesktopBrowserViewCommandInput,
  ) => Promise<DesktopBrowserViewState>;
  readonly destroyBrowserView?: (input: DesktopBrowserViewDestroyInput) => Promise<void>;
  readonly onBrowserViewState?: (listener: (state: DesktopBrowserViewState) => void) => () => void;
  readonly getUpdateState?: () => Promise<DesktopUpdateState>;
  readonly checkForUpdate?: () => Promise<DesktopUpdateCheckResult>;
  readonly downloadUpdate?: () => Promise<DesktopUpdateActionResult>;
  readonly installUpdate?: () => Promise<DesktopUpdateActionResult>;
  readonly onUpdateState?: (listener: (state: DesktopUpdateState) => void) => () => void;
  readonly pty?: DesktopPtyBridge;
};

declare global {
  interface Window {
    readonly desktopBridge?: DesktopBridgeSurface;
  }
}

function readDesktopBridge(): DesktopBridgeSurface | null {
  return window.desktopBridge ?? null;
}

export type DesktopBrowserBridge = Required<
  Pick<
    DesktopBridgeSurface,
    | "syncBrowserView"
    | "detachBrowserView"
    | "commandBrowserView"
    | "destroyBrowserView"
    | "onBrowserViewState"
  >
>;

export type DesktopBrowserAvailability =
  | { readonly status: "web" }
  | { readonly status: "restart-required" }
  | { readonly status: "ready"; readonly bridge: DesktopBrowserBridge };

export function readDesktopBrowserAvailability(): DesktopBrowserAvailability {
  const bridge = readDesktopBridge();
  if (bridge === null) return { status: "web" };
  const {
    syncBrowserView,
    detachBrowserView,
    commandBrowserView,
    destroyBrowserView,
    onBrowserViewState,
  } = bridge;
  if (
    syncBrowserView === undefined ||
    detachBrowserView === undefined ||
    commandBrowserView === undefined ||
    destroyBrowserView === undefined ||
    onBrowserViewState === undefined
  ) {
    return { status: "restart-required" };
  }
  return {
    status: "ready",
    bridge: {
      syncBrowserView,
      detachBrowserView,
      commandBrowserView,
      destroyBrowserView,
      onBrowserViewState,
    },
  };
}

/** Stable per-window identity for tab persistence; web builds share "browser". */
export function readShellWindowID(): string {
  return readDesktopBridge()?.getWindowID?.() ?? "browser";
}

export function shouldUseDesktopGlass(): boolean {
  return readDesktopBridge() !== null && /^Mac/.test(navigator.platform);
}

export function reportDesktopAuthenticatedPaint(): void {
  void readDesktopBridge()?.reportStartupMilestone?.("renderer-authenticated");
}

export function canSetDesktopKeepAwake(): boolean {
  return readDesktopBridge()?.setKeepAwake !== undefined;
}

export async function setDesktopKeepAwake(enabled: boolean): Promise<boolean> {
  return (await readDesktopBridge()?.setKeepAwake?.(enabled)) ?? false;
}

export async function openDesktopExternal(url: string): Promise<boolean> {
  return (await readDesktopBridge()?.openExternal?.(url)) ?? false;
}

export function subscribeDesktopMenuAction(listener: (action: string) => void): () => void {
  return readDesktopBridge()?.onMenuAction?.(listener) ?? (() => {});
}

export function showDesktopThreadNotification(input: DesktopThreadNotificationInput): boolean {
  const show = readDesktopBridge()?.showThreadNotification;
  if (show === undefined) return false;
  void show(input);
  return true;
}

export function subscribeDesktopThreadNotificationActivate(
  listener: (target: DesktopThreadNotificationTarget) => void,
): () => void {
  return readDesktopBridge()?.onThreadNotificationActivate?.(listener) ?? (() => {});
}

export function canPickFolder(): boolean {
  return readDesktopBridge()?.pickFolder !== undefined;
}

export async function pickFolder(initialPath?: string | null): Promise<string | null> {
  const picker = readDesktopBridge()?.pickFolder;
  if (picker === undefined) return null;
  try {
    return await picker({ initialPath: initialPath ?? null });
  } catch {
    return null;
  }
}

export function canShowItemInFolder(): boolean {
  return readDesktopBridge()?.showItemInFolder !== undefined;
}

export async function showItemInFolder(path: string): Promise<boolean> {
  return (await readDesktopBridge()?.showItemInFolder?.(path)) ?? false;
}

export async function getHonkCoreConnection(): Promise<HonkConnection | null> {
  const read = readDesktopBridge()?.getHonkCoreConnection;
  if (read === undefined) return null;
  try {
    return await read();
  } catch {
    return null;
  }
}

export type DesktopRemoteAccessAvailability =
  | { readonly status: "web" }
  | { readonly status: "restart-required" }
  | { readonly status: "ready" };

export function readDesktopRemoteAccessAvailability(): DesktopRemoteAccessAvailability {
  const bridge = readDesktopBridge();
  if (bridge === null) return { status: "web" };
  if (
    bridge.getTailscaleRemoteAccess !== undefined &&
    bridge.enableTailscaleRemoteAccess !== undefined &&
    bridge.disableTailscaleRemoteAccess !== undefined &&
    bridge.issueRemotePairing !== undefined &&
    bridge.getRemotePairingState !== undefined &&
    bridge.cancelRemotePairing !== undefined &&
    bridge.listRemoteDevices !== undefined &&
    bridge.revokeRemoteDevice !== undefined
  ) {
    return { status: "ready" };
  }
  return { status: "restart-required" };
}

export async function getTailscaleRemoteAccess(): Promise<DesktopTailscaleRemoteAccessState | null> {
  return (await readDesktopBridge()?.getTailscaleRemoteAccess?.()) ?? null;
}

export async function enableTailscaleRemoteAccess(): Promise<DesktopTailscaleRemoteAccessState | null> {
  return (await readDesktopBridge()?.enableTailscaleRemoteAccess?.()) ?? null;
}

export async function disableTailscaleRemoteAccess(): Promise<DesktopTailscaleRemoteAccessState | null> {
  return (await readDesktopBridge()?.disableTailscaleRemoteAccess?.()) ?? null;
}

export async function issueRemotePairing(): Promise<DesktopRemotePairingInvitation | null> {
  return (await readDesktopBridge()?.issueRemotePairing?.()) ?? null;
}

export async function getRemotePairingState(id: string): Promise<DesktopRemotePairingState | null> {
  return (await readDesktopBridge()?.getRemotePairingState?.({ id })) ?? null;
}

export async function cancelRemotePairing(id: string): Promise<boolean> {
  return (await readDesktopBridge()?.cancelRemotePairing?.({ id })) ?? false;
}

export async function listRemoteDevices(): Promise<readonly DesktopRemoteDevice[]> {
  return (await readDesktopBridge()?.listRemoteDevices?.()) ?? [];
}

export async function revokeRemoteDevice(id: string): Promise<boolean> {
  return (await readDesktopBridge()?.revokeRemoteDevice?.({ id })) ?? false;
}

export async function getHomeDirectory(): Promise<string | null> {
  const read = readDesktopBridge()?.getHomeDirectory;
  if (read === undefined) return null;
  try {
    return await read();
  } catch {
    return null;
  }
}

export function canReplayDesktopSetup(): boolean {
  return readDesktopBridge() !== null;
}

export async function completeDesktopOnboarding(): Promise<void> {
  await readDesktopBridge()?.completeOnboarding?.();
}

export function getPtyBridge(): DesktopPtyBridge | null {
  return readDesktopBridge()?.pty ?? null;
}

export function installDesktopBridge(): void {
  const bridge = readDesktopBridge();
  if (bridge === null) return;
  document.documentElement.setAttribute("data-shell-platform", "electron");
  void bridge.getWindowChromeState?.();
}
