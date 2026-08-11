import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Electron from "electron";

import type {
  DesktopThreadNotificationInput,
  DesktopThreadNotificationTarget,
} from "@honk/shared/desktop-api";
import * as EffectLogger from "@honk/shared/effect-logger";
import * as DesktopAssets from "../app/desktop-assets";
import * as DesktopEnvironment from "../app/desktop-environment";
import * as DesktopState from "../app/desktop-state";
import { desktopGlassBackground, desktopWindowBackground } from "./desktop-theme";
import * as ElectronShell from "../electron/electron-shell";
import * as ElectronTheme from "../electron/electron-theme";
import * as ElectronWindow from "../electron/electron-window";
import { DESKTOP_SCHEME } from "../electron/electron-protocol";
import * as IpcChannels from "../ipc/channels";
import * as DesktopAppSettings from "../settings/desktop-app-settings";
import { markStartupMilestone } from "../startup-probe";

const TITLEBAR_HEIGHT = 40;
// Traffic lights sit low enough to center against the bottom-seated tab band.
const MACOS_TRAFFIC_LIGHT_X_PX = 14;
const MACOS_TRAFFIC_LIGHT_Y_PX = 14;
const TITLEBAR_COLOR = "#01000000"; // #00000000 breaks on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";
const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;
// First run opens the one window straight onto the setup route; the renderer
// navigates to "/" itself once it has persisted the completion.
const SETUP_PATHNAME = "/setup";
const TRUSTED_RENDERER_PERMISSIONS = new Set([
  "clipboard-sanitized-write",
  "local-fonts",
  "notifications",
]);
const RENDERER_CONSOLE_REPEAT_LOG_WINDOW_MS = 30_000;
const RENDERER_CONSOLE_REPEAT_LOG_MAX_ENTRIES = 256;
const MAIN_WINDOW_ID = "main";

type WindowTitleBarOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

type DesktopWindowRuntimeServices =
  | DesktopEnvironment.DesktopEnvironment
  | DesktopAssets.DesktopAssets
  | DesktopAppSettings.DesktopAppSettings
  | DesktopState.DesktopState
  | ElectronShell.ElectronShell
  | ElectronTheme.ElectronTheme
  | ElectronWindow.ElectronWindow;

export class DesktopWindowDevServerUrlMissingError extends Data.TaggedError(
  "DesktopWindowDevServerUrlMissingError",
)<{}> {
  override get message() {
    return "VITE_DEV_SERVER_URL is required in desktop development.";
  }
}

export type DesktopWindowError =
  | DesktopWindowDevServerUrlMissingError
  | ElectronWindow.ElectronWindowCreateError
  | DesktopAppSettings.DesktopSettingsWriteError;

