import * as Effect from "effect/Effect";

import * as DesktopIpc from "./desktop-ipc";
import {
  commandBrowserView,
  destroyBrowserView,
  detachBrowserView,
  syncBrowserView,
} from "./methods/browser-view";
import { getHonkCoreConnection } from "./methods/honk-core";
import {
  cancelRemotePairing,
  disableTailscaleRemoteAccess,
  enableTailscaleRemoteAccess,
  getRemotePairingState,
  getTailscaleRemoteAccess,
  issueRemotePairing,
  listRemoteDevices,
  revokeRemoteDevice,
} from "./methods/tailscale-remote-access";
import { showThreadNotification } from "./methods/notifications";
import { setKeepAwake } from "./methods/power";
import { completeOnboarding } from "./methods/onboarding";
import { attachPty, closePty, listPty, openPty, resizePty, writePty } from "./methods/pty";
import { getClientSettings, setClientSettings } from "./methods/client-settings";
import { logRendererDiagnostic } from "./methods/renderer-diagnostics";
import { reportStartupMilestone } from "./methods/startup-probe";
import { checkForUpdate, downloadUpdate, getUpdateState, installUpdate } from "./methods/updates";
import {
  expandWindowWidth,
  getAppBranding,
  getHomeDirectory,
  getWindowChromeState,
  openInEditor,
  openExternal,
  pickFolder,
  setActiveWorkState,
  setBackgroundColor,
  setTheme,
  setVibrancy,
  showContextMenu,
  showItemInFolder,
} from "./methods/window";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getWindowChromeState);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(getHonkCoreConnection);
  yield* ipc.handle(getTailscaleRemoteAccess);
  yield* ipc.handle(enableTailscaleRemoteAccess);
  yield* ipc.handle(disableTailscaleRemoteAccess);
  yield* ipc.handle(issueRemotePairing);
  yield* ipc.handle(getRemotePairingState);
  yield* ipc.handle(cancelRemotePairing);
  yield* ipc.handle(listRemoteDevices);
  yield* ipc.handle(revokeRemoteDevice);
  yield* ipc.handle(completeOnboarding);

  yield* ipc.handle(openPty);
  yield* ipc.handle(attachPty);
  yield* ipc.handle(listPty);
  yield* ipc.handle(writePty);
  yield* ipc.handle(resizePty);
  yield* ipc.handle(closePty);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(getHomeDirectory);
  yield* ipc.handle(syncBrowserView);
  yield* ipc.handle(detachBrowserView);
  yield* ipc.handle(commandBrowserView);
  yield* ipc.handle(destroyBrowserView);
  yield* ipc.handle(setActiveWorkState);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(setBackgroundColor);
  yield* ipc.handle(setKeepAwake);
  yield* ipc.handle(expandWindowWidth);
  yield* ipc.handle(setVibrancy);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);
  yield* ipc.handle(openInEditor);
  yield* ipc.handle(showItemInFolder);
  yield* ipc.handle(showThreadNotification);

  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
  yield* ipc.handle(logRendererDiagnostic);
  yield* ipc.handle(reportStartupMilestone);
}).pipe(Effect.withSpan("desktop.ipc.installHandlers"));
