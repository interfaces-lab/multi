#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createHonkClient, type HonkClient } from "@honk/core";
import { makeNodeHost, HonkNodeHost, type HonkNodeHostShape } from "@honk/core/node-host";
import { createNodeExecutionEnv } from "@honk/core/node";
import {
  disableTailscaleHttpsServe,
  enableTailscaleHttpsServe,
  resolveTailscaleHttpsEndpoint,
} from "@honk/core/tailscale";
import { Effect } from "effect";

import { CLI_VERSION, parseCliCommand, type ServeOptions } from "./command";
import { renderTerminalQrCode } from "./qr";

const HTTPS_PORT = 443;

const usage = `Honk ${CLI_VERSION}

Usage:
  honk serve [directory] [--data <directory>] [--label <name>]

Starts one authenticated Honk Core host for the selected workspace and publishes
it privately with Tailscale Serve. Both computers must be signed in to the same
tailnet.
`;

const prepareWorkspace = async (
  client: HonkClient,
  directory: string,
): Promise<{ readonly id: string; readonly sessionId: string }> => {
  let workspace = await client.workspace.open({ directory });
  if (workspace.type === "trust_required") {
    await client.workspace.trust({ directory: workspace.directory });
    workspace = await client.workspace.open({ directory: workspace.directory });
  }
  if (workspace.type !== "ready") throw new Error("Honk could not open the selected workspace.");

  const listed = await client.session.list({});
  const existing = listed.sessions
    .filter((session) => session.workspaceId === workspace.id && session.delegation === undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (existing !== undefined) return { id: workspace.id, sessionId: existing.id };

  const created = await client.session.create({ workspaceId: workspace.id });
  return { id: workspace.id, sessionId: created.id };
};

const publishTailscale = (host: HonkNodeHostShape) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const endpoint = await resolveTailscaleHttpsEndpoint(HTTPS_PORT);
      await enableTailscaleHttpsServe(host.connection.url, HTTPS_PORT);
      try {
        const response = await fetch(new URL("/healthz", endpoint.url), {
          signal: AbortSignal.timeout(5_000),
        });
        if (response.status !== 204) throw new Error("The Tailscale address is not ready.");
      } catch (cause: unknown) {
        await disableTailscaleHttpsServe(HTTPS_PORT).catch(() => undefined);
        throw cause;
      }
      return endpoint;
    }),
    () => Effect.promise(() => disableTailscaleHttpsServe(HTTPS_PORT)).pipe(Effect.ignore),
  );

const serve = (options: ServeOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* HonkNodeHost;
      const client = yield* Effect.acquireRelease(
        Effect.promise(() => createHonkClient(host.connection)),
        (opened) => Effect.promise(() => opened.close()).pipe(Effect.ignore),
      );
      const workspace = yield* Effect.promise(() =>
        prepareWorkspace(client, options.workspaceDirectory),
      );

      const endpoint = yield* publishTailscale(host);
      const pairing = host.issuePairing(endpoint.url, options.computerLabel);

      process.stdout.write(
        [
          `Honk is running at ${endpoint.url}`,
          `Workspace: ${options.workspaceDirectory}`,
          `Session: ${workspace.sessionId}`,
          "",
          "Scan in Honk mobile:",
          renderTerminalQrCode(pairing.url),
          "",
          pairing.url,
          `Pairing expires at ${new Date(pairing.expiresAt).toLocaleTimeString()}.`,
          "Press Ctrl+C to stop Honk and remove the Tailscale Serve route.",
          "",
        ].join("\n"),
      );

      return yield* Effect.never;
    }),
  ).pipe(
    Effect.provide(
      makeNodeHost({
        dataDirectory: options.dataDirectory,
        createExecutionEnv: createNodeExecutionEnv,
      }),
    ),
  );

let command;
try {
  command = parseCliCommand(process.argv.slice(2));
} catch (cause: unknown) {
  process.stderr.write(
    `${cause instanceof Error ? cause.message : "Invalid arguments."}\n\n${usage}`,
  );
  process.exitCode = 1;
}

if (command?.type === "help") {
  process.stdout.write(usage);
} else if (command?.type === "version") {
  process.stdout.write(`${CLI_VERSION}\n`);
} else if (command?.type === "serve") {
  NodeRuntime.runMain(serve(command.options));
}
