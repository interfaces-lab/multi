import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { HonkConnection } from "@honk/core";
import type { BrowserAutomationOpenRequest } from "@honk/shared/browser-automation";
import {
  type DesktopAppBranding,
  type DesktopBridge,
  type DesktopBrowserViewState,
  type DesktopPtyBridge,
  type DesktopRemoteDevice,
  type DesktopRemotePairingInvitation,
  type DesktopRemotePairingState,
  type DesktopRendererDiagnosticInput,
  type DesktopTailscaleRemoteAccessState,
  type DesktopThreadNotificationInput,
  type DesktopThreadNotificationTarget,
  type DesktopUpdateState,
  type DesktopWindowChromeState,
} from "@honk/shared/desktop-api";

type RendererStartupMilestone = "renderer-authenticated";

type DesktopBridgeWithCore = DesktopBridge<never> & {
  readonly getHonkCoreConnection: () => Promise<HonkConnection>;
  readonly getTailscaleRemoteAccess: () => Promise<DesktopTailscaleRemoteAccessState>;
  readonly enableTailscaleRemoteAccess: () => Promise<DesktopTailscaleRemoteAccessState>;
  readonly disableTailscaleRemoteAccess: () => Promise<DesktopTailscaleRemoteAccessState>;
  readonly issueRemotePairing: () => Promise<DesktopRemotePairingInvitation>;
  readonly getRemotePairingState: (input: {
    readonly id: string;
  }) => Promise<DesktopRemotePairingState>;
  readonly cancelRemotePairing: (input: { readonly id: string }) => Promise<boolean>;
  readonly listRemoteDevices: () => Promise<readonly DesktopRemoteDevice[]>;
  readonly revokeRemoteDevice: (input: { readonly id: string }) => Promise<boolean>;
  readonly reportStartupMilestone?: (milestone: RendererStartupMilestone) => Promise<void>;
  readonly pty: DesktopPtyBridge;
};

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const GET_HOME_DIRECTORY_CHANNEL = "desktop:get-home-directory";
const COMPLETE_ONBOARDING_CHANNEL = "desktop:complete-onboarding";
const SET_THEME_CHANNEL = "desktop:set-theme";
const SET_BACKGROUND_COLOR_CHANNEL = "desktop:set-background-color";
const SET_VIBRANCY_CHANNEL = "desktop:set-vibrancy";
const SET_KEEP_AWAKE_CHANNEL = "desktop:set-keep-awake";
const EXPAND_WINDOW_WIDTH_CHANNEL = "desktop:expand-window-width";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const OPEN_IN_EDITOR_CHANNEL = "desktop:open-in-editor";
const SHOW_ITEM_IN_FOLDER_CHANNEL = "desktop:show-item-in-folder";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const SHOW_THREAD_NOTIFICATION_CHANNEL = "desktop:show-thread-notification";
const THREAD_NOTIFICATION_ACTIVATE_CHANNEL = "desktop:thread-notification-activate";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_APP_BRANDING_CHANNEL = "desktop:get-app-branding";
const SYNC_BROWSER_VIEW_CHANNEL = "desktop:sync-browser-view";
const DETACH_BROWSER_VIEW_CHANNEL = "desktop:detach-browser-view";
const COMMAND_BROWSER_VIEW_CHANNEL = "desktop:command-browser-view";
const DESTROY_BROWSER_VIEW_CHANNEL = "desktop:destroy-browser-view";
const BROWSER_VIEW_STATE_CHANNEL = "desktop:browser-view-state";
const BROWSER_AUTOMATION_OPEN_CHANNEL = "desktop:browser-automation-open";
const GET_HONK_CORE_CONNECTION_CHANNEL = "desktop:get-honk-core-connection";
const GET_TAILSCALE_REMOTE_ACCESS_CHANNEL = "desktop:get-tailscale-remote-access";
const ENABLE_TAILSCALE_REMOTE_ACCESS_CHANNEL = "desktop:enable-tailscale-remote-access";
const DISABLE_TAILSCALE_REMOTE_ACCESS_CHANNEL = "desktop:disable-tailscale-remote-access";
const ISSUE_REMOTE_PAIRING_CHANNEL = "desktop:issue-remote-pairing";
const GET_REMOTE_PAIRING_STATE_CHANNEL = "desktop:get-remote-pairing-state";
const CANCEL_REMOTE_PAIRING_CHANNEL = "desktop:cancel-remote-pairing";
const LIST_REMOTE_DEVICES_CHANNEL = "desktop:list-remote-devices";
const REVOKE_REMOTE_DEVICE_CHANNEL = "desktop:revoke-remote-device";
const REPORT_STARTUP_MILESTONE_CHANNEL = "desktop:report-startup-milestone";
const GET_WINDOW_CHROME_STATE_CHANNEL = "desktop:get-window-chrome-state";
const WINDOW_CHROME_STATE_CHANNEL = "desktop:window-chrome-state";
const SET_ACTIVE_WORK_STATE_CHANNEL = "desktop:set-active-work-state";
const GET_CLIENT_SETTINGS_CHANNEL = "desktop:get-client-settings";
const SET_CLIENT_SETTINGS_CHANNEL = "desktop:set-client-settings";
const LOG_RENDERER_DIAGNOSTIC_CHANNEL = "desktop:log-renderer-diagnostic";
const PTY_OPEN_CHANNEL = "desktop:pty-open";
const PTY_WRITE_CHANNEL = "desktop:pty-write";
const PTY_RESIZE_CHANNEL = "desktop:pty-resize";
const PTY_CLOSE_CHANNEL = "desktop:pty-close";
const PTY_ATTACH_CHANNEL = "desktop:pty-attach";
const PTY_LIST_CHANNEL = "desktop:pty-list";
const PTY_DATA_CHANNEL = "desktop:pty-data";
const PTY_EXIT_CHANNEL = "desktop:pty-exit";
const WINDOW_ID_ARGUMENT_PREFIX = "--honk-window-id=";

