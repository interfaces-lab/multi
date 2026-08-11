// spec/core.md section 7: a settled turn captures a workspace checkpoint, and
// sdk.session.changes diffs consecutive checkpoints gated by the turn's own
// tool calls. These tests run the real Pi tools against real temp git
// repositories, so a path appears here because a turn actually changed it on
// disk — including through bash, which no argument-reading fold could see.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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
import { createHonkCore } from "../../src/honk-core";
import { createExecutionEnv, generatePromptSessionTitle } from "../../src/testing";
import { Tools } from "../../src/tools";

const startCore = async () => {
  const faux = fauxProvider();
  const collection = createModels();
  collection.setProvider(faux.provider);
  const core = await createHonkCore({
    dataDirectory: await mkdtemp(join(tmpdir(), "honk-core-data-")),
    createModels: () => collection,
    generateSessionTitle: generatePromptSessionTitle,
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

// Checkpoints need a repository, not commits: capture writes its own hidden
// objects, so `git init` alone is enough and no identity is configured.
const gitWorkspace = async () => {
  const directory = await mkdtemp(join(tmpdir(), "honk-changes-"));
  execFileSync("git", ["init", "."], { cwd: directory });
  return directory;
};

const editCall = (path: string, oldText: string, newText: string) =>
  fauxToolCall("edit", { path, edits: [{ oldText, newText }] });

describe("tool write classification", () => {
  it("declares the path a write or edit call named", () => {
    expect(Tools.writesOf("edit", { path: "src/auth.ts", edits: [] })).toEqual({
      kind: "declared",
      paths: ["src/auth.ts"],
    });
    expect(Tools.writesOf("write", { path: "README.md", content: "" })).toEqual({
      kind: "declared",
      paths: ["README.md"],
    });
  });

  it("reads nothing into a read, and everything into an opaque mutator", () => {
    expect(Tools.writesOf("read", { path: "src/auth.ts" })).toEqual({ kind: "none" });
    // bash can write anything its command touches, and an unknown MCP tool is
    // treated the same: erring open is a visible mistake, dropping a write is
    // an invisible one.
    expect(Tools.writesOf("bash", { command: "make generate" })).toEqual({ kind: "opaque" });
    expect(Tools.writesOf("some-mcp-tool", { path: "x" })).toEqual({ kind: "opaque" });
  });

  it("declares nothing rather than guessing at unreadable arguments", () => {
    expect(Tools.writesOf("edit", { nope: 1 })).toEqual({ kind: "declared", paths: [] });
    expect(Tools.writesOf("edit", null)).toEqual({ kind: "declared", paths: [] });
  });
});

describe("session.changes", () => {
  it("reports one turn's edit as that turn's receipt", async () => {
    const directory = await gitWorkspace();
    await writeFile(join(directory, "hello.txt"), "one\n");

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);
    const session = await sdk.session.create({ workspaceId: workspace.id });

    // Nothing has run, so nothing is claimed.
    expect((await sdk.session.changes({ sessionId: session.id })).turns).toEqual([]);

    faux.setResponses([
      fauxAssistantMessage([editCall("hello.txt", "one", "two")]),
      fauxAssistantMessage("Renamed the value."),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "Change one to two" });
    expect(await readFile(join(directory, "hello.txt"), "utf8")).toBe("two\n");

    const { turns } = await sdk.session.changes({ sessionId: session.id });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.files.map((file) => file.file)).toEqual(["hello.txt"]);
    expect(turns[0]?.files[0]).toMatchObject({ status: "modified" });
    // The entry id anchors the receipt to its transcript row and is the
    // handle a client passes back to revert.
    expect(turns[0]?.entryId).not.toBe("");

    await core.close();
  });

  it("reports only checkpoints on the active sibling branch", async () => {
    const directory = await gitWorkspace();
    await writeFile(join(directory, "branch.txt"), "one\n");

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);
    const session = await sdk.session.create({ workspaceId: workspace.id });

    faux.setResponses([
      fauxAssistantMessage([editCall("branch.txt", "one", "two")]),
      fauxAssistantMessage("Original branch done."),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "one to two" });
    const original = (await sdk.session.reload({ sessionId: session.id })).entries.find(
      (entry) => entry.type === "message" && entry.message.role === "user",
    );
    if (original === undefined) throw new Error("missing original user message");

    faux.setResponses([
      fauxAssistantMessage([editCall("branch.txt", "two", "three")]),
      fauxAssistantMessage("Revised branch done."),
    ]);
    await sdk.session.editMessage({
      sessionId: session.id,
      entryId: original.id,
      text: "one to three instead",
    });

    expect(await readFile(join(directory, "branch.txt"), "utf8")).toBe("three\n");
    const { turns } = await sdk.session.changes({ sessionId: session.id });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.files.map((file) => file.file)).toEqual(["branch.txt"]);

    await core.close();
  });

  it("keeps turns separate: two passes over one file are two receipts", async () => {
    const directory = await gitWorkspace();
    await writeFile(join(directory, "a.txt"), "1\n");

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);
    const session = await sdk.session.create({ workspaceId: workspace.id });

    faux.setResponses([
      fauxAssistantMessage([editCall("a.txt", "1", "2")]),
      fauxAssistantMessage("First pass done."),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "one to two" });

    faux.setResponses([
      fauxAssistantMessage([editCall("a.txt", "2", "3")]),
      fauxAssistantMessage("Second pass done."),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "two to three" });

    const { turns } = await sdk.session.changes({ sessionId: session.id });
    expect(turns).toHaveLength(2);
    expect(turns[0]?.files.map((file) => file.file)).toEqual(["a.txt"]);
    expect(turns[1]?.files.map((file) => file.file)).toEqual(["a.txt"]);
    expect(turns[0]?.entryId).not.toBe(turns[1]?.entryId);

    await core.close();
  });

  it("scopes to one thread: a sibling session's edits do not leak in", async () => {
    const directory = await gitWorkspace();
    await writeFile(join(directory, "mine.txt"), "m\n");
    await writeFile(join(directory, "theirs.txt"), "t\n");

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);

    const mine = await sdk.session.create({ workspaceId: workspace.id });
    const theirs = await sdk.session.create({ workspaceId: workspace.id });

    faux.setResponses([
      fauxAssistantMessage([editCall("mine.txt", "m", "M")]),
      fauxAssistantMessage("done"),
    ]);
    await sdk.session.prompt({ sessionId: mine.id, text: "edit mine" });

    faux.setResponses([
      fauxAssistantMessage([editCall("theirs.txt", "t", "T")]),
      fauxAssistantMessage("done"),
    ]);
    await sdk.session.prompt({ sessionId: theirs.id, text: "edit theirs" });

    // Both sessions share one directory, so theirs' snapshot diff contains
    // mine's edit — the attribution gate is what keeps it out of the receipt.
    const mineFiles = (await sdk.session.changes({ sessionId: mine.id })).turns.flatMap((turn) =>
      turn.files.map((file) => file.file),
    );
    const theirsFiles = (await sdk.session.changes({ sessionId: theirs.id })).turns.flatMap(
      (turn) => turn.files.map((file) => file.file),
    );
    expect(mineFiles).toEqual(["mine.txt"]);
    expect(theirsFiles).toEqual(["theirs.txt"]);

    await core.close();
  });

  it("relativizes an absolute declared path and keeps the gate scoped", async () => {
    const directory = await gitWorkspace();
    await writeFile(join(directory, "mine.txt"), "m\n");
    await writeFile(join(directory, "theirs.txt"), "t\n");

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);
    const mine = await sdk.session.create({ workspaceId: workspace.id });
    const theirs = await sdk.session.create({ workspaceId: workspace.id });

    // A sibling edit lands between mine's checkpoints, so mine's snapshot
    // diff contains it — only the gate keeps it out of the receipt.
    faux.setResponses([
      fauxAssistantMessage([editCall("theirs.txt", "t", "T")]),
      fauxAssistantMessage("done"),
    ]);
    await sdk.session.prompt({ sessionId: theirs.id, text: "edit theirs" });

    // The model names its file absolutely, as Pi's writing tools allow. The
    // workspace's own directory is the canonical form — trust resolved it
    // through the real filesystem, exactly as the model sees it in its cwd.
    faux.setResponses([
      fauxAssistantMessage([editCall(join(workspace.directory, "mine.txt"), "m", "M")]),
      fauxAssistantMessage("done"),
    ]);
    await sdk.session.prompt({ sessionId: mine.id, text: "edit mine" });

    // The absolute path aligns with git's workspace-relative form: the write
    // appears, the sibling's does not — the turn stayed declared, not opaque.
    const { turns } = await sdk.session.changes({ sessionId: mine.id });
    expect(turns.flatMap((turn) => turn.files.map((file) => file.file))).toEqual(["mine.txt"]);

    await core.close();
  });

  it("errs open when a declared path cannot be placed in the workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "honk-alias-"));
    const directory = join(parent, "workspace");
    await mkdir(directory);
    execFileSync("git", ["init", "."], { cwd: directory });
    await writeFile(join(directory, "hello.txt"), "one\n");
    await symlink(directory, join(parent, "alias"));

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);
    const session = await sdk.session.create({ workspaceId: workspace.id });

    // The write reaches the file through a symlink outside the workspace, so
    // no lexical resolution can place it inside. The gate must err open —
    // the turn goes opaque and claims the whole diff — because filtering on
    // the unplaceable path would silently drop a real write.
    faux.setResponses([
      fauxAssistantMessage([editCall(join(parent, "alias", "hello.txt"), "one", "two")]),
      fauxAssistantMessage("done"),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "edit through the alias" });
    expect(await readFile(join(directory, "hello.txt"), "utf8")).toBe("two\n");

    const { turns } = await sdk.session.changes({ sessionId: session.id });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.files.map((file) => file.file)).toEqual(["hello.txt"]);

    await core.close();
  });

  it("sees what bash wrote, which no argument fold ever could", async () => {
    const directory = await gitWorkspace();

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);
    const session = await sdk.session.create({ workspaceId: workspace.id });

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo made > generated.txt" })]),
      fauxAssistantMessage("Generated."),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "generate the file" });
    expect(await readFile(join(directory, "generated.txt"), "utf8")).toBe("made\n");

    // An opaque turn claims the whole snapshot diff.
    const { turns } = await sdk.session.changes({ sessionId: session.id });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.files.map((file) => file.file)).toEqual(["generated.txt"]);
    expect(turns[0]?.files[0]).toMatchObject({ status: "added" });

    await core.close();
  });

  it("a workspace without a repository honestly reports no turns", async () => {
    const directory = await mkdtemp(join(tmpdir(), "honk-plain-"));
    await writeFile(join(directory, "hello.txt"), "one\n");

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);
    const session = await sdk.session.create({ workspaceId: workspace.id });

    faux.setResponses([
      fauxAssistantMessage([editCall("hello.txt", "one", "two")]),
      fauxAssistantMessage("done"),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "edit it" });

    // The edit really happened; there is simply no checkpoint to diff.
    expect(await readFile(join(directory, "hello.txt"), "utf8")).toBe("two\n");
    expect((await sdk.session.changes({ sessionId: session.id })).turns).toEqual([]);

    await core.close();
  });
});

