// Shared wiring for the MCP suite: a data directory whose path the tests
// know (override and cache files are asserted on disk), a workspace with a
// project .mcp.json naming fixture stdio servers, and marker files that count
// real server boots.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Layer } from "effect";

import { Mcp } from "../../src/mcp";
import { createExecutionEnv, openTrustedWorkspace } from "../../src/testing";
import { Workspace } from "../../src/workspace";

export const fixtureServerPath = join(import.meta.dirname, "fixtures", "server.mjs");

export interface McpFixture {
  readonly dataDirectory: string;
  readonly workspaceDirectory: string;
  readonly storage: Workspace.ExecutionEnv;
  readonly globalConfigDirectory: string;
  readonly markerOf: (label: string) => string;
  readonly bootsOf: (label: string) => number[];
  readonly writeProjectConfig: (servers: Record<string, unknown>) => void;
  readonly writeOverrides: (workspaceId: string, overrides: unknown) => void;
  readonly fixtureServer: (label: string) => { command: string; args: string[] };
  /** A fresh service world over this fixture's stores: new managers, same files. */
  readonly world: <A, E>(
    program: Effect.Effect<A, E, Mcp.Service | Workspace.Service>,
  ) => Effect.Effect<A, E>;
}

export const makeMcpFixture = (): McpFixture => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "honk-mcp-data-"));
  const workspaceDirectory = mkdtempSync(join(tmpdir(), "honk-mcp-ws-"));
  const globalConfigDirectory = mkdtempSync(join(tmpdir(), "honk-mcp-global-"));
  const storage = createExecutionEnv(dataDirectory);

  const markerOf = (label: string) => join(workspaceDirectory, `${label}.boots`);
  const bootsOf = (label: string) => {
    try {
      return readFileSync(markerOf(label), "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map(Number);
    } catch {
      return [];
    }
  };

  const fixtureServer = (label: string) => ({
    command: process.execPath,
    args: [fixtureServerPath, markerOf(label), label],
  });

  const writeProjectConfig = (servers: Record<string, unknown>) => {
    writeFileSync(join(workspaceDirectory, ".mcp.json"), JSON.stringify({ mcpServers: servers }));
  };

  const writeOverrides = (workspaceId: string, overrides: unknown) => {
    writeFileSync(join(dataDirectory, `mcp-${workspaceId}.json`), JSON.stringify(overrides));
  };

  const world = <A, E>(program: Effect.Effect<A, E, Mcp.Service | Workspace.Service>) =>
    program.pipe(
      Effect.provide(
        Mcp.defaultLayer({ storage, globalConfigDirectory }).pipe(
          Layer.provideMerge(Workspace.defaultLayer({ createExecutionEnv, storage })),
        ),
      ),
    );

  return {
    dataDirectory,
    workspaceDirectory,
    storage,
    globalConfigDirectory,
    markerOf,
    bootsOf,
    writeProjectConfig,
    writeOverrides,
    fixtureServer,
    world,
  };
};

/** Trusts and opens the fixture workspace, returning its id. */
export const openFixtureWorkspace = (fixture: McpFixture) =>
  Effect.gen(function* () {
    const opened = yield* openTrustedWorkspace(fixture.workspaceDirectory);
    return opened.id;
  });

/** Polls until a pid exits, or reports it still alive after the deadline. */
export const waitForExit = (pid: number): Promise<boolean> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      try {
        process.kill(pid, 0);
        if (Date.now() - startedAt > 5000) {
          clearInterval(timer);
          resolve(false);
        }
      } catch {
        clearInterval(timer);
        resolve(true);
      }
    }, 50);
  });

export const processLives = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