function readWindowID(): string {
  const argument = process.argv.find((value) => value.startsWith(WINDOW_ID_ARGUMENT_PREFIX));
  const windowID = argument?.slice(WINDOW_ID_ARGUMENT_PREFIX.length).trim() ?? "";
  return windowID.length > 0 ? windowID : "main";
}

function readWindowChromeState(): DesktopWindowChromeState {
  const state: unknown = ipcRenderer.sendSync(GET_WINDOW_CHROME_STATE_CHANNEL);
  if (
    typeof state === "object" &&
    state !== null &&
    typeof Reflect.get(state, "fullscreen") === "boolean"
  ) {
    return state as DesktopWindowChromeState;
  }
  return { fullscreen: false };
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppBranding: () => {
    const result: unknown = ipcRenderer.sendSync(GET_APP_BRANDING_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as DesktopAppBranding;
  },
  getWindowID: readWindowID,
  syncBrowserView: (input) => ipcRenderer.invoke(SYNC_BROWSER_VIEW_CHANNEL, input),
  detachBrowserView: (input) => ipcRenderer.invoke(DETACH_BROWSER_VIEW_CHANNEL, input),
  commandBrowserView: (input) => ipcRenderer.invoke(COMMAND_BROWSER_VIEW_CHANNEL, input),
  destroyBrowserView: (input) => ipcRenderer.invoke(DESTROY_BROWSER_VIEW_CHANNEL, input),
  onBrowserViewState: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, state: DesktopBrowserViewState) => {
      listener(state);
    };

    ipcRenderer.on(BROWSER_VIEW_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(BROWSER_VIEW_STATE_CHANNEL, wrappedListener);
    };
  },
  onBrowserAutomationOpen: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, input: BrowserAutomationOpenRequest) => {
      listener(input);
    };

    ipcRenderer.on(BROWSER_AUTOMATION_OPEN_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(BROWSER_AUTOMATION_OPEN_CHANNEL, wrappedListener);
    };
  },
  getHonkCoreConnection: () => ipcRenderer.invoke(GET_HONK_CORE_CONNECTION_CHANNEL),
  getTailscaleRemoteAccess: () => ipcRenderer.invoke(GET_TAILSCALE_REMOTE_ACCESS_CHANNEL),
  enableTailscaleRemoteAccess: () => ipcRenderer.invoke(ENABLE_TAILSCALE_REMOTE_ACCESS_CHANNEL),
  disableTailscaleRemoteAccess: () => ipcRenderer.invoke(DISABLE_TAILSCALE_REMOTE_ACCESS_CHANNEL),
  issueRemotePairing: () => ipcRenderer.invoke(ISSUE_REMOTE_PAIRING_CHANNEL),
  getRemotePairingState: (input) => ipcRenderer.invoke(GET_REMOTE_PAIRING_STATE_CHANNEL, input),
  cancelRemotePairing: (input) => ipcRenderer.invoke(CANCEL_REMOTE_PAIRING_CHANNEL, input),
  listRemoteDevices: () => ipcRenderer.invoke(LIST_REMOTE_DEVICES_CHANNEL),
  revokeRemoteDevice: (input) => ipcRenderer.invoke(REVOKE_REMOTE_DEVICE_CHANNEL, input),
  ...(process.env.HONK_DEV_STARTUP_PROBE === "1"
    ? {
        reportStartupMilestone: (milestone: RendererStartupMilestone) =>
          ipcRenderer.invoke(REPORT_STARTUP_MILESTONE_CHANNEL, milestone),
      }
    : {}),
  getWindowChromeState: readWindowChromeState,
  onWindowChromeState: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, state: DesktopWindowChromeState) => {
      listener(state);
    };

    ipcRenderer.on(WINDOW_CHROME_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(WINDOW_CHROME_STATE_CHANNEL, wrappedListener);
    };
  },
  setActiveWorkState: (state) => ipcRenderer.invoke(SET_ACTIVE_WORK_STATE_CHANNEL, state),
  getClientSettings: () => ipcRenderer.invoke(GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) => ipcRenderer.invoke(SET_CLIENT_SETTINGS_CHANNEL, settings),
  pickFolder: (options) => ipcRenderer.invoke(PICK_FOLDER_CHANNEL, options),
  getHomeDirectory: () => ipcRenderer.invoke(GET_HOME_DIRECTORY_CHANNEL),
  completeOnboarding: () => ipcRenderer.invoke(COMPLETE_ONBOARDING_CHANNEL),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  setBackgroundColor: (color) => ipcRenderer.invoke(SET_BACKGROUND_COLOR_CHANNEL, color),
  setVibrancy: (enabled) => ipcRenderer.invoke(SET_VIBRANCY_CHANNEL, enabled),
  setKeepAwake: (enabled) => ipcRenderer.invoke(SET_KEEP_AWAKE_CHANNEL, enabled),
  expandWindowWidth: (additionalWidth) =>
    ipcRenderer.invoke(EXPAND_WINDOW_WIDTH_CHANNEL, additionalWidth),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  openInEditor: (cwd, editor) => ipcRenderer.invoke(OPEN_IN_EDITOR_CHANNEL, { cwd, editor }),
  showItemInFolder: (path: string) => ipcRenderer.invoke(SHOW_ITEM_IN_FOLDER_CHANNEL, path),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  showThreadNotification: (input: DesktopThreadNotificationInput) =>
    ipcRenderer.invoke(SHOW_THREAD_NOTIFICATION_CHANNEL, input),
  onThreadNotificationActivate: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, target: DesktopThreadNotificationTarget) => {
      listener(target);
    };

    ipcRenderer.on(THREAD_NOTIFICATION_ACTIVATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(THREAD_NOTIFICATION_ACTIVATE_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, state: DesktopUpdateState) => {
      listener(state);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  logRendererDiagnostic: (input: DesktopRendererDiagnosticInput) =>
    ipcRenderer.invoke(LOG_RENDERER_DIAGNOSTIC_CHANNEL, input),
  pty: {
    open: (options) => ipcRenderer.invoke(PTY_OPEN_CHANNEL, options),
    // Contract is `=> void`. Discard the invoke promise.
    write: (id, data) => {
      void ipcRenderer.invoke(PTY_WRITE_CHANNEL, { id, data });
    },
    resize: (id, cols, rows) => {
      void ipcRenderer.invoke(PTY_RESIZE_CHANNEL, { id, cols, rows });
    },
    close: (id) => {
      void ipcRenderer.invoke(PTY_CLOSE_CHANNEL, { id });
    },
    attach: (id) => ipcRenderer.invoke(PTY_ATTACH_CHANNEL, { id }),
    list: (threadId) => ipcRenderer.invoke(PTY_LIST_CHANNEL, { threadId }),
    onData: (id, listener) => {
      const wrappedListener = (_event: IpcRendererEvent, payload: { id: string; data: string }) => {
        if (payload.id === id) {
          listener(payload.data);
        }
      };
      ipcRenderer.on(PTY_DATA_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(PTY_DATA_CHANNEL, wrappedListener);
      };
    },
    onExit: (id, listener) => {
      const wrappedListener = (
        _event: IpcRendererEvent,
        payload: { id: string; code: number | null },
      ) => {
        if (payload.id === id) {
          listener(payload.code);
        }
      };
      ipcRenderer.on(PTY_EXIT_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(PTY_EXIT_CHANNEL, wrappedListener);
      };
    },
  },
} satisfies DesktopBridgeWithCore);
