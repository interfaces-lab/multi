# Honk Core

> **Status:** Working draft. This document helps us build, test, and decide.
> Honk owns it.
>
> Pi's `AgentHarness` is the core. Honk hosts it, extends it, and makes it
> available to desktop, web, and mobile. We do not copy its session model into a
> second Honk model.

## Read this first

The design fits in five statements:

1. One host process opens Honk Core and holds its writer lease.
2. Every Honk session contains a real Pi `AgentHarness`.
3. A workspace is either unopened or trusted; trusted code runs without
   per-action permission checks.
4. Clients reload Pi session data and render the messages themselves.
5. The host keeps running across interface reloads and disconnects.

This is a human-led process. The implementation exists to test these decisions.
When an experiment proves one wrong, we change this document before adding more
wiring.

```mermaid
flowchart LR
    Desktop[Desktop] --> Client[Honk client]
    Web[Web] --> Client
    Mobile[Mobile] --> Client
    Client --> Host[Honk Core host]
    Host --> Harness[Pi AgentHarness per session]
    Harness --> PiStore[(Pi session storage)]
    Harness --> Tools[Constructed Honk tools]
    Tools --> Services[Files, Git, MCP]
```

## Pi source target

Honk targets Pi 0.83.0. Its matching protocol source is pinned at
[`f0deb8dd8e9611e89b5bc4145ca92c03ae6ed4ee`](https://github.com/earendil-works/pi/commit/f0deb8dd8e9611e89b5bc4145ca92c03ae6ed4ee),
the ref recorded by `@honk/pi-protocol`. That version is the atomic contract
for `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and the protocol
fingerprint.

The core consumes package output built from that revision. `pi-agent-core` and
`pi-ai` are one atomic dependency and must come from the same revision. A Pi
upgrade is a reviewed core change.

Honk Core does not depend on `@earendil-works/pi-coding-agent` or
`@earendil-works/pi-tui`. Honk owns its host and clients.

# Part I: the boundary

## 1. What Honk Core is

Honk Core is the long-lived host for Pi harnesses and application services. It owns
process lifetime, session acquisition, the single-writer lease, resilient
session reads, and access to host capabilities.

The core does not replace `AgentHarness`. Pi already owns:

- session persistence and context construction;
- prompt, steering, follow-up, abort, compaction, and tree navigation;
- operation locking and safe points between model turns;
- models, thinking levels, tools, resources, and stream options;
- hooks, events, and public harness mutation semantics.

Honk should pass these through. A second session schema or rewritten event
catalog would create two definitions of the same run.

## 2. What belongs in the first build

The first build includes:

1. Session creation, acquisition, execution, and restoration through Pi.
2. A fixed tool set constructed through Pi's public `AgentHarness` API.
3. Resilient session reloads plus live events for desktop, web, and mobile.
4. Pi models and credential resolution without a core allowlist.
5. Battery-included Files, Git, MCP, and Honk tools.
6. One bearer-authenticated HTTP host used by the desktop renderer and paired
   mobile clients, with an exact Honk/Pi protocol fingerprint.

Worktrees can wait until these pieces work together. Pairing and Tailscale are
host access concerns, not commands in the `HonkCore` domain catalog. They live
beside the Node host and grant access to the same client API; they do not add a
second session or transport model.

Claude subscriptions ride the existing Pi `anthropic` provider over OAuth;
the design lives in
[Honk built-ins](./honk-built-ins.md#3-claude-subscription-auth). The Claude
Agent SDK stays out: its public query API owns an agent loop and a separate
Claude transcript, so registering it as a Pi model provider would break the
session boundary.

## 3. What does not belong here

- Account management, subscription state, usage plans, or billing policy.
- A curated list of models chosen by the core.
- Pairing behavior or a remote-access product design.
- A second transcript, message, tool-call, or session-tree model.
- A durable copy of Pi's live event stream.
- Per-tool allow, ask, deny, or permission modes.

The frontend may ship a small, polished default model list. Settings may add
any model supported by the configured Pi providers. The core accepts the model
selected through Pi's model types and does not judge whether it belongs in the
default interface.

# Part II: the shape

## 4. What `AgentHarness` is

Pi has a persisted `Session` and a live `AgentHarness`.

The Pi session stores entries, branches, model changes, thinking-level changes,
and active-tool changes. `AgentHarness` is the in-memory object that operates on
that session. The host calls `prompt()`, `steer()`, `followUp()`, `abort()`, and
the other Pi operations on it.

The host keeps the Pi session and its harness together while that session is
open. This is private runtime state. Desktop, web, and mobile only see
`sdk.session`; they never receive or serialize an `AgentHarness`.

Live notifications remain Pi `AgentHarnessEvent` values. Honk adds the session
ID needed to route an event, but does not rename fields or create another event
union.

### Pi types and boundary schemas

Desktop, web, and mobile use Pi's exported TypeScript types directly. Honk does
not declare matching message, entry, model, tool, harness-event, or hook types.

At the target revision, Pi does not yet export complete runtime schemas for
session entries and harness events. Honk therefore has one deliberately
homogeneous Core protocol: a paired client must authenticate and match both the
Honk wire revision and exact Pi pin before any RPC client is constructed. The
paired client trusts that host, and opaque nested Pi values pass unchanged;
there is no version conversion, compatibility fallback, or best-effort decode.
Honk-owned inputs, result wrappers, and errors still use runtime schemas.

A future protocol that permits version skew or an untrusted server must use
Pi's protocol projections and runtime schemas. We consume those from Pi; we do
not create Honk-owned mirrors that can drift.

The public API does not expose a generic transport envelope. A client calls a
typed SDK method and receives a concrete result:

```ts
await sdk.session.prompt({ sessionId, text: "Explain this repository" });

const state = await sdk.session.reload({ sessionId });
render(state.entries);
```

Request IDs, response correlation, and wire framing belong to the transport
implementation. Once a Pi value crosses that transport, it must use its Pi
schema. A missing upstream schema is a blocker for that remote command, not
permission to invent a Honk equivalent.

Client and host negotiate compatible Honk and Pi protocol versions before
exchanging payloads. A mismatch fails the connection instead of attempting a
best-effort conversion.

## 5. Workspace trust is the only permission gate

Honk asks one question before opening a workspace: **Do you trust this
workspace?**

An untrusted workspace is not a restricted session. It is unopened. Honk must
not load its MCP configuration, skills, prompts, instructions, or tools. It may
resolve the canonical path and return the small amount of
metadata needed to show the trust prompt.

Once trusted, the workspace is allow-all. Pi, tools, and MCP servers may use
every host capability exposed to them. There is no second
permission system and no approval callback around individual tool calls.

The proposed client flow is deliberately explicit:

```ts
const opened = await sdk.workspace.open({ directory });

if (opened.type === "trust_required") {
  const accepted = await showWorkspaceTrustPrompt(opened.directory);
  if (!accepted) return;

  await sdk.workspace.trust({ directory: opened.directory });
}

const workspace = await sdk.workspace.open({ directory });
```

`workspace.open()` must check stored trust before it reads workspace-controlled
configuration or creates a harness. `workspace.trust()` is the only approval
API in version zero.

## 6. Construction

Honk Core is battery included. Starting it creates Pi session storage, the Pi
model collection, Honk's Pi `CredentialStore`, file and shell execution, Git,
MCP, Honk tools, and the client transport.

Application code should look like this:

```ts
import { createHonkCore } from "@honk/core";

const core = await createHonkCore({
  dataDirectory: honkDataDirectory,
});

const sdk = core.client(); // one in-process client connected to this core
const workspace = await sdk.workspace.open({ directory });
if (workspace.type !== "ready") return;

const session = await sdk.session.create({
  workspaceId: workspace.id,
  model: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
});

await sdk.mcp.connect({ workspaceId: workspace.id, server: "github" });
await sdk.session.prompt({
  sessionId: session.id,
  text: "Explain the current auth flow",
});
```

`sdk.session`, `sdk.models`, `sdk.files`, `sdk.git`, and `sdk.mcp` always exist.
The caller does not import factories or assemble an extension list to make Honk
work.

This example has one core and one client. `core.client()` creates a client
connected to the existing core through an in-process transport. It does not
start another core or acquire another writer lease.

Inside `createHonkCore()`, Honk uses APIs present at the pinned Pi source
revision. This is the production shape, with names shortened only where Honk
still needs to implement the surrounding store and tool construction:

```ts
import { AgentHarness, JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const storage = new NodeExecutionEnv({ cwd: dataDirectory });
const repo = new JsonlSessionRepo({ fs: storage, sessionsRoot: "sessions" });

const models = builtinModels({ credentials });
const model = models.getModel(providerId, modelId);
if (!model) throw new Error(`Unknown Pi model: ${providerId}/${modelId}`);

const session = await repo.create({ cwd: workspaceDirectory });
const workspaceEnv = new NodeExecutionEnv({ cwd: workspaceDirectory });

const harness = new AgentHarness({
  session,
  models,
  model,
  tools: builtInTools,
  toolContext: () => ({ env: workspaceEnv }),
  resources,
  systemPrompt,
});
```

The core owns the repository for its entire lifetime and restores sessions
lazily: the first command naming a stored session reopens it, gated by the
same trust store that gated its creation. Alongside the `sessions/` tree the
data directory holds `workspaces.json` — trust decisions with their stable
ids — `auth.json` — the Pi `CredentialStore`, one credential per provider —
and the writer lease, a heartbeat file whose freshness is the liveness
signal: a clean shutdown removes it, a crash lets it expire. Tests may use
Pi's in-memory repository; production stays on JSONL until the SQLite store
described by Pi is ready for this path.

`builtinModels({ credentials })` registers Pi's provider collection without a
Honk allowlist. Honk may add providers with `models.setProvider()`. The harness
receives the exact model returned by `models.getModel()`. Credentials belong to
the Pi `Models` collection; they are not a harness callback.

The SDK maps its object-shaped commands to Pi's actual methods. For example,
`sdk.session.prompt({ sessionId, text })` calls `harness.prompt(text)`, and an
authoritative reload reads `session.getEntries()` without calling the harness.

At the target revision, `new AgentHarness(...)`, `harness.subscribe(...)`,
`harness.abort()`, `harness.waitForIdle()`, and `Session` reads are implemented.
`AgentHarness.create()`, atomic snapshots, lanes, replay, and `watch()` appear
in `harness-v2.md` but are not implemented APIs. Honk follows that direction
without writing code against methods that do not exist.

### The client SDK

Desktop, web, and mobile use the same method shape over different transports:

```ts
const sdk = await createHonkClient({ url, bearerToken });

const session = await sdk.session.create({
  workspaceId,
  model: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
});

await sdk.session.prompt({
  sessionId: session.id,
  text: "Explain the current auth flow",
});
const state = await sdk.session.reload({ sessionId: session.id });

render(state.entries); // Pi SessionTreeEntry[]
```

There is one core host for a data directory and one client for each interface:

```text
one Honk Core host
├── desktop renderer over authenticated loopback HTTP
└── mobile client over Tailscale Serve to the same HTTP listener
```

`core.client()` is the in-process form used by host code and tests. A renderer
or mobile app creates its own `HonkClient` from a host URL and bearer. All
clients call the same SDK methods and reach the same core.

The core owns sessions, harnesses, storage, services, and the writer lease. A
client owns its connection, subscriptions, and disposable reload buffer.
Closing a client detaches that interface. It does not close the core or stop an
active run.

The listener authenticates every RPC and handshake. The host mints a per-boot
owner bearer for desktop preload and stores it in a `0600` discovery file.
Pairing exchanges a one-use, ten-minute fragment secret for a durable device
bearer; only its hash is stored in the `0600` access registry. Revocation
interrupts existing streams as well as rejecting new requests. A bare local
port is an open door: any process on the machine could otherwise drive sessions
with full workspace write access. The in-process client needs no secret; it
never crosses a boundary.

The host does not expose `AgentHarness` over the wire as a serialized object.
It exposes commands that call the real harness and returns Pi values. An
in-process extension receives the actual harness instance.

Provider-specific integrations do not belong in the core contract. The one
exception, Claude subscription auth on the `anthropic` provider, is documented
in [Honk built-ins](./honk-built-ins.md#3-claude-subscription-auth).

### A client is ready or it does not exist

Construction has no half-ready state:

```ts
const core = await createHonkCore({ dataDirectory });
const local = core.client();

const remote = await createHonkClient({ url, bearerToken });
```

`createHonkCore()` resolves after it owns the lease and its host-scoped stores,
models, credentials, and built-ins are usable. It rejects if any required part
cannot start. `core.client()` is synchronous because the core is already ready;
it creates another in-process client, not another core.

`createHonkClient()` is asynchronous because a remote client must connect and
negotiate the Honk and Pi protocol versions. It returns a usable client or
rejects. There is no public `init()`, `ready` promise, `isReady` flag, or
nullable namespace.

Workspace-scoped services still open lazily after workspace trust. Their SDK
namespaces exist from construction; opening a workspace makes that workspace's
instances usable.

### One call has one outcome

A synchronous SDK function returns its value or throws. An asynchronous SDK
function fulfills with its value or rejects. Callers never inspect a bag such
as `{ data?, error? }` to discover whether a call worked.

The owner of an operation owns its errors. Pi session and harness operations
keep Pi's exported `SessionError` and `AgentHarnessError` classes, codes, and
messages. Honk does not catch them and translate them into lookalike errors.
The Honk SDK re-exports those Pi classes so applications can narrow errors from
one import without importing `AgentHarness`.

Honk defines `HonkError` only for failures Honk owns. Its codes, canonical
messages, and details schemas live in one catalog:

```ts
// Pseudocode. The catalog derives the error union and its wire schema.
const honkErrors = defineErrors({
  "core.lease_conflict": {
    message: "Another Honk Core already owns this data directory.",
    details: leaseConflictDetails,
  },
  "transport.outcome_unknown": {
    message: "Honk could not confirm whether the operation completed.",
    details: outcomeUnknownDetails,
  },
  "protocol.version_mismatch": {
    message: "The client and host protocol versions do not match.",
    details: protocolVersionDetails,
  },
});

type HonkErrorData = InferErrors<typeof honkErrors>;

declare class HonkError extends Error {
  readonly data: HonkErrorData;
}
```

The catalog is closed at compile time. A throw site selects a catalog entry and
provides details that pass that entry's schema. It cannot invent a code, change
the message, omit required details, or attach details belonging to another
error.

Remote transports send Honk's `code`, `operation`, and typed details. The
client validates them and reconstructs the canonical message from its
negotiated SDK catalog. Local and remote callers therefore receive the same
`HonkError`.

The target revision exports the Pi error classes and code unions but not their
wire schemas. A remote session command waits for those schemas to land upstream
in Pi. Honk will then reconstruct the same Pi error class on the client. It
will not flatten a Pi error into `HonkError` or serialize an arbitrary `cause`.

Code branches on `error.data.code`, never on `message`. Switching on the code
also narrows the details type:

```ts
try {
  await sdk.session.reload({ sessionId });
} catch (error: unknown) {
  if (error instanceof SessionError && error.code === "not_found") {
    forgetSession(sessionId);
    return;
  }

  if (error instanceof HonkError && error.data.code === "transport.outcome_unknown") {
    reconnectAndReload();
    return;
  }

  throw error;
}
```

Honk's canonical messages are known, reviewed, and tested. Pi messages come
from the exact pinned Pi revision. Contract tests record any Pi message on
which Honk relies, and a Pi upgrade must review those assertions. Clients do
not parse either kind of message. They branch on the typed code and may map it
to product copy and localization.

Expected product states are not failures. `workspace.open()` may return
`{ type: "trust_required", ... }`; model status may return
`{ type: "login_required", ... }`; a list may be empty. By contrast, `get()`
returns the requested value or rejects with the owning domain's typed
not-found code. We add a nullable `find()` only when absence is the normal
answer to that exact operation.

Every method defines when success is true. `mcp.connect()` resolves only after
the server is connected. `session.reload()` resolves with an authoritative
read. `session.prompt()` follows Pi's prompt settlement point instead of
returning an invented Honk acknowledgement.

The client may retry declared reads after a transport interruption. It never
automatically retries a mutation. If the transport loses a mutation response
and cannot know whether the host committed it, the call rejects with
`transport.outcome_unknown`; the client reloads authoritative state before
deciding what to do next.

### Namespaces group calls; they do not hide execution

Honk does not begin with a general fluent API. Each operation takes one object
argument so the SDK can add optional fields without positional overloads:

```ts
const session = await sdk.session.create({ workspaceId, model });

await sdk.session.prompt({
  sessionId: session.id,
  text: "Find the reload bug",
});

await sdk.mcp.connect({ workspaceId, server: "github" });
```

The returned `session` is data, not a client-bound object with hidden methods.
It can live in application state, cross a worker boundary, and be rendered by
desktop, web, or mobile. The one client for that interface remains explicit.

A builder is justified only when several synchronous calls accumulate one
atomic request. If Honk later needs one, intermediate methods validate and
return the builder, exactly one terminal method performs I/O, and the builder
is single-use. No version-zero operation needs that abstraction yet.

### Derive the SDK with Effect v4

Honk uses Effect v4 RPC definitions as its command catalog. The RPC group
derives the raw client, handler requirements, encoded protocol, and typed error
channel. We do not run a separate SDK generator or commit generated client
files.

Core uses the repository's exact Effect v4 catalog pin. Because RPC lives under
`effect/unstable/rpc`, an Effect upgrade must pass the SDK contract tests before
the pin changes.

```ts
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

const SessionReload = Rpc.make("session.reload", {
  payload: { sessionId: SessionId },
  // These Pi-owned schemas are upstream prerequisites for remote reload.
  success: SessionReloadOutput,
  error: Schema.Union([PiSessionErrorSchema, HonkErrorSchema]),
});

class HonkRpcs extends RpcGroup.make(SessionReload) {}

const handlers = HonkRpcs.toLayer({
  "session.reload": ({ sessionId }) => sessionService.reload(sessionId),
});
```

Effect stays inside the host and transport packages. Pi remains the agent core.
The host wraps Pi promises and callbacks at the service boundary. The public
client exposes `Promise` methods and typed error classes:

```ts
const sdk = {
  session: {
    reload: (input: SessionReloadInput) => runtime.runPromise(rpcClient["session.reload"](input)),
  },
};
```

The namespace facade repeats no payload, result, or error definitions. Its
method types derive from the RPC client. A contract test checks that every RPC
appears in exactly one public namespace. In-process clients use the same RPC
group without serialization; remote clients use an Effect RPC protocol
adapter for their transport.

Honk owns schemas for Honk command inputs, Honk result wrappers, and
`HonkError`. Pi owns the nested Pi values. `SessionReloadOutput`, for example,
adds the transient run phase around Pi session entries, but the entry schema
must come from Pi and the phase vocabulary is Pi's (section 9).

Pi 0.83.0 exports no runtime schema for `SessionTreeEntry` from
`pi-agent-core`, and Pi's own remote clients never receive raw entries. Pi's
answer to remote rendering is `@earendil-works/pi-protocol`: runtime TypeBox
schemas for `SessionSnapshot` (authoritative read with phase, revision, and
transcript), `TranscriptItem`, and `TranscriptProgress` deltas, produced by
Pi-owned projections in `pi-server` (`toProtocolUserMessage`,
`toProtocolAssistantMessage`, `toProtocolToolResultMessage`). Snapshots remain
authoritative and deltas are advisory, which is the same read model as section 9. Neither package is published to npm at 0.83.0; `pi-agent-core` and `pi-ai`
are.

For a version-skewed or untrusted-server protocol, Honk adopts those Pi
protocol schemas and projections. Honk does not write its own projection.
Until the packages are published, `packages/pi-protocol` fetches Pi's schema
source from a pinned upstream ref and applies Honk's deterministic repository
formatter. A generated/formatter-only diff has no schema translation, and the
package dissolves into a dependency swap when Pi publishes. A converted or
hand-written Honk schema remains forbidden. The current paired protocol is deliberately
different: it refuses version skew and treats the authenticated host as
trusted, so its nested Pi values remain Pi's exact pinned values.

A transport parses each untrusted value once at its boundary. Trusted code
receives the parsed type; it does not cast or validate the same value again.
Host and client must not hand-write matching interfaces.

## 7. Battery included, constructed through Pi

Files, Git, MCP, models, credentials, sessions, and Honk tools are core
features. Their public home is the SDK. Core chooses the exact tool list when it
constructs each Pi harness. It does not load workspace Pi extensions or mutate
the harness tool list dynamically. MCP contributes one static proxy whose
manager may change behind it
([built-ins section 8](./honk-built-ins.md#8-mcp-one-proxy-tool-over-standard-config)).

### A turn captures a checkpoint; tools gate attribution

Every settled turn captures a whole-workspace checkpoint: a hidden parentless
commit under `refs/honk/checkpoints/<sessionId>/<entryId>`, written through a
scratch index so the user's index, `HEAD`, branches, and log never move. The
git object store is the only storage, and the ref name is the entire
bookkeeping — no second transcript, no Honk database. OpenCode's message
snapshots, t3 code's checkpoints, and Cursor's checkpoints all converge on
this mechanism.

The diff between consecutive checkpoints is the truth about _content_: it sees
what a shell redirect wrote, what a build step generated, and what an MCP
server changed — everything an argument-reading fold structurally cannot.
What a snapshot cannot say is _whose_ write it was, so the turn's own tool
calls gate the diff:

- A tool that cannot write (`read`) never affects attribution.
- A tool that writes exactly the paths its arguments name (`write`, `edit`)
  declares them, and a turn that used only declaring tools claims only the
  paths it named. This is what keeps a sibling session's edits — two sessions
  can share one directory — and the user's own hand edits out of a turn's
  receipt. Declared paths arrive relative or absolute and are aligned
  lexically with the workspace-relative form git reports; a path the gate
  cannot place inside the workspace — it escapes the directory, or reaches it
  through a symlink — makes the turn opaque rather than dropping the write.
- A tool whose writes are not derivable from its arguments (`bash`, MCP, or an
  unknown tool) is opaque, and an opaque turn claims the whole diff. The
  gate errs open: over-claiming a path is a visible, correctable mistake,
  while dropping one is an invisible lie.

Three consequences we accept:

- The receipt is advisory for the transcript, never authoritative for the
  working tree. `sdk.git` owns what is actually on disk.
- A workspace without a git repository has no checkpoints, so `changes`
  honestly reports nothing rather than guessing from arguments.
- Attribution is by time window. A hand edit made during an opaque turn lands
  in that turn's receipt; worktree isolation, when it arrives, is the real
  fix, and every shipped checkpoint product accepts the same limit today.

Honk-owned values need schemas at the remote boundary. Pi values reuse Pi's
schema when one exists; a missing upstream schema is a blocker, not permission
to translate Pi events or messages into Honk equivalents.

The `sdk.*` shape lives in [Honk built-ins](./honk-built-ins.md). Keep that
document and this core boundary in sync while the code takes shape.

## 8. The loop

Pi owns the detailed loop. Honk only hosts it:

```text
host opens core and acquires the writer lease
client asks to open a workspace
    -> core checks the one workspace-trust gate
    -> if untrusted, stop before loading workspace-controlled code
    -> if trusted, continue with allow-all host capabilities

core restores Pi sessions
core constructs each harness with its exact battery-included tool shape

interface sends a command
    -> core finds the harness
    -> core calls the matching public AgentHarness method
    -> AgentHarness runs and persists the operation

for each AgentHarness event
    -> core publishes it to every attached interface

interface reloads or reconnects
    -> client asks core to reload the Pi session
    -> core reads the session without changing the run
    -> client replaces its local messages and renders them
    -> live event delivery continues
```

Modes, prompts, tools, and resources configure the harness. They do not fork
the loop.

Run control preserves the user's whole message: `abort` returns the queued
text and images Pi cleared (`AbortResult`), so the composer can restore them —
stopping never destroys user input. Sent-message editing uses Pi's public tree
navigation and prompt APIs to create a sibling branch. Authoritative reads
therefore follow the **active branch** (`getBranch()`), never the whole tree,
and every linear walk — turn grammar, workspace trail, model record, per-turn
change pairing — walks that path. The reload cursor remains the append-log
position rather than active-branch length. Checkpoints are entry-id-keyed and
branch-agnostic. The complete composer and edit contract lives in
spec/conversation.md sections 6–9.

## 9. Reload and live events

The Pi session is the durable truth. Events are temporary notifications that
let an attached interface update without reloading after every change.

```text
interface attaches
    -> start listening for live AgentHarness events
    -> reload the authoritative Pi session
    -> render its messages
    -> apply events that arrived during the read
    -> continue with live events

interface misses an event or reconnects
    -> reload the Pi session again
    -> replace disposable client state
    -> continue with live events
```

`session.reload()` must be an idempotent read. It must work while a harness is
idle or running, and it must not depend on which clients are attached. It
returns committed Pi session data plus enough harness status for the client to
show whether work is active.

```ts
const state = await sdk.session.reload({ sessionId });

render(state.entries); // Pi session entries, rendered by this client
```

Calling `reload()` does not acquire the session, restart the harness, or change
its lifetime. It is safe for three clients to call it independently.

Reload returns committed session data only. It does not persist or reconstruct
partial token updates. If the harness is still running, the client renders the
committed transcript and Honk's existing `Planning next moves` status. The
complete assistant message appears when Pi commits it.

### Run phase: Pi's vocabulary, one fold

Two rules govern how the host answers "is this session working":

1. **The vocabulary is Pi's.** Every phase a command reports is Pi's
   `AgentHarnessPhase` — `idle`, `turn`, `compaction`, `branch_summary`,
   `retry` — the same union `pi-protocol`'s `SessionPhase` mirrors so
   "adapters do not need a second phase vocabulary". Honk never invents a
   status union of its own; core checks its literals against Pi's exported
   type in both directions, so a Pi upgrade that changes the vocabulary
   breaks the core build, not a client at runtime.

2. **One phase source per open session.** Pi keeps `AgentHarness.phase`
   private, and Pi's own server boundary (`PiSessionRuntime.getPhase` in
   `pi-server`) assigns phase tracking to the host.
   Core folds harness events into a single subscribable ref per open session —
   `agent_start` enters `turn`; `settled`, not `agent_end`, returns to
   `idle`, because pending session writes flush before `settled`, so an idle
   phase means the transcript is durable. Every read — `session.reload`,
   `session.list`, and each frame of the `session.watchInventory` stream —
   consumes that one ref. Nothing folds twice, and no command asks the
   harness.

A session without an open harness is `idle` by construction: this host holds
the writer lease, so nothing else can be running it. Compaction and
branch-summary phases join the fold when core exposes the commands that can
enter them; at the pinned revision Pi never enters `retry`.

The client library handles the read-to-live handoff with a small in-memory
buffer. It starts listening, waits for the live head, performs one full read,
then requests only committed tails through Pi's public `afterEntrySeq` cursor.
The buffer appends those tails for rendering. It is disposable client state,
not a second transcript.

One Pi session owns the entries. Honk does not reconcile another transcript.

The inventory also projects Pi's persisted session name. On the first accepted
top-level prompt, Core writes an immediate prompt-derived fallback, asks the
session's selected model for a concise title in the background, and replaces
the fallback after the harness is idle. Both writes are Pi `session_info` tree
entries, so the title survives host and client restarts without a second title
store. A failed title request never fails or delays the conversation. Older
titleless transcripts recover a display title from their first user message.

## 10. Lease and lifetime

The host that opens the core owns the writer lease. Interfaces do not compete
for it.

```text
desktop or CLI host starts
    -> open core
    -> acquire one lease for the data directory
    -> accept desktop, web, and mobile interfaces

renderer reloads or network disconnects
    -> core and harnesses keep running
    -> interface reconnects and reloads the Pi session

host closes all managed interfaces and shuts down
    -> stop accepting commands
    -> settle or abort active operations by explicit shutdown policy
    -> close harnesses and host services
    -> release the writer lease
```

A browser refresh or lost phone connection never releases the lease. Only the
host lifecycle can close the core.

At the target revision, `await harness.abort()` clears pending queues, aborts
active work, and waits for the harness to become idle. Honk uses that abort
policy for host shutdown. After every live harness has settled, the owning
Effect layers close workspace resources and release the writer lease.

## 11. Models and credentials

The core does not maintain a Honk model allowlist. It passes Pi `Model` values
to the harness and exposes the provider model registry to settings.

The frontend owns presentation policy:

- ship a small default list that feels deliberate;
- show those defaults without setup work;
- let settings add models available through Pi providers;
- store the exact selected Pi model on the session.

The core manages credential access only so Pi can call a provider. For
credential-bearing providers, Honk implements Pi's `CredentialStore` and Pi's
`Models` runtime owns login, request-time resolution, and serialized OAuth
refresh. A provider registered through Pi's public model collection may use
ambient authentication owned by its external runtime; Honk does not copy that
credential.

The core does not calculate billing, label account plans, choose a cheaper
route, or silently move a session between credentials. Provider APIs remain the
source of usage and billing behavior.

The Pi `anthropic` provider is the explicit Messages API route for both API
keys and Claude subscription OAuth
([Honk built-ins](./honk-built-ins.md#3-claude-subscription-auth)). The
subscription path uses Anthropic's official authentication and never falls
back to API credentials; the Claude Agent SDK stays out because its query API
cannot preserve Pi's loop and sole durable session.

Pi's two OpenAI routes stay distinct. `openai` uses a Platform API key at
`api.openai.com`; `openai-codex` uses ChatGPT Plus/Pro OAuth at the Codex
backend. Honk's OpenAI account row and its pinned Sol, Luna, and GPT built-ins
use `openai-codex`. Core never copies or interprets one route's credential as
the other's. An explicit model choice on an unconfigured provider fails typed
before a session transcript is created.

## 12. Files, Git, and MCP

These are battery-included SDK namespaces. Core passes their tools and context
through Pi's public harness constructor.

- Files supply Pi's `ExecutionEnv` and built-in read, write, and edit tools.
  A ranked `files.find` for client jump-to-file surfaces stages in when a
  surface needs it; list, read, and write ship first.
- Git exposes typed read and mutation methods to SDK clients and session actions.
- MCP manages server definitions, process lifetime, OAuth interactions when a
  server requires them, and its tool registry.
- Honk tools use the same harness tool registry as built-in and MCP tools.

Each feature owns its domain types. It should reuse Pi types wherever Pi already
defines the value. It should not force unrelated Git or file values into the
agent session schema.

Agent-driven Git actions are session commands, not Git namespace methods.
`session.runGitAction` refuses a busy session first (Pi buffers a running
turn's user message until settlement, so a mid-run marker would pair with
the wrong turn), then appends a `honk.git_action` custom entry naming the
action and prompts the harness with core-owned canonical instructions in the
same handler — marker before prompt, so a failed model request leaves a
marker with no turn, which is the failure state and needs no cleanup.
Judgment work (commit
messages, branch names, choosing paths) goes through the agent; the Git
namespace grows typed mutations only for mechanical, fully parameterized
operations. The marker's data stays minimal — the action id and an optional
explicit path scope — never a change list that duplicates `session.changes`.
Plain `custom` entries stay out of model context, so the instruction text
rides the prompt's own user message: model context and stored transcript
stay identical by construction.

# Part III: proof

## 13. Invariants

The first implementation must prove:

1. One core host holds one writer lease for a data directory.
2. Every session operation runs through its real `AgentHarness`.
3. Reloading a session never executes work or changes the session.
4. A missed event is repaired by the next authoritative session reload.
5. Reloading any interface does not stop a run or create another harness.
6. Untrusted workspaces execute no workspace-controlled code.
7. Trusted workspaces have no per-action permission path.
8. Construction never returns a client or core that still needs initialization.
9. Local and remote clients expose the same values and preserve the owning Pi
   or Honk error class, code, and message.
10. The client never retries a mutation whose outcome may already be committed.

Every Pi payload that crosses a version boundary or comes from an untrusted
server must pass a Pi-owned runtime schema. No mirrored Honk schema is allowed.
The current desktop and mobile protocol is homogeneous: bearer authentication,
TLS on the Tailscale hop, and an exact Honk/Pi fingerprint make the paired host
the trusted endpoint and reject skew before RPC construction. It carries Pi
values typed by Pi's exported TypeScript types without translating them. A Pi
pin or wire-shape change must bump the protocol fingerprint. The expected
source for a future heterogeneous protocol is `@earendil-works/pi-protocol`
with the `pi-server` projections, which exist at Pi 0.83.0 but are not yet on
npm.

Extensions add their own invariants. MCP must not duplicate tools after a
reload. Git must resolve paths inside the session workspace. File tools must use
the host `ExecutionEnv`.

## 14. TypeScript floor

The repository already enables `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and `noImplicitOverride`. The new core and client
packages add these options from their first file:

```json
{
  "compilerOptions": {
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

Those packages also permit no `any`, no non-null assertions, and no type
assertions outside a validation or branded-value constructor, except the three
centralized opaque Pi codecs governed by section 13's exact-version trusted-host
rule. Other boundary data begins as `unknown` and becomes trusted through its
owning schema.

Do not enable `noPropertyAccessFromIndexSignature` repo-wide. A compiler probe
shows that it mostly makes validated record access noisy without finding a
new boundary. Runtime schemas, `unknown`, and `noUncheckedIndexedAccess` cover
the useful risk more directly.

## 15. First experiments

Build these in order:

1. One harness, one fake model, one prompt, and one session reload.
2. Disconnect and reconnect three clients while the prompt is running.
3. Deliver a live event during reload and prove the handoff does not lose it.
4. Drive one workspace-bound session end to end from the desktop renderer
   through the RPC host: trust, create, prompt, queue, steer, abort, live
   events, and a reloaded transcript on screen.
   Core exists to be consumed; this experiment proves the consumption path
   before more product surfaces widen the contract.
5. Pair a phone through Tailscale, dispatch work, reconnect with the durable
   bearer, then revoke it while an event stream is open.
6. Restore after a host restart, then add files, Git, and one MCP server.

Use Pi's faux provider for deterministic loop tests. Each experiment should end
as an invariant test. Delete temporary code that does not belong in the final
path.

## 16. Hard edges still to settle

### Retried creates over a lossy transport

A create whose acknowledgment is lost leaves the caller unable to tell "never
happened" from "happened, ack dropped"; a blind retry mints a sibling session.
The settled remedy is a client-minted creation key that makes the retry land
on the same session. The current remote client never automatically retries a
mutation: it reloads inventory after an ambiguous failure. Add creation keys
before adding automatic mutation retries, not as an unused parameter now.
