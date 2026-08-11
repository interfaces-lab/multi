import {
  makeLocalFileTracer,
  makeTraceSink,
  type EffectTraceRecord,
} from "@honk/shared/observability";
import {
  configureHonkEvlog,
  configureHonkProcessMetadata,
  makeHonkEffectLogger,
  makeSafeConsolePrettyLogger,
} from "@honk/shared/logging";
import * as EffectLogger from "@honk/shared/effect-logger";
import { parsePersistedServerObservabilitySettings } from "@honk/shared/server-settings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Tracer from "effect/Tracer";
import {
  OtlpExporter,
  OtlpLogger,
  OtlpSerialization,
  OtlpTracer,
} from "effect/unstable/observability";

import * as DesktopEnvironment from "./desktop-environment";

const DESKTOP_LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const DESKTOP_LOG_FILE_MAX_FILES = 10;
const DESKTOP_TRACE_BATCH_WINDOW_MS = 200;
const LOW_VALUE_SUCCESS_TRACE_PREFIXES = ["desktop.ipc."];

export interface DesktopBackendOutputLogShape {
  readonly writeSessionBoundary: (input: {
    readonly phase: "START" | "END";
    readonly details: string;
  }) => Effect.Effect<void>;
  readonly writeOutputChunk: (
    streamName: "stdout" | "stderr",
    chunk: Uint8Array,
  ) => Effect.Effect<void>;
}

export class DesktopBackendOutputLog extends Context.Service<
  DesktopBackendOutputLog,
  DesktopBackendOutputLogShape
>()("honk/desktop/BackendOutputLog") {}

const textDecoder = new TextDecoder();

export const desktopProcessMetadata = configureHonkProcessMetadata("desktop-main");

export * as EffectLogger from "@honk/shared/effect-logger";

const sanitizeLogValue = (value: string): string => value.replace(/\s+/g, " ").trim();

export function shouldRecordDesktopLocalTrace(record: EffectTraceRecord): boolean {
  return (
    record.exit._tag !== "Success" ||
    !LOW_VALUE_SUCCESS_TRACE_PREFIXES.some((prefix) => record.name.startsWith(prefix))
  );
}

const backendChildLog = EffectLogger.create({ service: "desktop-backend-child" });

const readPersistedOtlpTracesUrl: Effect.Effect<
  Option.Option<string>,
  never,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const raw = yield* fileSystem.readFileString(environment.serverSettingsPath).pipe(Effect.option);
  if (Option.isNone(raw)) {
    return Option.none();
  }

  const parsed = parsePersistedServerObservabilitySettings(raw.value);
  return Option.fromNullishOr(parsed.otlpTracesUrl);
});

const resolveOtlpTracesUrl = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (Option.isSome(environment.otlpTracesUrl)) {
    return environment.otlpTracesUrl;
  }
  return yield* readPersistedOtlpTracesUrl;
});

const writeConsoleOutput = (
  streamName: "stdout" | "stderr",
  chunk: Uint8Array,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const output = streamName === "stderr" ? process.stderr : process.stdout;
    output.write(chunk);
  }).pipe(Effect.ignore);

export const backendOutputLogLayer = Layer.effect(
  DesktopBackendOutputLog,
  Effect.sync(
    () =>
      ({
        writeSessionBoundary: Effect.fn("desktop.observability.backendOutput.writeSessionBoundary")(
          function* ({ phase, details }) {
            yield* backendChildLog
              .info(`backend child process session ${phase.toLowerCase()}`, {
                phase,
                details: sanitizeLogValue(details),
              })
              .pipe(Effect.withTracerEnabled(false));
          },
        ),
        writeOutputChunk: Effect.fnUntraced(function* (streamName, chunk) {
          yield* writeConsoleOutput(streamName, chunk);
          if (streamName === "stdout") {
            return;
          }
          yield* backendChildLog
            .error("backend child process output", {
              stream: streamName,
              text: textDecoder.decode(chunk),
            })
            .pipe(Effect.withTracerEnabled(false));
        }),
      }) satisfies DesktopBackendOutputLogShape,
  ),
);

