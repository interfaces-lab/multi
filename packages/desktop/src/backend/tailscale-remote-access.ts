import {
  disableTailscaleHttpsServe,
  enableTailscaleHttpsServe,
  resolveTailscaleHttpsEndpoint,
  TailscaleServeNotEnabledError,
  TailscaleUnavailableError,
  type TailscaleHttpsEndpoint,
} from "@honk/core/tailscale";
import { Context, Effect, Layer, Ref, Semaphore } from "effect";

import * as HonkCoreHost from "./honk-core-host";
import * as DesktopAppSettings from "../settings/desktop-app-settings";

const HTTPS_PORT = 443;

export type TailscaleRemoteAccessSnapshot =
  | { readonly status: "disabled" }
  | { readonly status: "enabling" }
  | { readonly status: "connected"; readonly url: string }
  | {
      readonly status: "error";
      readonly reason: "unavailable" | "serve_not_enabled" | "failed";
      readonly message: string;
      readonly enableUrl: string | null;
    };

export interface TailscaleRemoteAccessShape {
  readonly snapshot: Effect.Effect<TailscaleRemoteAccessSnapshot>;
  readonly restore: (enabled: boolean) => Effect.Effect<void>;
  readonly enable: Effect.Effect<TailscaleRemoteAccessSnapshot>;
  readonly refresh: Effect.Effect<TailscaleRemoteAccessSnapshot>;
  readonly disable: Effect.Effect<TailscaleRemoteAccessSnapshot>;
}

export class TailscaleRemoteAccess extends Context.Service<
  TailscaleRemoteAccess,
  TailscaleRemoteAccessShape
>()("honk/desktop/TailscaleRemoteAccess") {}

export interface TailscaleRemoteAccessDependencies {
  readonly resolveEndpoint: () => Promise<TailscaleHttpsEndpoint>;
  readonly enableServe: (targetOrigin: string) => Promise<void>;
  readonly disableServe: () => Promise<void>;
  readonly probe: (url: string) => Promise<void>;
}

const dependenciesLive: TailscaleRemoteAccessDependencies = {
  resolveEndpoint: () => resolveTailscaleHttpsEndpoint(HTTPS_PORT),
  enableServe: (targetOrigin) => enableTailscaleHttpsServe(targetOrigin, HTTPS_PORT),
  disableServe: () => disableTailscaleHttpsServe(HTTPS_PORT),
  probe: async (url) => {
    const response = await fetch(new URL("/healthz", url), {
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status !== 204) throw new Error("Tailscale endpoint health check failed.");
  },
};

type Attempt<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly cause: unknown };

const attempt = <A>(run: () => Promise<A>) =>
  Effect.promise(() =>
    run().then(
      (value): Attempt<A> => ({ ok: true, value }),
      (cause: unknown): Attempt<A> => ({ ok: false, cause }),
    ),
  );

const failureSnapshot = (cause: unknown): TailscaleRemoteAccessSnapshot => {
  if (cause instanceof TailscaleServeNotEnabledError) {
    return {
      status: "error",
      reason: "serve_not_enabled",
      message: cause.message,
      enableUrl: cause.enableUrl,
    };
  }
  if (cause instanceof TailscaleUnavailableError) {
    return {
      status: "error",
      reason: "unavailable",
      message: cause.message,
      enableUrl: null,
    };
  }
  return {
    status: "error",
    reason: "failed",
    message: "Failed to publish Honk through Tailscale.",
    enableUrl: null,
  };
};

export const make = (dependencies: TailscaleRemoteAccessDependencies = dependenciesLive) =>
  Layer.effect(
    TailscaleRemoteAccess,
    Effect.gen(function* () {
      const host = yield* HonkCoreHost.HonkCoreHost;
      const settings = yield* DesktopAppSettings.DesktopAppSettings;
      const state = yield* Ref.make<TailscaleRemoteAccessSnapshot>({ status: "disabled" });
      const lock = yield* Semaphore.make(1);

      const publish = (persistIntent: boolean) =>
        Effect.gen(function* () {
          yield* Ref.set(state, { status: "enabling" });
          const published = yield* attempt(async () => {
            const endpoint = await dependencies.resolveEndpoint();
            await dependencies.enableServe(host.connection.url);
            try {
              await dependencies.probe(endpoint.url);
            } catch (cause: unknown) {
              await dependencies.disableServe().catch(() => undefined);
              throw cause;
            }
            return endpoint;
          });
          if (!published.ok) {
            const snapshot = failureSnapshot(published.cause);
            yield* Ref.set(state, snapshot);
            return snapshot;
          }
          if (persistIntent) {
            const persisted = yield* Effect.result(settings.setTailscaleRemoteAccessEnabled(true));
            if (persisted._tag === "Failure") {
              yield* attempt(dependencies.disableServe);
              const snapshot = failureSnapshot(persisted.failure);
              yield* Ref.set(state, snapshot);
              return snapshot;
            }
          }
          const snapshot: TailscaleRemoteAccessSnapshot = {
            status: "connected",
            url: published.value.url,
          };
          yield* Ref.set(state, snapshot);
          return snapshot;
        });

      const enable = (persistIntent: boolean) => lock.withPermits(1)(publish(persistIntent));

      const refresh = lock.withPermits(1)(
        Effect.gen(function* () {
          const snapshot = yield* Ref.get(state);
          return snapshot.status === "connected" ? yield* publish(false) : snapshot;
        }),
      );

      const disable = (persistIntent: boolean) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const disabled = yield* attempt(dependencies.disableServe);
            if (!disabled.ok) {
              const snapshot = failureSnapshot(disabled.cause);
              yield* Ref.set(state, snapshot);
              return snapshot;
            }
            if (persistIntent) {
              const persisted = yield* Effect.result(
                settings.setTailscaleRemoteAccessEnabled(false),
              );
              if (persisted._tag === "Failure") {
                const snapshot = failureSnapshot(persisted.failure);
                yield* Ref.set(state, snapshot);
                return snapshot;
              }
            }
            const snapshot: TailscaleRemoteAccessSnapshot = { status: "disabled" };
            yield* Ref.set(state, snapshot);
            return snapshot;
          }),
        );

      yield* Effect.addFinalizer(() =>
        Ref.get(state).pipe(
          Effect.flatMap((snapshot) =>
            snapshot.status === "connected" ? disable(false).pipe(Effect.asVoid) : Effect.void,
          ),
        ),
      );

      return TailscaleRemoteAccess.of({
        snapshot: Ref.get(state),
        restore: (enabled) => (enabled ? enable(false).pipe(Effect.asVoid) : Effect.void),
        enable: enable(true),
        refresh,
        disable: disable(true),
      });
    }),
  );

export const layer = make();
