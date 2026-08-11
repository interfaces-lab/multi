import type { DesktopAppBranding, DesktopRuntimeInfo } from "@honk/shared/desktop-api";
import { FileSystem, Path } from "effect";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  type DesktopSettings,
  resolveDefaultDesktopSettings,
} from "../settings/desktop-app-settings";
import { resolveDesktopAppBranding } from "../app-branding";
import { resolveDesktopRuntimeInfo } from "../runtime-arch";
import * as DesktopConfig from "./desktop-config";

export interface MakeDesktopEnvironmentInput {
  readonly dirname: string;
  readonly homeDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly processArch: string;
  readonly appVersion: string;
  readonly appPath: string;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly runningUnderArm64Translation: boolean;
}

export interface DesktopEnvironmentShape {
  readonly path: Path.Path;
  readonly dirname: string;
  readonly platform: NodeJS.Platform;
  readonly processArch: string;
  readonly isPackaged: boolean;
  readonly isDevelopment: boolean;
  readonly appVersion: string;
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly homeDirectory: string;
  readonly appDataDirectory: string;
  readonly baseDir: string;
  readonly stateDir: string;
  readonly desktopSettingsPath: string;
  readonly clientSettingsPath: string;
  readonly serverSettingsPath: string;
  readonly logDir: string;
  readonly rootDir: string;
  readonly appRoot: string;
  readonly preloadPath: string;
  readonly appUpdateYmlPath: string;
  readonly devServerUrl: Option.Option<URL>;
  readonly commitHashOverride: Option.Option<string>;
  readonly otlpTracesUrl: Option.Option<string>;
  readonly otlpLogsUrl: Option.Option<string>;
  readonly otlpLogsHeaders: Option.Option<string>;
  readonly otlpExportIntervalMs: number;
  readonly branding: DesktopAppBranding;
  readonly displayName: string;
  readonly appUserModelId: string;
  readonly linuxDesktopEntryName: string;
  readonly linuxWmClass: string;
  readonly userDataDirName: string;
  readonly defaultDesktopSettings: DesktopSettings;
  readonly runtimeInfo: DesktopRuntimeInfo;
  readonly resolvePickFolderDefaultPath: (rawOptions: unknown) => Option.Option<string>;
  readonly resolveResourcePathCandidates: (fileName: string) => readonly string[];
  readonly productionDockIconPath: string;
  readonly developmentDockIconPath: string;
}

export class DesktopEnvironment extends Context.Service<
  DesktopEnvironment,
  DesktopEnvironmentShape
>()("honk/desktop/Environment") {}

export const resolveDesktopStaticDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment;
  const candidates = [
    environment.path.join(environment.appRoot, "out/renderer"),
    environment.path.join(environment.appRoot, "packages/desktop/out/renderer"),
  ];
  const existing = yield* Effect.all(
    candidates.map((candidate) =>
      fileSystem
        .exists(environment.path.join(candidate, "index.html"))
        .pipe(Effect.orElseSucceed(() => false)),
    ),
  );
  return Option.fromNullishOr(candidates.find((_, index) => existing[index]));
}).pipe(Effect.withSpan("desktop.environment.resolveStaticDir"));