export interface DesktopWindowShape {
  readonly createMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly ensureMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly revealOrCreateMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
  readonly activate: Effect.Effect<void, DesktopWindowError>;
  readonly createMainIfBackendReady: Effect.Effect<void, DesktopWindowError>;
  readonly handleBackendReady: Effect.Effect<void, DesktopWindowError>;
  readonly completeOnboarding: Effect.Effect<void, DesktopWindowError>;
  readonly reload: Effect.Effect<void, DesktopWindowError>;
  readonly dispatchMenuAction: (action: string) => Effect.Effect<void, DesktopWindowError>;
  readonly showThreadNotification: (
    input: DesktopThreadNotificationInput,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly syncAppearance: Effect.Effect<void>;
}

export class DesktopWindow extends Context.Service<DesktopWindow, DesktopWindowShape>()(
  "honk/desktop/Window",
) {}

const elog = EffectLogger.create({ service: "desktop-window" });

const DESKTOP_RENDERER_ORIGIN = `${DESKTOP_SCHEME}://desktop`;
// Chromium's net::ERR_ABORTED; fires on rapid reloads and is not a dev-server failure.
const LOAD_ABORTED_ERROR_CODE = -3;
const DEV_RENDERER_RETRY_DELAY_MS = 750;
const DEV_RENDERER_RETRY_LIMIT = 80;
const rendererConsoleMessageLastSeen = new Map<string, number>();
const trustedRendererWebContentsIds = new Set<number>();

function resolveDesktopDevServerUrl(
  environment: DesktopEnvironment.DesktopEnvironmentShape,
): Effect.Effect<string, DesktopWindowDevServerUrlMissingError> {
  return Option.match(environment.devServerUrl, {
    onNone: () => Effect.fail(new DesktopWindowDevServerUrlMissingError()),
    onSome: (url) => Effect.succeed(url.href),
  });
}

function resolveMainWindowAppUrl(
  environment: DesktopEnvironment.DesktopEnvironmentShape,
): Effect.Effect<URL, DesktopWindowDevServerUrlMissingError> {
  if (environment.isDevelopment) {
    return resolveDesktopDevServerUrl(environment).pipe(Effect.map((href) => new URL(href)));
  }

  return Effect.succeed(new URL(`${DESKTOP_RENDERER_ORIGIN}/`));
}

function shouldLogRendererConsoleMessage(
  level: number,
  message: string,
  line: number,
  sourceId: string,
): boolean {
  const now = Date.now();
  const key = [level, sourceId, line, message].join("\0");
  const lastSeenAt = rendererConsoleMessageLastSeen.get(key);

  rendererConsoleMessageLastSeen.set(key, now);

  if (lastSeenAt !== undefined && now - lastSeenAt < RENDERER_CONSOLE_REPEAT_LOG_WINDOW_MS) {
    return false;
  }

  if (rendererConsoleMessageLastSeen.size > RENDERER_CONSOLE_REPEAT_LOG_MAX_ENTRIES) {
    const staleBefore = now - RENDERER_CONSOLE_REPEAT_LOG_WINDOW_MS;
    for (const [entryKey, entryLastSeenAt] of rendererConsoleMessageLastSeen) {
      if (
        entryLastSeenAt < staleBefore ||
        rendererConsoleMessageLastSeen.size > RENDERER_CONSOLE_REPEAT_LOG_MAX_ENTRIES
      ) {
        rendererConsoleMessageLastSeen.delete(entryKey);
      }
      if (rendererConsoleMessageLastSeen.size <= RENDERER_CONSOLE_REPEAT_LOG_MAX_ENTRIES) {
        break;
      }
    }
  }

  return true;
}

function getIconOption(
  iconPaths: DesktopAssets.DesktopIconPaths,
): { icon: string } | Record<string, never> {
  if (process.platform === "darwin") return {}; // macOS uses .icns from app bundle
  const ext = process.platform === "win32" ? "ico" : "png";
  return Option.match(iconPaths[ext], {
    onNone: () => ({}),
    onSome: (icon) => ({ icon }),
  });
}

function getInitialWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return desktopWindowBackground(shouldUseDarkColors);
}

function getMacGlassWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return desktopGlassBackground(shouldUseDarkColors);
}

function getInitialWindowGlassOptions(
  shouldUseDarkColors: boolean,
): Electron.BrowserWindowConstructorOptions {
  if (process.platform !== "darwin") {
    return {};
  }

  return {
    backgroundColor: getMacGlassWindowBackgroundColor(shouldUseDarkColors),
    hasShadow: true,
    vibrancy: "sidebar",
    visualEffectState: "active",
  };
}

function getMacOSTrafficLightPosition(): { x: number; y: number } {
  return { x: MACOS_TRAFFIC_LIGHT_X_PX, y: MACOS_TRAFFIC_LIGHT_Y_PX };
}

function syncMacOSTrafficLightPosition(window: Electron.BrowserWindow): void {
  if (process.platform !== "darwin" || window.isDestroyed()) {
    return;
  }

  window.setWindowButtonPosition(getMacOSTrafficLightPosition());
}

