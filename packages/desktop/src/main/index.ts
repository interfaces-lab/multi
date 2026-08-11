import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUrl from "node:url";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

import { NetService } from "@honk/shared/Net";

import * as DesktopIpc from "../ipc/desktop-ipc";
import * as ElectronApp from "../electron/electron-app";
import * as ElectronDialog from "../electron/electron-dialog";
import * as ElectronMenu from "../electron/electron-menu";
import * as ElectronProtocol from "../electron/electron-protocol";
import * as ElectronShell from "../electron/electron-shell";
import * as ElectronTheme from "../electron/electron-theme";
import * as ElectronUpdater from "../electron/electron-updater";
import * as ElectronWindow from "../electron/electron-window";
import * as DesktopApp from "../app/desktop-app";
import * as DesktopActiveWork from "../app/desktop-active-work";
import * as DesktopAppIdentity from "../app/desktop-app-identity";
import * as DesktopApplicationMenu from "../window/desktop-application-menu";
import * as DesktopAssets from "../app/desktop-assets";
import * as DesktopPty from "../backend/desktop-pty";
import * as HonkCoreHost from "../backend/honk-core-host";
import * as TailscaleRemoteAccess from "../backend/tailscale-remote-access";
import * as DesktopEnvironment from "../app/desktop-environment";
import * as DesktopLifecycle from "../app/desktop-lifecycle";
import * as DesktopObservability from "../app/desktop-observability";
import * as DesktopQuitGuard from "../app/desktop-quit-guard";
import * as DesktopClientSettings from "../settings/desktop-client-settings";
import * as DesktopAppSettings from "../settings/desktop-app-settings";
import * as DesktopShellEnvironment from "../shell/desktop-shell-environment";
import * as DesktopState from "../app/desktop-state";
import * as DesktopUpdates from "../updates/desktop-updates";
import * as DesktopWindow from "../window/desktop-window";
import * as DesktopBrowserAutomation from "../browser/browser-automation";
import * as DesktopBrowserViews from "../browser/browser-views";

const currentDirname = NodePath.dirname(NodeUrl.fileURLToPath(import.meta.url));

const desktopEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const metadata = yield* Effect.service(ElectronApp.ElectronApp).pipe(
      Effect.flatMap((app) => app.metadata),
    );
    return DesktopEnvironment.layer({
      dirname: currentDirname,
      homeDirectory: NodeOS.homedir(),
      platform: process.platform,
      processArch: process.arch,
      ...metadata,
    });
  }),
);

const electronLayer = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronMenu.layer,
  ElectronProtocol.layer,
  ElectronShell.layer,
  ElectronTheme.layer,
  ElectronUpdater.layer,
  ElectronWindow.layer,
  Layer.succeed(DesktopIpc.DesktopIpc, DesktopIpc.make(Electron.ipcMain)),
);

const desktopFoundationLayer = Layer.mergeAll(
  DesktopActiveWork.layer,
  DesktopState.layer,
  DesktopLifecycle.layerShutdown,
  DesktopAppSettings.layer,
  DesktopClientSettings.layer,
  DesktopAssets.layer,
  DesktopObservability.layer,
).pipe(Layer.provideMerge(desktopEnvironmentLayer));

const desktopWindowLayer = DesktopWindow.layer.pipe(Layer.provideMerge(desktopFoundationLayer));

const desktopUpdatesLayer = DesktopUpdates.layer.pipe(Layer.provideMerge(desktopWindowLayer));

const desktopBrowserLayer = DesktopBrowserViews.layer.pipe(
  Layer.provideMerge(DesktopBrowserAutomation.layer),
);

const coreRemoteAccessLayer = TailscaleRemoteAccess.layer.pipe(
  Layer.provideMerge(HonkCoreHost.layer),
);

const desktopApplicationLayer = Layer.mergeAll(
  DesktopLifecycle.layer,
  DesktopQuitGuard.layer,
  DesktopApplicationMenu.layer,
  DesktopShellEnvironment.layer,
  desktopBrowserLayer,
  DesktopPty.layer,
  coreRemoteAccessLayer,
).pipe(
  Layer.provideMerge(desktopUpdatesLayer),
  Layer.provideMerge(DesktopAppIdentity.layer),
  Layer.provideMerge(desktopWindowLayer),
);

const desktopRuntimeLayer = ElectronProtocol.layerSchemePrivileges.pipe(
  Layer.flatMap(() =>
    desktopApplicationLayer.pipe(
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(NodeHttpClient.layerUndici),
      Layer.provideMerge(NetService.layer),
      Layer.provideMerge(electronLayer),
    ),
  ),
);

DesktopApp.program.pipe(Effect.provide(desktopRuntimeLayer), NodeRuntime.runMain);
