import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Ref from "effect/Ref";

import * as ElectronApp from "../electron/electron-app";
import * as ElectronDialog from "../electron/electron-dialog";
import * as ElectronProtocol from "../electron/electron-protocol";
import * as ElectronTheme from "../electron/electron-theme";
import { installDesktopIpcHandlers } from "../ipc/desktop-ipc-handlers";
import * as DesktopAppIdentity from "./desktop-app-identity";
import * as DesktopApplicationMenu from "../window/desktop-application-menu";
import * as DesktopEnvironment from "./desktop-environment";
import * as DesktopLifecycle from "./desktop-lifecycle";
import * as DesktopObservability from "./desktop-observability";
import * as EffectLogger from "@honk/shared/effect-logger";
import * as DesktopAppSettings from "../settings/desktop-app-settings";
import * as DesktopShellEnvironment from "../shell/desktop-shell-environment";
import * as DesktopState from "./desktop-state";
import * as DesktopUpdates from "../updates/desktop-updates";
import * as DesktopWindow from "../window/desktop-window";
import * as TailscaleRemoteAccess from "../backend/tailscale-remote-access";

const bootstrapLog = EffectLogger.create({ service: "desktop-bootstrap" });
const startupLog = EffectLogger.create({ service: "desktop-startup" });

const handleFatalStartupError = Effect.fn("desktop.startup.handleFatalStartupError")(function* (
  stage: string,
  error: unknown,
): Effect.fn.Return<
  void,
  never,
  | DesktopLifecycle.DesktopShutdown
  | DesktopState.DesktopState
  | ElectronApp.ElectronApp
  | ElectronDialog.ElectronDialog
> {
  const shutdown = yield* DesktopLifecycle.DesktopShutdown;
  const state = yield* DesktopState.DesktopState;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const message = error instanceof Error ? error.message : String(error);
  const detail =
    error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
  yield* startupLog.error("fatal startup error", {
    stage,
    message,
    ...(detail.length > 0 ? { detail } : {}),
  });
  const wasQuitting = yield* Ref.getAndSet(state.quitting, true);
  if (!wasQuitting) {
    yield* electronDialog.showErrorBox(
      "Honk failed to start",
      `Stage: ${stage}\n${message}${detail}`,
    );
  }
  yield* shutdown.request;
  yield* electronApp.quit;
});

const fatalStartupCause = <E>(stage: string, cause: Cause.Cause<E>) =>
  handleFatalStartupError(stage, Cause.pretty(cause)).pipe(Effect.andThen(Effect.failCause(cause)));

const bootstrap = Effect.gen(function* () {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* bootstrapLog.info("bootstrap start");

  yield* installDesktopIpcHandlers;
  yield* bootstrapLog.info("bootstrap ipc handlers registered");

  // IPC must be registered before the window so its preload's sendSync calls
  // have handlers. The Honk Core host is built with the application layer, so
  // the backend is already serving by the time the window loads.
  yield* desktopWindow.ensureMain;
  yield* desktopWindow.handleBackendReady;
}).pipe(Effect.withSpan("desktop.bootstrap"));

const startup = Effect.gen(function* () {
  const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
  const applicationMenu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
  const shellEnvironment = yield* DesktopShellEnvironment.DesktopShellEnvironment;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const remoteAccess = yield* TailscaleRemoteAccess.TailscaleRemoteAccess;

  yield* electronApp.setName(environment.displayName);
  yield* shellEnvironment.installIntoProcess;
  const userDataPath = yield* appIdentity.resolveUserDataPath;
  const fileSystem = yield* FileSystem.FileSystem;
  yield* fileSystem.makeDirectory(userDataPath, { recursive: true });
  yield* electronApp.appendCommandLineSwitch("user-data-dir", userDataPath);
  yield* electronApp.setPath("userData", userDataPath);
  yield* electronApp.setPath("sessionData", userDataPath);
  yield* startupLog.info("runtime logging configured", { logDir: environment.logDir });
  const settings = yield* desktopSettings.load;
  yield* electronTheme.setSource(settings.themeSource);
  yield* remoteAccess.restore(settings.tailscaleRemoteAccessEnabled);

  if (environment.platform === "linux") {
    yield* electronApp.appendCommandLineSwitch("class", environment.linuxWmClass);
  }

  yield* appIdentity.configure;
  yield* lifecycle.register;

  yield* electronApp.whenReady.pipe(
    Effect.withSpan("desktop.electron.whenReady"),
    Effect.catchCause((cause) => fatalStartupCause("whenReady", cause)),
  );
  yield* startupLog.info("app ready");
  yield* appIdentity.configure;
  yield* electronProtocol.registerDesktopFileProtocol;
  yield* bootstrap.pipe(Effect.catchCause((cause) => fatalStartupCause("bootstrap", cause)));
  yield* applicationMenu.configure;
  yield* updates.configure;
}).pipe(Effect.withSpan("desktop.startup"));

const scopedProgram = Effect.scoped(
  Effect.gen(function* () {
    const { runId, processInstanceId, processRole } = DesktopObservability.desktopProcessMetadata;
    yield* Effect.annotateLogsScoped({ scope: "desktop", runId, processInstanceId, processRole });
    yield* Effect.annotateCurrentSpan({ scope: "desktop", runId, processInstanceId, processRole });

    const shutdown = yield* DesktopLifecycle.DesktopShutdown;

    yield* Effect.addFinalizer(() => shutdown.markComplete);

    yield* startup;
    yield* shutdown.awaitRequest;
  }),
);

export const program = scopedProgram.pipe(Effect.withSpan("desktop.app"));
