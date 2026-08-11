#!/usr/bin/env bun
/**
 * Honk Core verification CLI.
 *
 * Drives the same command catalog every client uses, from a terminal, so a
 * change can be re-verified against a live host instead of trusted from a
 * test run. Two modes, resolved automatically:
 *
 * - **Connect**: when the data directory holds a `host.json` written by a
 *   running host, commands travel the real authenticated remote path — Effect
 *   RPC over HTTP with ndjson framing, the exact wiring the desktop renderer
 *   uses.
 * - **Standalone**: otherwise a core is opened in-process over the data
 *   directory (taking the writer lease, exactly like an app launch) with the
 *   real provider catalog over the data directory's stored credentials — so
 *   `login` then `prompt` reaches a real model from this terminal.
 *
 * Usage:
 *   bun scripts/cli.ts [--data <dir>] <command> [args]
 *
 * Commands:
 *   sessions                                   list stored sessions
 *   session <sessionId>                        resolve one session
 *   create <workspaceId> [providerId modelId]  create a session
 *   prompt <sessionId> <text...>               send a prompt, print the reply
 *   changes <sessionId>                        per-turn change receipts
 *   reload <sessionId>                         transcript summary + run phase
 *   delete <sessionId>                         delete a session and its checkpoints
 *   revert <sessionId> <entryId>               restore a turn's checkpoint
 *   open <directory>                           workspace trust state
 *   trust <directory>                          record trust for a directory
 *   models                                     provider catalog with auth status
 *   login <providerId> <key>                   store an API key for a provider
 *   logout <providerId>                        remove a provider's credential
 *   git-status <workspaceId>                   working-tree status
 *   checkpoints <workspaceId> [prefix]         list checkpoint names
 *   checkpoint-changes <workspaceId> <from> <to>  files between two checkpoints
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { Option, Schema } from "effect";

import { createHonkClient, HonkConnectionSchema, type HonkConnection } from "../src/client";
import { createHonkCore } from "../src/honk-core";
import { Models } from "../src/models";
import { createNodeExecutionEnv } from "../src/node";

const defaultDataDirectory = join(homedir(), ".honk", "core");

const ReloadSummary = Schema.Struct({
  phase: Schema.String,
  entries: Schema.Array(Schema.Struct({ type: Schema.optionalKey(Schema.String) })),
});
const decodeReloadSummary = Schema.decodeUnknownOption(ReloadSummary);
const decodeHonkConnection = Schema.decodeUnknownOption(HonkConnectionSchema);

type Call = (tag: string, payload: unknown) => Promise<unknown>;

interface Command {
  readonly tag: string;
  readonly usage: string;
  readonly payload: (args: readonly string[]) => Record<string, unknown> | undefined;
  /** Optional summarizer for outputs too large to dump raw. */
  readonly render?: (result: unknown) => unknown;
  /** Optional multi-call flow; commands without one make the single tag call. */
  readonly run?: (call: Call, payload: Record<string, unknown>) => Promise<unknown>;
}

/** The committed reply a prompt produced, from an authoritative reload. */
const lastAssistantText = (state: unknown): string | undefined => {
  const entries = (state as { entries?: readonly unknown[] }).entries ?? [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const content = entry.message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const block = content.find((part) => (part as { type?: string }).type === "text");
      return (block as { text?: string } | undefined)?.text;
    }
  }
  return undefined;
};