describe("session.setWorkspace", () => {
  it("moves the session: the next turn runs in the new directory", async () => {
    const first = await gitWorkspace();
    const second = await gitWorkspace();
    await writeFile(join(first, "a.txt"), "a\n");
    await writeFile(join(second, "b.txt"), "b\n");

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspaceA = await openTrusted(sdk, first);
    const workspaceB = await openTrusted(sdk, second);
    const session = await sdk.session.create({ workspaceId: workspaceA.id });

    faux.setResponses([
      fauxAssistantMessage([editCall("a.txt", "a", "A")]),
      fauxAssistantMessage("done in a"),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "edit a" });

    await sdk.session.setWorkspace({ sessionId: session.id, workspaceId: workspaceB.id });

    faux.setResponses([
      fauxAssistantMessage([editCall("b.txt", "b", "B")]),
      fauxAssistantMessage("done in b"),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "edit b" });

    // The second turn wrote in the second workspace, not the first.
    expect(await readFile(join(first, "a.txt"), "utf8")).toBe("A\n");
    expect(await readFile(join(second, "b.txt"), "utf8")).toBe("B\n");

    // One receipt per workspace; the /cd boundary itself claims nothing.
    const { turns } = await sdk.session.changes({ sessionId: session.id });
    expect(turns.map((turn) => turn.files.map((file) => file.file))).toEqual([
      ["a.txt"],
      ["b.txt"],
    ]);

    await core.close();
  });
});