function getWindowTitleBarOptions(shouldUseDarkColors: boolean): WindowTitleBarOptions {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: getMacOSTrafficLightPosition(),
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: TITLEBAR_COLOR,
      height: TITLEBAR_HEIGHT,
      symbolColor: shouldUseDarkColors ? TITLEBAR_DARK_SYMBOL_COLOR : TITLEBAR_LIGHT_SYMBOL_COLOR,
    },
  };
}

function sendWindowChromeState(window: Electron.BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  syncMacOSTrafficLightPosition(window);
  window.webContents.send(IpcChannels.WINDOW_CHROME_STATE_CHANNEL, {
    fullscreen: window.isFullScreen(),
  });
}

function isTrustedRendererUrl(rawUrl: string | undefined, trustedOrigin: string): boolean {
  if (!rawUrl) {
    return false;
  }
  try {
    return new URL(rawUrl).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function registerRendererPermissions(window: Electron.BrowserWindow, trustedOrigin: string): void {
  const webContentsId = window.webContents.id;
  trustedRendererWebContentsIds.add(webContentsId);
  window.webContents.once("destroyed", () => {
    // webContents throws after this event. Keep the numeric id from while alive.
    trustedRendererWebContentsIds.delete(webContentsId);
  });
  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        TRUSTED_RENDERER_PERMISSIONS.has(permission) &&
          trustedRendererWebContentsIds.has(webContents.id) &&
          isTrustedRendererUrl(details.requestingUrl, trustedOrigin),
      );
    },
  );
  window.webContents.session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (!TRUSTED_RENDERER_PERMISSIONS.has(permission)) {
        return false;
      }
      if (webContents !== null && !trustedRendererWebContentsIds.has(webContents.id)) {
        return false;
      }
      return (
        isTrustedRendererUrl(details.requestingUrl, trustedOrigin) ||
        isTrustedRendererUrl(requestingOrigin, trustedOrigin)
      );
    },
  );
}

function preventUntrustedMainFrameNavigation(
  window: Electron.BrowserWindow,
  trustedOrigin: string,
  logBlockedNavigation: (url: string) => void,
): void {
  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url, trustedOrigin)) {
      return;
    }
    event.preventDefault();
    logBlockedNavigation(url);
  });
}

function syncWindowAppearance(
  window: Electron.BrowserWindow,
  shouldUseDarkColors: boolean,
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (window.isDestroyed()) {
      return;
    }

    const { titleBarOverlay } = getWindowTitleBarOptions(shouldUseDarkColors);
    if (typeof titleBarOverlay === "object") {
      window.setTitleBarOverlay(titleBarOverlay);
    }
    if (process.platform === "darwin") {
      window.setBackgroundColor(getMacGlassWindowBackgroundColor(shouldUseDarkColors));
      window.setVibrancy("sidebar");
    } else {
      window.setBackgroundColor(getInitialWindowBackgroundColor(shouldUseDarkColors));
    }
    syncMacOSTrafficLightPosition(window);
  });
}

type RevealSubscription = (listener: () => void) => void;

function bindFirstRevealTrigger(
  subscribers: readonly RevealSubscription[],
  reveal: () => void,
): void {
  let revealed = false;
  const fire = () => {
    if (revealed) return;
    revealed = true;
    reveal();
  };
  for (const subscribe of subscribers) {
    subscribe(fire);
  }
}

function windowReadyPromise(window: Electron.BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const subscribers: RevealSubscription[] = [
      (fire) => window.once("ready-to-show", fire),
      (fire) => window.once("closed", fire),
    ];
    if (process.platform === "linux") {
      subscribers.push((fire) => window.webContents.once("did-finish-load", fire));
    }
    bindFirstRevealTrigger(subscribers, resolve);
  });
}

function canSendToWindow(window: Electron.BrowserWindow): boolean {
  try {
    return !window.isDestroyed() && !window.webContents.isDestroyed();
  } catch {
    return false;
  }
}