const commands: Record<string, Command> = {
  sessions: {
    tag: "session.list",
    usage: "sessions",
    payload: () => ({}),
  },
  session: {
    tag: "session.get",
    usage: "session <sessionId>",
    payload: ([sessionId]) => (sessionId ? { sessionId } : undefined),
  },
  create: {
    tag: "session.create",
    usage: "create <workspaceId> [providerId modelId]",
    payload: ([workspaceId, providerId, modelId]) =>
      workspaceId
        ? { workspaceId, ...(providerId && modelId ? { model: { providerId, modelId } } : {}) }
        : undefined,
  },
  prompt: {
    tag: "session.prompt",
    usage: "prompt <sessionId> <text...>",
    payload: ([sessionId, ...text]) =>
      sessionId && text.length > 0 ? { sessionId, text: text.join(" ") } : undefined,
    // Prompt settles when the turn does, so the authoritative reload right
    // after it holds the committed reply — the CLI's proof a model answered.
    run: async (call, payload) => {
      await call("session.prompt", payload);
      const state = await call("session.reload", { sessionId: payload.sessionId });
      return lastAssistantText(state) ?? state;
    },
  },
  changes: {
    tag: "session.changes",
    usage: "changes <sessionId>",
    payload: ([sessionId]) => (sessionId ? { sessionId } : undefined),
  },
  reload: {
    tag: "session.reload",
    usage: "reload <sessionId>",
    payload: ([sessionId]) => (sessionId ? { sessionId } : undefined),
    render: (result) => {
      const state = decodeReloadSummary(result);
      if (Option.isNone(state)) return result;
      return {
        phase: state.value.phase,
        entryCount: state.value.entries.length,
        entryTypes: state.value.entries.map((entry) => entry.type),
      };
    },
  },
  delete: {
    tag: "session.delete",
    usage: "delete <sessionId>",
    payload: ([sessionId]) => (sessionId ? { sessionId } : undefined),
  },
  revert: {
    tag: "session.revert",
    usage: "revert <sessionId> <entryId>",
    payload: ([sessionId, entryId]) => (sessionId && entryId ? { sessionId, entryId } : undefined),
  },
  open: {
    tag: "workspace.open",
    usage: "open <directory>",
    payload: ([directory]) => (directory ? { directory } : undefined),
  },
  trust: {
    tag: "workspace.trust",
    usage: "trust <directory>",
    payload: ([directory]) => (directory ? { directory } : undefined),
  },
  models: {
    tag: "models.list",
    usage: "models",
    payload: () => ({}),
    render: (result) => {
      const { providers } = result as {
        providers: readonly {
          id: string;
          configured: boolean;
          methods: readonly string[];
          authType?: string;
          source?: string;
          models: readonly unknown[];
        }[];
      };
      return providers.map((provider) => ({
        id: provider.id,
        configured: provider.configured,
        ...(provider.methods.length > 0 ? { login: provider.methods.join("|") } : {}),
        ...(provider.authType !== undefined ? { auth: provider.authType } : {}),
        ...(provider.source !== undefined ? { source: provider.source } : {}),
        models: provider.models.length,
      }));
    },
  },
  login: {
    tag: "models.set_credential",
    usage: "login <providerId> [key]   (no key runs the provider's own flow, e.g. OAuth)",
    payload: ([providerId, key]) => (providerId && key ? { providerId, key } : undefined),
  },
  logout: {
    tag: "models.delete_credential",
    usage: "logout <providerId>",
    payload: ([providerId]) => (providerId ? { providerId } : undefined),
  },
  "git-status": {
    tag: "git.status",
    usage: "git-status <workspaceId>",
    payload: ([workspaceId]) => (workspaceId ? { workspaceId } : undefined),
  },
  checkpoints: {
    tag: "git.checkpoints",
    usage: "checkpoints <workspaceId> [prefix]",
    payload: ([workspaceId, prefix]) =>
      workspaceId ? { workspaceId, ...(prefix ? { prefix } : {}) } : undefined,
  },
  "checkpoint-changes": {
    tag: "git.checkpoint_changes",
    usage: "checkpoint-changes <workspaceId> <from> <to>",
    payload: ([workspaceId, from, to]) =>
      workspaceId && from && to ? { workspaceId, from, to } : undefined,
  },
};

const usage = () => {
  console.error("Usage: bun scripts/cli.ts [--data <dir>] <command> [args]\n");
  for (const command of Object.values(commands)) console.error(`  ${command.usage}`);
  process.exit(1);
};

/**
 * Interactive provider login, driven by Pi's own flows in this terminal.
 *
 * OAuth is interactive and provider-owned, so it enters through a host
 * surface — this one — not a wire command (spec/core.md section 11). The flow
 * writes the shared auth.json in the data directory; a running desktop host
 * reads that store per request, so the new credential applies immediately
 * without restarting anything.
 */
