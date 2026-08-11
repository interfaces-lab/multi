import { DesktopThemeSchema, type DesktopTheme } from "@honk/shared/desktop-api";
import { fromLenientJson } from "@honk/shared/schema-json";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Path } from "effect";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as DesktopEnvironment from "../app/desktop-environment";

export interface DesktopSettings {
  readonly themeSource: DesktopTheme;
  readonly hasCompletedOnboarding: boolean;
  readonly tailscaleRemoteAccessEnabled: boolean;
  readonly lastBackendPort?: number;
}

export interface DesktopSettingsChange {
  readonly settings: DesktopSettings;
  readonly changed: boolean;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  themeSource: "system",
  hasCompletedOnboarding: false,
  tailscaleRemoteAccessEnabled: false,
};

// Decoded permissively because the file on disk may have been written by another
// build. Unknown fields must not fail the whole document and reset every
// unrelated setting.
const DesktopSettingsDocument = Schema.Struct({
  themeSource: Schema.optionalKey(DesktopThemeSchema),
  hasCompletedOnboarding: Schema.optionalKey(Schema.Boolean),
  tailscaleRemoteAccessEnabled: Schema.optionalKey(Schema.Boolean),
  lastBackendPort: Schema.optionalKey(Schema.Number),
});

type DesktopSettingsDocument = typeof DesktopSettingsDocument.Type;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DesktopSettingsJson = fromLenientJson(DesktopSettingsDocument);
const decodeDesktopSettingsJson = Schema.decodeEffect(DesktopSettingsJson);
const encodeDesktopSettingsJson = Schema.encodeEffect(DesktopSettingsJson);

const settingsChange = (settings: DesktopSettings, changed: boolean): DesktopSettingsChange => ({
  settings,
  changed,
});

export class DesktopSettingsWriteError extends Data.TaggedError("DesktopSettingsWriteError")<{
  readonly cause: PlatformError.PlatformError | Schema.SchemaError;
}> {
  override get message() {
    return "Honk could not save desktop settings.";
  }
}

export interface DesktopAppSettingsShape {
  readonly load: Effect.Effect<DesktopSettings>;
  readonly get: Effect.Effect<DesktopSettings>;
  readonly setThemeSource: (
    theme: DesktopTheme,
  ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
  readonly setLastBackendPort: (
    port: number,
  ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
  readonly setTailscaleRemoteAccessEnabled: (
    enabled: boolean,
  ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
  readonly completeOnboarding: Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
}

export class DesktopAppSettings extends Context.Service<
  DesktopAppSettings,
  DesktopAppSettingsShape
>()("honk/desktop/AppSettings") {}

export function resolveDefaultDesktopSettings(_appVersion: string): DesktopSettings {
  return DEFAULT_DESKTOP_SETTINGS;
}

export function normalizeDesktopSettingsDocument(
  parsed: DesktopSettingsDocument,
  _appVersion: string,
): DesktopSettings {
  const lastBackendPort = parsed.lastBackendPort;
  return {
    themeSource: parsed.themeSource ?? "system",
    hasCompletedOnboarding: parsed.hasCompletedOnboarding === true,
    tailscaleRemoteAccessEnabled: parsed.tailscaleRemoteAccessEnabled === true,
    ...(typeof lastBackendPort === "number" &&
    Number.isInteger(lastBackendPort) &&
    lastBackendPort >= 1 &&
    lastBackendPort <= 65_535
      ? { lastBackendPort }
      : {}),
  };
}

function toDesktopSettingsDocument(
  settings: DesktopSettings,
  defaults: DesktopSettings,
): DesktopSettingsDocument {
  const document: Mutable<DesktopSettingsDocument> = {};

  if (settings.themeSource !== defaults.themeSource) {
    document.themeSource = settings.themeSource;
  }
  if (settings.hasCompletedOnboarding !== defaults.hasCompletedOnboarding) {
    document.hasCompletedOnboarding = settings.hasCompletedOnboarding;
  }
  if (settings.tailscaleRemoteAccessEnabled !== defaults.tailscaleRemoteAccessEnabled) {
    document.tailscaleRemoteAccessEnabled = settings.tailscaleRemoteAccessEnabled;
  }
  if (
    settings.lastBackendPort !== undefined &&
    settings.lastBackendPort !== defaults.lastBackendPort
  ) {
    document.lastBackendPort = settings.lastBackendPort;
  }
  return document;
}

function setThemeSource(settings: DesktopSettings, requestedTheme: DesktopTheme): DesktopSettings {
  return settings.themeSource === requestedTheme
    ? settings
    : {
        ...settings,
        themeSource: requestedTheme,
      };
}

function setLastBackendPort(settings: DesktopSettings, requestedPort: number): DesktopSettings {
  return settings.lastBackendPort === requestedPort
    ? settings
    : {
        ...settings,
        lastBackendPort: requestedPort,
      };
}

function setTailscaleRemoteAccessEnabled(
  settings: DesktopSettings,
  enabled: boolean,
): DesktopSettings {
  return settings.tailscaleRemoteAccessEnabled === enabled
    ? settings
    : { ...settings, tailscaleRemoteAccessEnabled: enabled };
}

function completeOnboarding(settings: DesktopSettings): DesktopSettings {
  return settings.hasCompletedOnboarding
    ? settings
    : {
        ...settings,
        hasCompletedOnboarding: true,
      };
}

function readSettings(
  fileSystem: FileSystem.FileSystem,
  settingsPath: string,
  appVersion: string,
): Effect.Effect<DesktopSettings> {
  const defaultSettings = resolveDefaultDesktopSettings(appVersion);

  return fileSystem.readFileString(settingsPath).pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(defaultSettings),
        onSome: (raw) =>
          decodeDesktopSettingsJson(raw).pipe(
            Effect.map((parsed) => normalizeDesktopSettingsDocument(parsed, appVersion)),
            Effect.catch(() => Effect.succeed(defaultSettings)),
          ),
      }),
    ),
  );
}