describe("session.revert", () => {
  it("restores a turn's checkpoint, and the revert is itself revertible", async () => {
    const directory = await gitWorkspace();
    await writeFile(join(directory, "hello.txt"), "one\n");

    const { core, faux } = await startCore();
    const sdk = core.client();
    const workspace = await openTrusted(sdk, directory);
    const session = await sdk.session.create({ workspaceId: workspace.id });

    faux.setResponses([
      fauxAssistantMessage([editCall("hello.txt", "one", "two")]),
      fauxAssistantMessage("done"),
    ]);
    await sdk.session.prompt({ sessionId: session.id, text: "one to two" });
    const { turns } = await sdk.session.changes({ sessionId: session.id });
    const turnEntry = turns[0]?.entryId ?? "";

    // Back to before the conversation touched anything.
    await sdk.session.revert({ sessionId: session.id, entryId: "base" });
    expect(await readFile(join(directory, "hello.txt"), "utf8")).toBe("one\n");

    // The turn's checkpoint survived the revert, so undo is another revert.
    await sdk.session.revert({ sessionId: session.id, entryId: turnEntry });
    expect(await readFile(join(directory, "hello.txt"), "utf8")).toBe("two\n");

    // Revert bookkeeping never shows up as a change receipt.
    const after = await sdk.session.changes({ sessionId: session.id });
    expect(after.turns.map((turn) => turn.entryId)).toEqual([turnEntry]);

    await core.close();
  });
});
