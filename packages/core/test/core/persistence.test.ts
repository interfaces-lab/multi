// spec/core.md experiment 6: restore after a host restart. Two cores open the
// same data directory in sequence and the second must find everything the
// first made — trust with stable ids, transcripts, checkpoint history — while
// two cores at once must be refused by the writer lease.

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";

import type { HonkClient } from "../../src/client";
import { createHonkCore, LeaseError } from "../../src/honk-core";
import { Session } from "../../src/session";
import { createExecutionEnv } from "../../src/testing";

// Each call is "one host process": a fresh faux provider over the same data
// directory, exactly like an app relaunch with the same models configured.
const startCore = async (dataDirectory: string) => {
  const faux = fauxProvider();
  const collection = createModels();
  collection.setProvider(faux.provider);
  const core = await createHonkCore({
    dataDirectory,
    createModels: () => collection,
    generateSessionTitle: Session.generatePromptSessionTitle,
    createExecutionEnv,
  });
  return { core, faux };
};

const openTrusted = async (sdk: HonkClient, directory: string) => {
  await sdk.workspace.trust({ directory });
  const opened = await sdk.workspace.open({ directory });
  if (opened.type !== "ready") throw new Error("expected a ready workspace after trust");
  return opened;
};

const gitWorkspace = async () => {
  const directory = await mkdtemp(join(tmpdir(), "honk-persist-ws-"));
  execFileSync("git", ["init", "."], { cwd: directory });
  return directory;
};

const editCall = (path: string, oldText: string, newText: string) =>
  fauxToolCall("edit", { path, edits: [{ oldText, newText }] });

describe("restart restore", () => {
  it("a second host finds the first host's trust, transcript, and turn history", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-persist-data-"));
    const workspaceDirectory = await gitWorkspace();
    await writeFile(join(workspaceDirectory, "hello.txt"), "one\n");

    // First life: trust, converse, change a file, shut down cleanly.
    const first = await startCore(dataDirectory);
    const sdk1 = first.core.client();
    const workspace1 = await openTrusted(sdk1, workspaceDirectory);
    const session = await sdk1.session.create({ workspaceId: workspace1.id });

    first.faux.setResponses([
      fauxAssistantMessage([editCall("hello.txt", "one", "two")]),
      fauxAssistantMessage("Changed it."),
    ]);
    await sdk1.session.prompt({ sessionId: session.id, text: "one to two" });
    const before = await sdk1.session.changes({ sessionId: session.id });
    expect(before.turns).toHaveLength(1);
    await first.core.close();

    // Second life: same directory, new process.
    const second = await startCore(dataDirectory);
    const sdk2 = second.core.client();

    // Trust survived, and crucially the id did: stored sessions reference it.
    const reopened = await sdk2.workspace.open({ directory: workspaceDirectory });
    expect(reopened.type).toBe("ready");
    if (reopened.type === "ready") expect(reopened.id).toBe(workspace1.id);

    // The session lists without opening, resolves by id, and reloads its
    // committed transcript through a lazily restored harness.
    const listed = await sdk2.session.list({});
    expect(listed.sessions.map((entry) => entry.id)).toEqual([session.id]);
    expect(await sdk2.session.get({ sessionId: session.id })).toEqual({
      id: session.id,
      workspaceId: workspace1.id,
    });
    const state = await sdk2.session.reload({ sessionId: session.id });
    expect(state.entries.length).toBeGreaterThan(0);

    // The restored harness runs on the transcript's recorded model — one
    // model_change entry from create, and restoration resolved it rather
    // than appending a second record or substituting a default.
    const modelChanges = state.entries.filter((entry) => entry.type === "model_change");
    expect(modelChanges).toHaveLength(1);
    expect(modelChanges[0]).toMatchObject({ provider: "faux" });

    // The checkpoint history was rebuilt from git refs plus the transcript,
    // so per-turn changes answer identically across the restart.
    const after = await sdk2.session.changes({ sessionId: session.id });
    expect(after.turns).toEqual(before.turns);

    // The conversation continues: a new turn lands in the same transcript
    // and gets its own receipt.
    second.faux.setResponses([
      fauxAssistantMessage([editCall("hello.txt", "two", "three")]),
      fauxAssistantMessage("Changed again."),
    ]);
    await sdk2.session.prompt({ sessionId: session.id, text: "two to three" });
    expect((await sdk2.session.changes({ sessionId: session.id })).turns).toHaveLength(2);

    // And the first life's checkpoints are still restorable.
    await sdk2.session.revert({ sessionId: session.id, entryId: "base" });
    expect(await readFile(join(workspaceDirectory, "hello.txt"), "utf8")).toBe("one\n");

    await second.core.close();
  });

  it("delete removes the transcript for every later host, and prunes its checkpoints", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-persist-data-"));
    const workspaceDirectory = await gitWorkspace();
    await writeFile(join(workspaceDirectory, "hello.txt"), "one\n");

    const first = await startCore(dataDirectory);
    const sdk1 = first.core.client();
    const workspace = await openTrusted(sdk1, workspaceDirectory);
    const session = await sdk1.session.create({ workspaceId: workspace.id });

    // A settled turn leaves checkpoint refs in the workspace repository...
    first.faux.setResponses([
      fauxAssistantMessage([editCall("hello.txt", "one", "two")]),
      fauxAssistantMessage("done"),
    ]);
    await sdk1.session.prompt({ sessionId: session.id, text: "one to two" });
    const refs = () =>
      execFileSync("git", ["for-each-ref", "refs/honk/checkpoints"], {
        cwd: workspaceDirectory,
        encoding: "utf8",
      }).trim();
    expect(refs()).not.toBe("");

    // ...and deleting the session takes them with it: snapshots of turns
    // nobody can name anymore are litter, not history.
    await sdk1.session.delete({ sessionId: session.id });
    expect(refs()).toBe("");
    expect((await sdk1.session.list({})).sessions).toEqual([]);
    await first.core.close();

    const second = await startCore(dataDirectory);
    const sdk2 = second.core.client();
    expect((await sdk2.session.list({})).sessions).toEqual([]);
    await expect(sdk2.session.reload({ sessionId: session.id })).rejects.toBeInstanceOf(
      Session.NotFoundError,
    );
    await second.core.close();
  });
});

describe("writer lease", () => {
  it("one live host per data directory, released on close", { timeout: 20_000 }, async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-lease-data-"));

    const first = await startCore(dataDirectory);
    // The contender observes the fresh lease for a few seconds, sees the
    // owner's heartbeat move it, and is refused.
    await expect(startCore(dataDirectory)).rejects.toBeInstanceOf(LeaseError);

    // A clean close releases immediately; no staleness wait is involved.
    await first.core.close();
    const second = await startCore(dataDirectory);
    await second.core.close();
  });

  it("takes over a dead owner's lease instead of locking out", { timeout: 20_000 }, async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "honk-lease-dead-"));
    // A fresh lease file with no host behind it: the shape a killed dev
    // server or a crashed app leaves behind. No heartbeat moves it during
    // the observation window, so the next host takes over in seconds.
    await writeFile(join(dataDirectory, "lease"), "dead-owner");

    const core = await startCore(dataDirectory);
    await core.core.close();
  });

  it("a data directory that does not exist yet is created, not refused", async () => {
    const base = await mkdtemp(join(tmpdir(), "honk-lease-fresh-"));
    // The first launch of an app points at a directory nothing has made.
    const core = await startCore(join(base, "nested", "data"));
    await core.core.close();
  });
});