const interactiveLogin = async (dataDirectory: string, providerId: string): Promise<void> => {
  const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
  const { registerBunOAuthFlows } = await import("@earendil-works/pi-ai/bun-oauth");
  registerBunOAuthFlows();

  const credentials = Models.credentialStore(createNodeExecutionEnv(dataDirectory));
  const collection = builtinModels({ credentials });
  const provider = collection.getProvider(providerId);
  if (provider === undefined) {
    console.error(`Unknown provider: ${providerId}`);
    process.exit(1);
  }
  const type = provider.auth.oauth !== undefined ? "oauth" : "api_key";
  if (type === "api_key" && provider.auth.apiKey?.login === undefined) {
    console.error(
      `${providerId} uses ambient credentials (env vars, config files); there is nothing to log in to.`,
    );
    process.exit(1);
  }

  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    await collection.login(providerId, type, {
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          for (const option of prompt.options) {
            console.error(`  ${option.id}  ${option.label}`);
          }
          return terminal.question(`${prompt.message}: `);
        }
        return terminal.question(`${prompt.message}: `);
      },
      notify: (event) => {
        if (event.type === "info") console.error(event.message);
        else if (event.type === "auth_url") {
          console.error(`Open this URL to continue:\n  ${event.url}`);
          if (event.instructions !== undefined) console.error(event.instructions);
        } else if (event.type === "device_code") {
          console.error(`Visit ${event.verificationUri} and enter code: ${event.userCode}`);
        }
      },
    });
  } finally {
    terminal.close();
  }
  console.log(`ok: ${providerId} logged in (${type})`);
};

/** Both modes speak the public client object, addressed by command tags. */
const sdkCall =
  (sdk: object): Call =>
  async (tag, payload) => {
    const dot = tag.indexOf(".");
    const namespace = tag.slice(0, dot);
    const method = tag
      .slice(dot + 1)
      .replace(/_(\w)/g, (_, letter: string) => letter.toUpperCase());
    const group: unknown = Reflect.get(sdk, namespace);
    if (!(group instanceof Object)) throw new Error(`Unknown command tag: ${tag}`);
    const call: unknown = Reflect.get(group, method);
    if (!(call instanceof Function)) throw new Error(`Unknown command tag: ${tag}`);
    const result: unknown = await Reflect.apply(call, group, [payload]);
    return result;
  };

const main = async () => {
  const args = [...process.argv.slice(2)];
  const takeFlag = (name: string) => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    const value = args[index + 1];
    args.splice(index, 2);
    return value;
  };

  const dataDirectory = takeFlag("--data") ?? defaultDataDirectory;
  const [name, ...rest] = args;

  // Interactive login runs Pi's own flow locally against the shared
  // credential store — no host, no wire command.
  if (name === "login" && rest.length === 1 && rest[0] !== undefined) {
    return interactiveLogin(dataDirectory, rest[0]);
  }

  const command = name ? commands[name] : undefined;
  if (!command) return usage();
  const payload = command.payload(rest);
  if (payload === undefined) return usage();

  // A running host's private discovery file is the only remote bootstrap.
  // Otherwise an unowned data directory boots a standalone Core.
  let discovered = await readFile(join(dataDirectory, "host.json"), "utf8").then(
    (content): HonkConnection | undefined => {
      try {
        return Option.getOrUndefined(decodeHonkConnection(JSON.parse(content)));
      } catch {
        return undefined;
      }
    },
    () => undefined,
  );
  // A host killed uncleanly leaves its host.json behind. Any HTTP response
  // proves liveness; only a connection failure means the file is stale.
  if (discovered) {
    const alive = await fetch(discovered.url, { method: "HEAD" }).then(
      () => true,
      () => false,
    );
    if (!alive) {
      console.error(`stale host.json ignored (${discovered.url} unreachable)`);
      discovered = undefined;
    }
  }

  let close = async () => {};
  let call: Call;
  if (discovered) {
    console.error(`connected: ${discovered.url}`);
    const sdk = await createHonkClient(discovered);
    call = sdkCall(sdk);
    close = () => sdk.close();
  } else {
    console.error(`standalone: ${dataDirectory}`);
    const core = await createHonkCore({
      dataDirectory,
      createExecutionEnv: createNodeExecutionEnv,
    });
    call = sdkCall(core.client());
    close = () => core.close();
  }

  try {
    const result = command.run
      ? await command.run(call, payload)
      : await call(command.tag, payload);
    const rendered = command.render ? command.render(result) : result;
    if (rendered === undefined) console.log("ok");
    else if (typeof rendered === "string") console.log(rendered);
    else console.log(JSON.stringify(rendered, null, 2));
  } finally {
    await close();
  }
};

main().catch((error: unknown) => {
  const described =
    typeof error === "object" && error !== null && "code" in error && "message" in error
      ? `${String((error as { code: unknown }).code)}: ${String((error as { message: unknown }).message)}`
      : String(error);
  console.error(described);
  process.exit(1);
});
