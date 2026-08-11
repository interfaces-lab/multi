import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  HttpBody,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { HONK_CORE_PROTOCOL, Rpcs, type HonkConnection } from "./client";
import { HONK_ACCESS_PROTOCOL_VERSION, makePairingUrl, type PairingInvitation } from "./access";
import { HonkCore } from "./honk-core";
import {
  type AccessDeviceRecord,
  type HostAccess,
  openHostAccess,
  type PairingState,
} from "./host-access";

export interface HonkNodeHostShape {
  readonly connection: HonkConnection;
  readonly environmentId: string;
  readonly issuePairing: (publicOrigin: string, computerLabel?: string) => PairingInvitation;
  readonly pairingState: (id: string) => PairingState;
  readonly cancelPairing: (id: string) => Promise<boolean>;
  readonly devices: () => readonly AccessDeviceRecord[];
  readonly revokeDevice: (id: string) => Promise<boolean>;
}

export class HonkNodeHost extends Context.Service<HonkNodeHost, HonkNodeHostShape>()(
  "honk/core/HonkNodeHost",
) {}

// Re-exported, not re-merged: @honk/core owns the command catalog, so a
// desktop, web, or test host cannot assemble a different one. The renderer
// builds its client from this same value.
export { Rpcs };

const PairingPreviewBody = Schema.Struct({ token: Schema.String });
const PairingExchangeBody = Schema.Struct({
  token: Schema.String,
  requestId: Schema.String,
  label: Schema.String,
  replaceDeviceId: Schema.optionalKey(Schema.String),
});

class HostAccessRequestError extends Data.TaggedError("HostAccessRequestError")<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Honk could not update device access state.";
  }
}

const accessRequest = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new HostAccessRequestError({ cause }),
  });

const jsonError = (status: number, code: string) =>
  HttpServerResponse.jsonUnsafe({ error: code }, { status });

const bearerTokenFrom = (authorization: string | undefined): string | null => {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return token.length === 0 ? null : token;
};

// Serves the Honk Core RPC group over HTTP on a loopback port so the
// renderer's chat view exercises the real Effect RPC remote-client path from
// spec/core.md. Ndjson serialization on purpose: its framing is what lets the
// session events stream flow over a chunked HTTP response.
// This authenticated listener is also the endpoint Tailscale Serve publishes,
// so desktop, CLI, and mobile exercise one transport and one command catalog.
const bearerMatches = (authorization: string | undefined, expectedToken: string): boolean => {
  const token = bearerTokenFrom(authorization);
  if (token === null) return false;
  const received = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
};

const interruptWhenRevoked = (access: HostAccess, deviceId: string) =>
  Effect.callback<never>((resume) => {
    const unsubscribe = access.onRevoke(deviceId, () => resume(Effect.interrupt));
    return Effect.sync(unsubscribe);
  });

const interruptStreamingBodyWhenRevoked = (
  response: HttpServerResponse.HttpServerResponse,
  access: HostAccess,
  deviceId: string,
): HttpServerResponse.HttpServerResponse => {
  const body = response.body;
  if (body._tag !== "Stream") return response;
  return HttpServerResponse.setBody(
    response,
    HttpBody.stream(
      body.stream.pipe(Stream.interruptWhen(interruptWhenRevoked(access, deviceId))),
      body.contentType,
      body.contentLength,
    ),
  );
};

const bearerMiddleware = (ownerBearer: string, access: HostAccess) =>
  HttpRouter.middleware((httpEffect) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      bearerMatches(request.headers.authorization, ownerBearer)
        ? httpEffect
        : (() => {
            const token = bearerTokenFrom(request.headers.authorization);
            const device = token === null ? null : access.authenticate(token);
            return device === null
              ? Effect.succeed(
                  HttpServerResponse.empty({
                    status: 401,
                    headers: { "www-authenticate": 'Bearer realm="Honk Core"' },
                  }),
                )
              : httpEffect.pipe(
                  Effect.map((response) =>
                    interruptStreamingBodyWhenRevoked(response, access, device.id),
                  ),
                );
          })(),
    ),
  );