const writeSettings = Effect.fn("desktop.settings.writeSettings")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly settingsPath: string;
  readonly settings: DesktopSettings;
  readonly defaultSettings: DesktopSettings;
}): Effect.fn.Return<void, PlatformError.PlatformError | Schema.SchemaError> {
  const directory = input.path.dirname(input.settingsPath);
  const suffix = crypto.randomUUID().replace(/-/g, "");
  const tempPath = `${input.settingsPath}.${process.pid}.${suffix}.tmp`;
  const encoded = yield* encodeDesktopSettingsJson(
    toDesktopSettingsDocument(input.settings, input.defaultSettings),
  );
  yield* input.fileSystem.makeDirectory(directory, { recursive: true });
  yield* input.fileSystem.writeFileString(tempPath, `${encoded}\n`);
  yield* input.fileSystem.rename(tempPath, input.settingsPath);
});

export const layer = Layer.effect(
  DesktopAppSettings,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const settingsRef = yield* SynchronizedRef.make(environment.defaultDesktopSettings);

    const persist = (
      update: (settings: DesktopSettings) => DesktopSettings,
    ): Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError> =>
      SynchronizedRef.modifyEffect(settingsRef, (settings) => {
        const nextSettings = update(settings);
        if (nextSettings === settings) {
          return Effect.succeed([settingsChange(settings, false), settings] as const);
        }

        return writeSettings({
          fileSystem,
          path,
          settingsPath: environment.desktopSettingsPath,
          settings: nextSettings,
          defaultSettings: environment.defaultDesktopSettings,
        }).pipe(
          Effect.mapError((cause) => new DesktopSettingsWriteError({ cause })),
          Effect.as([settingsChange(nextSettings, true), nextSettings] as const),
        );
      });

    return DesktopAppSettings.of({
      get: SynchronizedRef.get(settingsRef),
      load: Effect.gen(function* () {
        const settings = yield* readSettings(
          fileSystem,
          environment.desktopSettingsPath,
          environment.appVersion,
        );
        return yield* SynchronizedRef.setAndGet(settingsRef, settings);
      }).pipe(Effect.withSpan("desktop.settings.load")),
      setThemeSource: (theme) =>
        persist((settings) => setThemeSource(settings, theme)).pipe(
          Effect.withSpan("desktop.settings.setThemeSource", { attributes: { theme } }),
        ),
      setLastBackendPort: (port) =>
        persist((settings) => setLastBackendPort(settings, port)).pipe(
          Effect.withSpan("desktop.settings.setLastBackendPort", { attributes: { port } }),
        ),
      setTailscaleRemoteAccessEnabled: (enabled) =>
        persist((settings) => setTailscaleRemoteAccessEnabled(settings, enabled)).pipe(
          Effect.withSpan("desktop.settings.setTailscaleRemoteAccessEnabled", {
            attributes: { enabled },
          }),
        ),
      completeOnboarding: persist(completeOnboarding).pipe(
        Effect.withSpan("desktop.settings.completeOnboarding"),
      ),
    });
  }),
);

export const layerTest = (initialSettings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS) =>
  Layer.effect(
    DesktopAppSettings,
    Effect.gen(function* () {
      const settingsRef = yield* SynchronizedRef.make(initialSettings);
      const update = (f: (settings: DesktopSettings) => DesktopSettings) =>
        SynchronizedRef.modify(settingsRef, (settings) => {
          const nextSettings = f(settings);
          return [
            {
              settings: nextSettings,
              changed: nextSettings !== settings,
            },
            nextSettings,
          ] as const;
        });

      return DesktopAppSettings.of({
        get: SynchronizedRef.get(settingsRef),
        load: SynchronizedRef.get(settingsRef),
        setThemeSource: (theme) => update((settings) => setThemeSource(settings, theme)),
        setLastBackendPort: (port) => update((settings) => setLastBackendPort(settings, port)),
        setTailscaleRemoteAccessEnabled: (enabled) =>
          update((settings) => setTailscaleRemoteAccessEnabled(settings, enabled)),
        completeOnboarding: update(completeOnboarding),
      });
    }),
  );