// OTEL header convention (`key=value,key2=value2`), matching OTEL_EXPORTER_OTLP_HEADERS.
const parseOtlpHeaders = (raw: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const separator = entry.indexOf("=");
    if (separator < 1) {
      continue;
    }
    headers[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return headers;
};

const desktopLoggerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    configureHonkEvlog({
      filePath: environment.path.join(environment.logDir, "desktop.log.ndjson"),
      service: "desktop",
      environment: environment.isDevelopment ? "development" : "production",
      minLevel: "info",
      maxFiles: DESKTOP_LOG_FILE_MAX_FILES,
      maxSizePerFile: DESKTOP_LOG_FILE_MAX_BYTES,
    });

    const loggers: Logger.Logger<unknown, unknown>[] = [
      makeSafeConsolePrettyLogger(),
      Logger.tracerLogger,
      makeHonkEffectLogger({
        defaultService: "desktop",
      }),
    ];

    // Optional OTLP log export (HONK_OTLP_LOGS_URL) beside local file/console loggers.
    // Same resource identity as the OTLP tracer delegate below.
    if (Option.isSome(environment.otlpLogsUrl)) {
      loggers.push(
        yield* OtlpLogger.make({
          url: environment.otlpLogsUrl.value,
          headers: Option.match(environment.otlpLogsHeaders, {
            onNone: () => undefined,
            onSome: parseOtlpHeaders,
          }),
          exportInterval: `${environment.otlpExportIntervalMs} millis`,
          resource: {
            serviceName: "honk-desktop",
            attributes: {
              "service.runtime": "desktop",
              "service.mode": environment.isDevelopment ? "development" : "packaged",
              "honk.run_id": desktopProcessMetadata.runId,
              "honk.process_role": desktopProcessMetadata.processRole,
            },
          },
        }),
      );
    }

    return Layer.mergeAll(
      Logger.layer(loggers, { mergeWithExisting: false }),
      Layer.succeed(References.MinimumLogLevel, "Info"),
    );
  }),
).pipe(
  Layer.provideMerge(OtlpSerialization.layerJson),
  Layer.provideMerge(OtlpExporter.layerFlusher),
);

const tracerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const otlpTracesUrl = yield* resolveOtlpTracesUrl;
    const tracePath = environment.path.join(environment.logDir, "desktop.trace.ndjson");
    const sink = yield* makeTraceSink({
      filePath: tracePath,
      maxBytes: DESKTOP_LOG_FILE_MAX_BYTES,
      maxFiles: DESKTOP_LOG_FILE_MAX_FILES,
      batchWindowMs: DESKTOP_TRACE_BATCH_WINDOW_MS,
    });
    const delegate = Option.isNone(otlpTracesUrl)
      ? undefined
      : yield* OtlpTracer.make({
          url: otlpTracesUrl.value,
          exportInterval: `${environment.otlpExportIntervalMs} millis`,
          resource: {
            serviceName: "desktop",
            attributes: {
              "service.runtime": "desktop",
              "service.mode": environment.isDevelopment ? "development" : "packaged",
              "honk.run_id": desktopProcessMetadata.runId,
              "honk.process_role": desktopProcessMetadata.processRole,
            },
          },
        });
    const tracer = yield* makeLocalFileTracer({
      filePath: tracePath,
      maxBytes: DESKTOP_LOG_FILE_MAX_BYTES,
      maxFiles: DESKTOP_LOG_FILE_MAX_FILES,
      batchWindowMs: DESKTOP_TRACE_BATCH_WINDOW_MS,
      sink,
      recordFilter: shouldRecordDesktopLocalTrace,
      ...(delegate ? { delegate } : {}),
    });

    return Layer.succeed(Tracer.Tracer, tracer);
  }),
).pipe(
  Layer.provideMerge(OtlpSerialization.layerJson),
  Layer.provideMerge(OtlpExporter.layerFlusher),
);

export const layer = Layer.mergeAll(
  backendOutputLogLayer,
  desktopLoggerLayer,
  tracerLayer,
  Layer.succeed(Tracer.MinimumTraceLevel, "Info"),
  Layer.succeed(References.TracerTimingEnabled, true),
);