interface CreatedDesktopWindow {
  readonly window: Electron.BrowserWindow;
  readonly ready: Promise<void>;
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const electronShell = yield* ElectronShell.ElectronShell;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const state = yield* DesktopState.DesktopState;
  const context = yield* Effect.context<DesktopWindowRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);
  const isStartupReviewEnabled =
    environment.isDevelopment && process.env.HONK_STARTUP_REVIEW === "1";

  const syncMainWindowAppearance = (window: Electron.BrowserWindow): Effect.Effect<void> =>
    electronTheme.shouldUseDarkColors.pipe(
      Effect.flatMap((shouldUseDarkColors) => syncWindowAppearance(window, shouldUseDarkColors)),
    );

  const loadWindowUrl = Effect.fn("desktop.window.loadWindowUrl")(function* (input: {
    readonly window: Electron.BrowserWindow;
    readonly appUrl: URL;
  }) {
    yield* syncMainWindowAppearance(input.window);
    yield* Effect.sync(() => {
      if (!input.window.isDestroyed()) {
        void input.window.loadURL(input.appUrl.href);
      }
    });
  });

  const createWindow = Effect.fn("desktop.window.createWindow")(function* (input: {
    readonly appUrl: URL;
    readonly title: string;
    readonly options: Electron.BrowserWindowConstructorOptions;
    readonly revealWhenReady: boolean;
    readonly openDevTools: boolean;
  }): Effect.fn.Return<CreatedDesktopWindow, DesktopWindowError> {
    const window = yield* electronWindow.create(input.options);
    markStartupMilestone("browser-window-created");
    const startupReviewWindowCreatedAtMs = isStartupReviewEnabled ? process.uptime() * 1_000 : null;
    const ready = windowReadyPromise(window);

    const trustedOrigin = input.appUrl.origin;
    registerRendererPermissions(window, trustedOrigin);
    preventUntrustedMainFrameNavigation(window, trustedOrigin, (url) => {
      void runPromise(
        elog.warn("blocked untrusted main-frame navigation", {
          url,
        }),
      );
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (Option.isSome(ElectronShell.parseSafeExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
      return { action: "deny" };
    });

    window.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle(input.title);
    });
    window.webContents.on("did-finish-load", () => {
      window.setTitle(input.title);
      sendWindowChromeState(window);
      void runPromise(syncMainWindowAppearance(window));
    });
    let remainingDevRendererRetries = DEV_RENDERER_RETRY_LIMIT;
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) {
          return;
        }
        void runPromise(
          elog.error("window failed to load", {
            errorCode,
            errorDescription,
            url: validatedURL,
          }),
        );
        // The Vite dev server may still be compiling the renderer when the
        // window first loads; retry until it becomes reachable.
        if (
          environment.isDevelopment &&
          errorCode !== LOAD_ABORTED_ERROR_CODE &&
          remainingDevRendererRetries > 0
        ) {
          remainingDevRendererRetries -= 1;
          setTimeout(() => {
            void runPromise(loadWindowUrl({ window, appUrl: input.appUrl }));
          }, DEV_RENDERER_RETRY_DELAY_MS);
        }
      },
    );
    window.webContents.on("render-process-gone", (_event, details) => {
      void runPromise(
        elog.error("window render process gone", {
          reason: details.reason,
          exitCode: details.exitCode,
        }),
      );
    });
    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      void runPromise(
        elog.error("window preload error", {
          preloadPath,
          error,
        }),
      );
    });
    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (level < 2 || !shouldLogRendererConsoleMessage(level, message, line, sourceId)) {
        return;
      }
      const log = level >= 3 ? elog.error : elog.warn;
      void runPromise(
        log("renderer console message", {
          level,
          message,
          line,
          sourceId,
        }),
      );
    });

    window.on("enter-full-screen", () => {
      sendWindowChromeState(window);
    });
    window.on("leave-full-screen", () => {
      sendWindowChromeState(window);
    });
    window.once("ready-to-show", () => {
      markStartupMilestone("renderer-ready-to-show");
      sendWindowChromeState(window);
      if (startupReviewWindowCreatedAtMs !== null) {
        const readyAtMs = process.uptime() * 1_000;
        console.log(
          `[frontend startup review] electron-ready ${JSON.stringify({
            processMs: Math.round(readyAtMs),
            windowMs: Math.round(readyAtMs - startupReviewWindowCreatedAtMs),
          })}`,
        );
      }
    });

    if (input.revealWhenReady) {
      void ready.then(() => runPromise(electronWindow.reveal(window)));
    }

    yield* loadWindowUrl({ window, appUrl: input.appUrl });
    if (input.openDevTools) {
      window.webContents.openDevTools({ mode: "detach" });
    }

    return { window, ready };
  });

  const createMainWindow = Effect.fn("desktop.window.createMainWindow")(function* (
    revealWhenReady: boolean,
  ): Effect.fn.Return<Electron.BrowserWindow, DesktopWindowError> {
    const iconPaths = yield* assets.iconPaths;
    const iconOption = getIconOption(iconPaths);
    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    const settings = yield* desktopSettings.get;
    const appUrl = yield* resolveMainWindowAppUrl(environment);
    if (!settings.hasCompletedOnboarding) {
      appUrl.pathname = SETUP_PATHNAME;
    }
    const created = yield* createWindow({
      appUrl,
      title: environment.displayName,
      revealWhenReady,
      openDevTools: environment.isDevelopment,
      options: {
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        center: true,
        // Shell handles narrow widths. Match Cursor glass-window mins.
        minWidth: 400,
        minHeight: 520,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: getInitialWindowBackgroundColor(shouldUseDarkColors),
        ...getInitialWindowGlassOptions(shouldUseDarkColors),
        ...iconOption,
        title: environment.displayName,
        ...getWindowTitleBarOptions(shouldUseDarkColors),
        webPreferences: {
          preload: environment.preloadPath,
          additionalArguments: [`--honk-window-id=${MAIN_WINDOW_ID}`],
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    });
    yield* electronWindow.setMain(created.window);
    created.window.on("closed", () => {
      void runPromise(electronWindow.clearMain(Option.some(created.window)));
    });
    yield* elog.info("main window created", {
      revealWhenReady,
      setup: !settings.hasCompletedOnboarding,
    });
    return created.window;
  });

  const createMain = createMainWindow(true).pipe(Effect.withSpan("desktop.window.createMain"));

  const ensureMain = Effect.gen(function* () {
    const existingWindow = yield* electronWindow.main;
    if (Option.isSome(existingWindow)) {
      return existingWindow.value;
    }
    return yield* createMain;
  }).pipe(Effect.withSpan("desktop.window.ensureMain"));

  const revealOrCreateMain = Effect.gen(function* () {
    const window = yield* ensureMain;
    yield* electronWindow.reveal(window);
    return window;
  }).pipe(Effect.withSpan("desktop.window.revealOrCreateMain"));

  const createMainIfBackendReady = Effect.gen(function* () {
    const backendReady = yield* Ref.get(state.backendReady);
    if (!backendReady) return;

    const existingWindow = yield* electronWindow.main;
    if (Option.isNone(existingWindow)) {
      yield* createMain;
    }
  }).pipe(Effect.withSpan("desktop.window.createMainIfBackendReady"));

  // Setup runs in the main window at /setup, so completing it only has to make
  // the flag durable before the renderer navigates itself to the workspace.
  // Relaunching after this point loads "/" instead of the setup route.
  const completeOnboarding = Effect.gen(function* () {
    yield* desktopSettings.completeOnboarding;
    yield* elog.info("onboarding completed");
  }).pipe(Effect.withSpan("desktop.window.completeOnboarding"));

  // One live native toast per thread. A newer toast for the same thread replaces it.
  const threadNotificationsByThreadId = new Map<string, Electron.Notification>();

  // Runs when the native notification is clicked. The raising renderer can't
  // handle that click once its window is hidden or gone, so the main process
  // reveals or recreates the main window and hands it the thread to open,
  // mirroring dispatchMenuAction.
  const activateThreadNotification = Effect.fn("desktop.window.activateThreadNotification")(
    function* (target: DesktopThreadNotificationTarget) {
      const existingWindow = yield* electronWindow.main;
      const targetWindow = Option.isSome(existingWindow) ? existingWindow.value : yield* createMain;
      const send = () => {
        if (targetWindow.isDestroyed()) return;
        targetWindow.webContents.send(IpcChannels.THREAD_NOTIFICATION_ACTIVATE_CHANNEL, target);
        void runPromise(electronWindow.reveal(targetWindow));
      };

      if (targetWindow.webContents.isLoadingMainFrame()) {
        targetWindow.webContents.once("did-finish-load", send);
        return;
      }
      send();
    },
  );

  const showThreadNotification = (input: DesktopThreadNotificationInput): Effect.Effect<void> =>
    Effect.sync(() => {
      if (!Electron.Notification.isSupported()) {
        return;
      }
      threadNotificationsByThreadId.get(input.threadId)?.close();
      const notification = new Electron.Notification({ title: input.title, body: input.body });
      notification.on("click", () => {
        void runPromise(activateThreadNotification(input.target));
      });
      notification.on("close", () => {
        if (threadNotificationsByThreadId.get(input.threadId) === notification) {
          threadNotificationsByThreadId.delete(input.threadId);
        }
      });
      threadNotificationsByThreadId.set(input.threadId, notification);
      notification.show();
    });

  return DesktopWindow.of({
    createMain,
    ensureMain,
    revealOrCreateMain,
    activate: Effect.gen(function* () {
      const mainWindow = yield* electronWindow.main;
      if (Option.isSome(mainWindow)) {
        yield* electronWindow.reveal(mainWindow.value);
        return;
      }
      yield* createMainIfBackendReady;
    }).pipe(Effect.withSpan("desktop.window.activate")),
    createMainIfBackendReady,
    handleBackendReady: Effect.gen(function* () {
      yield* Ref.set(state.backendReady, true);
      markStartupMilestone("backend-ready");
      yield* elog.info("backend ready");
      yield* createMainIfBackendReady;
    }).pipe(Effect.withSpan("desktop.window.handleBackendReady")),
    completeOnboarding,
    reload: Effect.gen(function* () {
      const existingWindow = yield* electronWindow.main;
      if (Option.isNone(existingWindow) || !canSendToWindow(existingWindow.value)) {
        return;
      }

      const appUrl = yield* resolveMainWindowAppUrl(environment);
      const currentUrl = existingWindow.value.webContents.getURL();
      yield* loadWindowUrl({
        window: existingWindow.value,
        appUrl: isTrustedRendererUrl(currentUrl, appUrl.origin) ? new URL(currentUrl) : appUrl,
      });
    }).pipe(Effect.withSpan("desktop.window.reload")),
    dispatchMenuAction: Effect.fn("desktop.window.dispatchMenuAction")(function* (action) {
      yield* Effect.annotateCurrentSpan({ action });
      const existingWindow = yield* electronWindow.main;
      const targetWindow = Option.isSome(existingWindow) ? existingWindow.value : yield* createMain;
      const send = () => {
        if (targetWindow.isDestroyed()) return;
        targetWindow.webContents.send(IpcChannels.MENU_ACTION_CHANNEL, action);
        void runPromise(electronWindow.reveal(targetWindow));
      };

      if (targetWindow.webContents.isLoadingMainFrame()) {
        targetWindow.webContents.once("did-finish-load", send);
        return;
      }
      send();
    }),
    showThreadNotification,
    syncAppearance: Effect.gen(function* () {
      const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
      yield* electronWindow.syncAllAppearance((window) =>
        syncWindowAppearance(window, shouldUseDarkColors),
      );
    }).pipe(Effect.withSpan("desktop.window.syncAppearance")),
  });
});

export const layer = Layer.effect(DesktopWindow, make);