const makeDesktopEnvironment = Effect.fn("desktop.environment.make")(function* (
  input: MakeDesktopEnvironmentInput,
): Effect.fn.Return<DesktopEnvironmentShape, Config.ConfigError, Path.Path> {
  const path = yield* Path.Path;
  const config = yield* DesktopConfig.DesktopConfig;
  const homeDirectory = input.homeDirectory;
  const devServerUrl = input.isPackaged ? Option.none<URL>() : config.devServerUrl;
  const isDevelopment = Option.isSome(devServerUrl);
  const appDataDirectory =
    input.platform === "win32"
      ? Option.getOrElse(config.appDataDirectory, () =>
          path.join(homeDirectory, "AppData", "Roaming"),
        )
      : input.platform === "darwin"
        ? path.join(homeDirectory, "Library", "Application Support")
        : Option.getOrElse(config.xdgConfigHome, () => path.join(homeDirectory, ".config"));
  const baseDir = Option.getOrElse(config.honkHome, () => path.join(homeDirectory, ".honk"));
  const branding = resolveDesktopAppBranding({
    isDevelopment,
  });
  const displayName = branding.displayName;
  const stateDir = path.join(baseDir, isDevelopment ? "dev" : "userdata");
  const userDataDirName = isDevelopment ? "honk-dev" : "honk";
  const resourcesPath = input.resourcesPath;
  const desktopPackageDir = input.isPackaged ? input.appPath : path.resolve(input.dirname, "../..");
  const rootDir = input.isPackaged ? input.appPath : path.resolve(desktopPackageDir, "../..");
  const appRoot = input.isPackaged ? input.appPath : rootDir;
  return DesktopEnvironment.of({
    path,
    dirname: input.dirname,
    platform: input.platform,
    processArch: input.processArch,
    isPackaged: input.isPackaged,
    isDevelopment,
    appVersion: input.appVersion,
    appPath: input.appPath,
    resourcesPath,
    homeDirectory,
    appDataDirectory,
    baseDir,
    stateDir,
    desktopSettingsPath: path.join(stateDir, "desktop-settings.json"),
    clientSettingsPath: path.join(stateDir, "client-settings.json"),
    serverSettingsPath: path.join(stateDir, "settings.json"),
    logDir: path.join(stateDir, "logs"),
    rootDir,
    appRoot,
    preloadPath: path.join(input.dirname, "../preload/index.js"),
    appUpdateYmlPath: input.isPackaged
      ? path.join(resourcesPath, "app-update.yml")
      : path.join(input.appPath, "dev-app-update.yml"),
    devServerUrl,
    commitHashOverride: config.commitHashOverride,
    otlpTracesUrl: config.otlpTracesUrl,
    otlpLogsUrl: config.otlpLogsUrl,
    otlpLogsHeaders: config.otlpLogsHeaders,
    otlpExportIntervalMs: config.otlpExportIntervalMs,
    branding,
    displayName,
    appUserModelId: isDevelopment ? "com.interfacesco.honk.dev" : "com.interfacesco.honk",
    linuxDesktopEntryName: isDevelopment ? "honk-dev.desktop" : "honk.desktop",
    linuxWmClass: isDevelopment ? "honk-dev" : "honk",
    userDataDirName,
    defaultDesktopSettings: resolveDefaultDesktopSettings(input.appVersion),
    runtimeInfo: resolveDesktopRuntimeInfo({
      platform: input.platform,
      processArch: input.processArch,
      runningUnderArm64Translation: input.runningUnderArm64Translation,
    }),
    resolvePickFolderDefaultPath: (rawOptions) => {
      if (typeof rawOptions !== "object" || rawOptions === null) {
        return Option.none();
      }

      const { initialPath } = rawOptions as { initialPath?: unknown };
      if (typeof initialPath !== "string") {
        return Option.none();
      }

      const trimmedPath = initialPath.trim();
      if (trimmedPath.length === 0) {
        return Option.none();
      }

      if (trimmedPath === "~") {
        return Option.some(homeDirectory);
      }

      if (trimmedPath.startsWith("~/") || trimmedPath.startsWith("~\\")) {
        return Option.some(path.join(homeDirectory, trimmedPath.slice(2)));
      }

      return Option.some(path.resolve(trimmedPath));
    },
    resolveResourcePathCandidates: (fileName) => [
      path.join(desktopPackageDir, "resources", fileName),
      path.join(resourcesPath, "resources", fileName),
      path.join(resourcesPath, fileName),
    ],
    productionDockIconPath: path.join(desktopPackageDir, "resources/dock-icon.png"),
    developmentDockIconPath: path.join(desktopPackageDir, "resources/dev-dock-icon.png"),
  });
});

export const layer = (input: MakeDesktopEnvironmentInput) =>
  Layer.effect(DesktopEnvironment, makeDesktopEnvironment(input));