const rpcRouteLayer = (
  options: HonkCore.HonkCoreOptions,
  ownerBearer: string,
  access: HostAccess,
) =>
  RpcServer.layerHttp({
    group: Rpcs,
    path: "/rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(bearerMiddleware(ownerBearer, access).layer),
    Layer.provide(HonkCore.layer(options)),
    Layer.provide(RpcSerialization.layerNdjson),
  );

const accessRoutesLayer = (access: HostAccess, environmentId: string) =>
  Layer.mergeAll(
    HttpRouter.add("GET", "/healthz", HttpServerResponse.empty({ status: 204 })),
    HttpRouter.add(
      "POST",
      "/access/v1/pairing/preview",
      HttpServerRequest.schemaBodyJson(PairingPreviewBody).pipe(
        Effect.map((body) => {
          const preview = access.preview(body.token);
          return preview === null
            ? jsonError(401, "pairing_invalid")
            : HttpServerResponse.jsonUnsafe({
                protocolVersion: HONK_ACCESS_PROTOCOL_VERSION,
                environmentId,
                ...preview,
              });
        }),
        Effect.orElseSucceed(() => jsonError(400, "request_invalid")),
      ),
    ),
    HttpRouter.add("POST", "/access/v1/pairing/exchange", (request) =>
      HttpServerRequest.schemaBodyJson(PairingExchangeBody).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.succeed(jsonError(400, "request_invalid")),
          onSuccess: (body) => {
            const replacementBearer = bearerTokenFrom(request.headers.authorization) ?? undefined;
            if (body.replaceDeviceId !== undefined) {
              const replacement =
                replacementBearer === undefined ? null : access.authenticate(replacementBearer);
              if (replacement?.id !== body.replaceDeviceId) {
                return Effect.succeed(jsonError(401, "replacement_invalid"));
              }
            }
            return accessRequest(() =>
              access.provision(body.token, body.requestId, body.label, body.replaceDeviceId),
            ).pipe(
              Effect.map((result) => {
                if (result.status === "invalid") return jsonError(401, "pairing_invalid");
                if (result.status === "in-progress") return jsonError(409, "pairing_in_progress");
                return HttpServerResponse.jsonUnsafe({
                  environmentId,
                  bearerToken: result.device.bearerToken,
                  expiresAt: result.device.expiresAt,
                  device: { id: result.device.id, label: result.device.label },
                });
              }),
              Effect.orElseSucceed(() => jsonError(500, "access_state_failed")),
            );
          },
        }),
      ),
    ),
    HttpRouter.add("POST", "/access/v1/pairing/confirm", (request) => {
      const bearerToken = bearerTokenFrom(request.headers.authorization);
      if (bearerToken === null) return Effect.succeed(jsonError(401, "pairing_invalid"));
      return accessRequest(() => access.confirm(bearerToken)).pipe(
        Effect.map((result) =>
          result.status === "invalid"
            ? jsonError(401, "pairing_invalid")
            : HttpServerResponse.jsonUnsafe({
                environmentId,
                device: { id: result.device.id, label: result.device.label },
              }),
        ),
        Effect.orElseSucceed(() => jsonError(500, "access_state_failed")),
      );
    }),
    HttpRouter.add("POST", "/access/v1/pairing/cancel", (request) => {
      const bearerToken = bearerTokenFrom(request.headers.authorization);
      if (bearerToken === null) return Effect.succeed(jsonError(401, "pairing_invalid"));
      return accessRequest(() => access.cancelPairingCandidate(bearerToken)).pipe(
        Effect.map((result) =>
          result.cancelled
            ? HttpServerResponse.jsonUnsafe({ cancelled: true })
            : jsonError(401, "pairing_invalid"),
        ),
        Effect.orElseSucceed(() => jsonError(500, "access_state_failed")),
      );
    }),
  );

const handshakeRouteLayer = (ownerBearer: string, access: HostAccess) =>
  HttpRouter.add(
    "GET",
    "/core/v1/handshake",
    HttpServerResponse.jsonUnsafe(HONK_CORE_PROTOCOL),
  ).pipe(Layer.provide(bearerMiddleware(ownerBearer, access).layer));

// The dev renderer runs on its own origin (the Vite port), so the host answers
// preflights. CORS controls browser origins; the required bearer credential is
// the authorization boundary for local, CLI, and remote clients.
const serveLayer = (
  options: HonkCore.HonkCoreOptions,
  ownerBearer: string,
  access: HostAccess,
  environmentId: string,
) =>
  HttpRouter.serve(
    Layer.mergeAll(
      rpcRouteLayer(options, ownerBearer, access),
      handshakeRouteLayer(ownerBearer, access),
      accessRoutesLayer(access, environmentId),
      HttpRouter.cors(),
    ),
    {
      disableLogger: true,
      disableListenLog: true,
    },
  );

export const makeNodeHost = (options: HonkCore.HonkCoreOptions) => {
  const bearerToken = randomBytes(32).toString("base64url");
  return Layer.unwrap(
    Effect.promise(() => openHostAccess(options.dataDirectory)).pipe(
      Effect.orDie,
      Effect.map(({ access, environmentId }) =>
        Layer.effect(
          HonkNodeHost,
          Effect.gen(function* () {
            const { address } = yield* HttpServer.HttpServer;
            if (address._tag !== "TcpAddress") {
              return yield* Effect.die(new Error("Honk Core host expected a TCP address."));
            }
            const connection: HonkConnection = {
              url: `http://127.0.0.1:${address.port}`,
              bearerToken,
            };

            // Discovery for out-of-process clients — the verification CLI reads
            // this to reach the running host instead of fighting it for the writer
            // lease. Removed on shutdown so a dead host never advertises.
            const hostFile = join(options.dataDirectory, "host.json");
            yield* Effect.promise(async () => {
              await writeFile(hostFile, `${JSON.stringify(connection)}\n`, { mode: 0o600 });
              await chmod(hostFile, 0o600);
            }).pipe(Effect.ignore);
            yield* Effect.addFinalizer(() =>
              Effect.promise(() => rm(hostFile, { force: true })).pipe(Effect.ignore),
            );

            return HonkNodeHost.of({
              connection,
              environmentId,
              issuePairing: (publicOrigin, computerLabel) => {
                const pairing = access.issuePairing(computerLabel ?? hostname());
                return {
                  id: pairing.id,
                  url: makePairingUrl(publicOrigin, pairing.token),
                  expiresAt: pairing.expiresAt,
                };
              },
              pairingState: (id) => access.pairingState(id),
              cancelPairing: (id) => access.cancelPairing(id).then((result) => result.cancelled),
              devices: () => access.list().filter((device) => device.revokedAt === null),
              revokeDevice: (id) => access.revoke(id),
            });
          }),
        ).pipe(
          Layer.provide(serveLayer(options, bearerToken, access, environmentId)),
          Layer.provide(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 })),
        ),
      ),
    ),
  );
};
