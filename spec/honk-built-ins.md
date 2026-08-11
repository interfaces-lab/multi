# Honk built-ins

> **Status:** Working draft. Update this beside [Honk Core](./core.md).
>
> Honk Core starts useful. Applications do not install Files, Git, MCP, models,
> sessions, or Honk tools before they can use it.

## Read this first

1. Built-ins always ship with Honk Core.
2. Their public methods live under `sdk.*`.
3. Core constructs Pi sessions and tools directly through Pi's public API.
4. They open only after the workspace trust check.
5. Desktop layout extensions remain client code. They are not core built-ins.

This document defines the built-ins and their SDK namespaces. Keep it aligned
with [Honk Core](./core.md).

# Part I: names and boundaries

## 1. What a built-in is

A built-in is code that Honk registers when the host starts. The user does not
select it from a plugin list. Every client can rely on its SDK namespace and
types.

Core may include a tool when it constructs a session harness. That is an
implementation detail. Public code sees `sdk.mcp`, not an `mcp()` factory and
not a serialized `AgentHarness`.

```ts
const sdk = await createHonkClient({ transport });

await sdk.files.read({ workspaceId, path: "README.md" });
await sdk.git.status({ workspaceId });
await sdk.mcp.connect({ workspaceId, server: "github" });
```

## 2. The two registration boundaries that exist

| Kind              | Runs in        | What it changes                                        | Public API               |
| ----------------- | -------------- | ------------------------------------------------------ | ------------------------ |
| Honk built-in     | Core host      | Static host services and a session's constructed tools | Static `sdk.*` namespace |
| Desktop extension | Desktop client | Layout, settings, panes, tabs, and native behavior     | Desktop contribution SDK |

Core has no dynamic built-in or SDK-extension loader. The desktop client has a
small contribution host, but startup eagerly registers the two definitions
that ship with the application: `honk.vertical-sidebar` and `keep-awake` when
the native bridge supports it. This spec does not promise workspace plugins,
downloaded extensions, or runtime-added SDK namespaces.

# Part II: providers

## 3. Claude subscription auth

> **Decision:** Claude Pro and Max subscriptions run through Pi's built-in
> `anthropic` provider over OAuth. Core adds a login relay and a narrow
> subscription compatibility adapter through Pi's public provider API. Honk
> never edits or patches Pi's installed source. The Claude Agent SDK stays out.

### What Pi already carries

The model runtime (`@earendil-works/pi-ai`) implements the subscription path
natively. Core inherits all of it by building its collection from
`builtinModels`; none of this is Honk code.

- `anthropicOAuth` runs the PKCE flow against Anthropic's official authorize
  and token endpoints with Claude Code's client id, exchanges the code, and
  refreshes tokens. `Models.login("anthropic", "oauth", interaction)` drives
  the flow and persists the credential; `Models` serializes refresh.
- The `anthropic-messages` transport detects an `sk-ant-oat` access token and
  switches the request identity: Bearer auth, `anthropic-beta:
claude-code-20250219, oauth-2025-04-20`, a `claude-cli` user agent, and
  `x-app: cli`.
- On OAuth requests it injects the required first system block, "You are
  Claude Code, Anthropic's official CLI for Claude.", and appends the harness
  system prompt as a second block.
- It renames tools to Claude Code's canonical names on OAuth requests.

### What core adds

**Login relay.** `setCredential` covers API keys only. Subscription auth needs
the interactive flow: a `models.login` RPC runs Pi's `Models.login` and relays
its prompts (open this URL, paste the code) to the client as typed messages,
with the client's answers flowing back. The credential lands in the same store
as API keys, and `list` then reports the provider as configured with
`authType: "oauth"`. Settings owns the UI; the core owns nothing visual.

**Subscription compatibility.** The host composes one `onPayload` transform
through Pi's public `Models.setProvider` seam. For `sk-ant-oat` credentials it
adds the Claude Code billing header and splits assistant text that follows a
`tool_use` block; API-key requests and other providers pass through unchanged.
The adapter delegates both `stream` and `streamSimple` to Pi's canonical
transport. It does not edit `node_modules`, fork Pi, or own an agent loop.

### Why the Claude Agent SDK stays out

The SDK's public `query()` API owns an agent loop and a separate Claude
transcript. Wrapping it in a Pi provider would nest one agent loop inside
another, let Claude execute tools before Pi receives an unexecuted tool call,
and make Claude's session required recovery state. Pi's `AgentHarness` owns
the loop and the only durable transcript, and the OAuth route above reaches
subscription billing without any of that. Honk adds no Agent SDK dependency,
Claude session mapping, or MCP proxy.

### Invariants

1. Official authentication only: Pi's `anthropicOAuth` against Anthropic's
   authorize and token endpoints. No scraped cookies, no borrowed desktop
   auth.
2. No fallback to pay-as-you-go. Pi's auth resolution prefers the stored
   OAuth credential over API-key environment variables, and a failed refresh
   surfaces as a typed `ModelsError` with the credential preserved for
   re-login. Core never silently moves a session between credentials.
3. Subscription eligibility is Anthropic's decision, not a core guarantee.
   Anthropic currently permits this route; if that changes, the failure mode
   is a provider 4xx on the next request, never a corrupted session.

# Part III: SDK

## 4. The first SDK shape

The same client object works in desktop, web, and mobile:

```ts
const sdk = await createHonkClient({ transport });

const opened = await sdk.workspace.open({ directory });
if (opened.type !== "ready") return;

const session = await sdk.session.create({
  workspaceId: opened.id,
  model: { provider: "anthropic", id: "claude-sonnet-4-6" },
});

await sdk.session.prompt({
  sessionId: session.id,
  text: "Find the reload bug",
});
await sdk.mcp.connect({ workspaceId: opened.id, server: "github" });

const state = await sdk.session.reload({ sessionId: session.id });
render(state.entries);
```

No client imports Pi's `AgentHarness`. The SDK returns Pi values where Pi owns
the value, and Honk values where the capability is ours.

## 5. Namespaces needed for the first harness

| Namespace       | Methods                                                                                                                                                                                                                                   | Scope                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `sdk.workspace` | `open`, `trust`                                                                                                                                                                                                                           | Host and canonical directory         |
| `sdk.session`   | `list`, `create`, `get`, `delete`, `reload`, `prompt`, `steer`, `followUp`, `abort`, `runGitAction`, `runSkill`, `runCommand`, `changes`, `setWorkspace`, `setThinkingLevel`, `setModel`, `revert`, `events`, `watchInventory`, `watch`   | One Pi session                       |
| `sdk.models`    | `list`, `setCredential`, `deleteCredential`, `login`, `answerLogin`                                                                                                                                                                       | Host credential and model collection |
| `sdk.files`     | `find`, `list`, `read`, `write`, `delete`, `createDirectory`, `rename`                                                                                                                                                                    | Trusted workspace                    |
| `sdk.git`       | `status`, `diff`, `filePatch`, `fileImage`, `fileContent`, `branches`, `checkout`, `pull`, `discard`, `captureCheckpoint`, `checkpoints`, `checkpointChanges`, `checkpointDiff`, `restoreCheckpoint`, `restoreFiles`, `deleteCheckpoints` | Trusted workspace                    |
| `sdk.mcp`       | `list`, `status`, `add`, `update`, `remove`, `connect`, `disconnect`, `login`, `logout`                                                                                                                                                   | Trusted workspace                    |
| `sdk.skills`    | `list`, `reload`                                                                                                                                                                                                                          | Trusted workspace                    |
| `sdk.commands`  | `list`, `reload`                                                                                                                                                                                                                          | Trusted workspace                    |

Worktree methods do not appear in `sdk.git` yet.

Workspace listing is deliberately absent: `workspace.list` was removed before
implementation, and its slot stays open until the replacement for enumerating
known workspaces is designed.

### Checkpoints: the snapshot primitive under per-turn changes

A checkpoint is a whole-workspace snapshot stored as a hidden parentless
commit under `refs/honk/checkpoints/`, captured through a scratch index so the
user's index, `HEAD`, branches, and log never move. Untracked files are
captured; ignore rules are honored. The git object store is the only storage —
unchanged files share objects between snapshots, and the ref name is the
entire bookkeeping.

Checkpoint names are the caller's convention. The session layer names them
`<sessionId>/<entryId>`, captures one per settled turn, diffs consecutive
checkpoints to answer "what did _this_ turn do" — shell writes included — and
restores one to revert the workspace to that turn. This is the mechanism
behind per-turn changes, proven by OpenCode's message snapshots, t3 code's
checkpoints, and Cursor's checkpoints; a non-git workspace honestly has no
checkpoints rather than a degraded imitation.

Restore has two grains. `restoreCheckpoint` rewrites the whole workspace to a
snapshot, which is what a turn-level revert means. `restoreFiles` takes named
paths back to their snapshot versions and leaves every other path alone —
"this file broke, return it to turn N" without discarding innocent work.
OpenCode's revert restores per file for the same reason; whole-tree restore
is its redo path, not its undo path. A path the snapshot does not hold is
removed, because the honest meaning of restoring it is "this file did not
exist then", and the removal is reported by name.

`fileContent` reads one file's text at the working tree, at `HEAD`, or at a
checkpoint. It is the read behind expand-context on a rendered patch —
Pierre-style hydration fetches both full sides instead of re-requesting
ever-larger context windows — and behind "show me this file as it was at
turn N". Patches answer _what changed_; `fileContent` answers _what was
there_. Binary content is reported as its own state and the bytes stay with
`fileImage`.

### `sdk.session.changes`: what this thread changed, turn by turn

A workspace answers "what changed here". A thread must answer "what did _this
conversation_ change", and those are different questions. Two sessions open on
one directory see each other's edits through `sdk.git.status`, which is the
wrong answer for a transcript, a review surface, or an undo affordance.

`changes` belongs to `sdk.session` because the session is its scope, and it
answers at turn granularity:

```ts
const { turns } = await sdk.session.changes({ sessionId });
// [{ entryId, files: [{ file, status, additions, deletions, ... }] }]
```

Every settled turn captures a workspace checkpoint named
`<sessionId>/<entryId>`, and a turn's changes are the diff between its
checkpoint and the one before it. The snapshot is the truth about content —
shell writes, generated files, and MCP side effects all appear. The turn's own
tool calls are the truth about attribution and gate that diff: a turn that
used only declaring tools claims exactly the paths it named, which keeps a
sibling session's edits and the user's hand edits out of its receipt; a turn
that ran an opaque mutator claims the whole diff, because filtering it would
silently hide real writes. The gate contract lives in
[core.md](./core.md#a-turn-captures-a-checkpoint-tools-gate-attribution).

It adds no durable Honk state. The snapshots live in the workspace's git
object store, the gate is a derivation over the committed transcript, and the
answer is recomputed from both on every read. A workspace without a git
repository has no checkpoints and honestly reports no turns.

`entryId` anchors each receipt to its transcript row and is the handle a
client passes to `sdk.session.revert`. Per-turn patches come from
`sdk.git.checkpointDiff`; `changes` answers _which_ paths per turn, `sdk.git`
answers _what_ changed in them.

`sdk.session.revert({ sessionId, entryId })` restores the workspace to a
turn's checkpoint — `"base"` means the state the session found. The revert is
recorded in the transcript as a custom entry, and a safety checkpoint of the
present is captured under that entry first, so a revert is itself revertible.
The transcript is never rewritten: only the files move.

`sdk.session.setWorkspace({ sessionId, workspaceId })` is `/cd`. Holding a
`WorkspaceId` proves a trust decision, so there is no second gate; the move
takes effect at the next turn, lands in the transcript as a custom entry, and
starts a fresh checkpoint baseline in the new workspace. A turn pair that
spans a `/cd` has no comparable base and is honestly skipped by `changes`.

Where the two disagree, `sdk.git` is authoritative about the working tree and
`changes` is authoritative about the conversation.

## 6. Harness tools and desktop extensions

Core constructs each harness with Pi's `read`, `write`, `edit`, and `bash`
tools. A read-only delegated harness keeps only `read`. Every harness receives
the stateless `websearch` tool. Primary sessions receive the static `mcp` proxy;
they receive `task` only when at least one delegation target resolves. A child
harness receives neither `mcp` nor `task`.

The desktop contribution host is client-only. Startup registers the vertical
sidebar and conditionally registers keep-awake when the native bridge exposes
that operation. It does not scan extension directories and has no matching
`sdk.extensions` namespace.

There is no core terminal namespace, browser namespace, extension namespace,
or global event bus. Prompt-template execution is
`sdk.session.runCommand`; `sdk.commands` only lists and reloads templates.

## 7. Events and reload

Built-ins do not create a second event history. They publish live state changes
and keep durable state in their owning store:

- Pi session changes persist in the Pi session.
- MCP definitions and credentials persist in their workspace or host stores.
- Git status is a live observation, not transcript data.
- Desktop layout state stays in the desktop client.

After reconnect, each namespace reloads its authoritative state. `sdk.session`
uses the read-to-live handoff described in `core.md`.

# Part IV: MCP, web search, and Fusion

## 8. MCP: one proxy tool over standard config

> **Decision:** MCP tools do not join the harness tool registry. The MCP
> built-in registers exactly one static tool, `mcp`, and the dynamic world
> lives behind it. `pi-mcp-adapter` proved this shape on Pi's own coding
> agent; Honk implements the shape in core rather than depending on the
> package, because the adapter is a `pi-coding-agent` extension with a
> `pi-tui` peer — both outside core's allowed dependencies.

The problem with per-tool registration is context: a single MCP server can
put ten thousand tokens of tool definitions into every model turn, paid
whether the tools are used or not. The proxy costs a few hundred tokens and
the model discovers what it needs on demand:

```
mcp({ search: "screenshot" })
mcp({ tool: "chrome_devtools_take_screenshot", args: { format: "png" } })
```

Three consequences follow, and each one deletes complexity:

1. **The harness tool list is fixed at construction.** A primary receives one
   `mcp` proxy. Connecting or disconnecting servers changes the manager behind
   that proxy, never the harness tool list.
2. **Servers are lazy.** A server process starts on the first call that
   needs it, not at workspace open. A metadata cache answers `search` and
   `describe` without a live connection, so a cold workspace pays nothing
   for servers it does not use this session.
3. **Attribution needs no MCP awareness.** The `mcp` tool is opaque to
   `Tools.writesOf`, so a turn that used it claims its whole checkpoint diff
   and its rows never collapse into read groups. The transcript was MCP-ready
   before MCP existed.

### Config

Honk reads the standard files, in precedence order: the user-global
`~/.config/mcp/mcp.json`, then the project's `.mcp.json`. Both are read only
after workspace trust — the project file because it is workspace-controlled
code selection, the global file because MCP opens with the workspace
(section 12). Honk-owned state — a server disabled here, adapter-specific
settings — writes to a Honk override file per workspace. The shared files
are never rewritten and credentials are never copied into them.

### Lifecycle and namespace

One trusted workspace owns one MCP manager: server definitions, process
lifetime with scope-owned teardown, and the metadata cache. `sdk.mcp.list`
and `status` read it; `connect`/`disconnect` override laziness explicitly;
`add`/`update`/`remove` write the Honk override file, and `update` carries
the `disabled` toggle (disabling a connected server disconnects it).
`connect` resolves
only after the server is connected (core.md: every method defines when
success is true). Stdio transports ship first; HTTP transports and the
OAuth pair `login`/`logout` stage in behind them and reject with their
catalog code until then.

Invariants: a reconnect or workspace reopen never duplicates a server
process; killing the workspace kills its servers; an unused server never
starts.

## 9. Subagents and Fusion

> **Decision:** Delegation is one built-in tool, `task`, whose targets come
> from a core-owned subagent catalog. Fusion's sidekick is the catalog's one
> writing member. Pi's loop stays the only loop, and there is no permission
> system — a subagent can only do what its harness was constructed with.

The shape answers four problems at once:

1. **One pen, many readers.** Every preset subagent is read-only by
   contract — review, search, oracle, opus, and librarian all end with "do
   not edit files". Only the primary writes; under Fusion, only the sidekick
   writes, serialized beneath the orchestrator. One author chain per turn is
   what keeps checkpoints, receipts, and the user's review coherent.
2. **Specialization is model routing.** Each preset pins the model its job
   wants — a long-context searcher, a deep reasoner, a frontier second
   opinion, or an external-code researcher. Delegation is how a session uses
   the whole catalog while the composer's picker stays a small deliberate
   list.
3. **A closed surface.** The primary may delegate only to catalog names,
   subagents may not delegate at all, and the tree is bounded at depth one.
   Cost and behavior stay predictable.
4. **Discovery rides the system prompt.** A static task tool cannot
   enumerate its targets, so the primary learns the catalog from its system
   prompt — the same static-surface, dynamic-knowledge pattern as the MCP
   proxy (section 8).

### The catalog

Preset subagents are invocable helpers with pinned arms and role prompts,
never user-selectable models. The first catalog carries five roles: Review,
Search, Oracle, Opus (second opinion), and Librarian. Arms are core `ModelRef`
plus `ThinkingLevel`. A preset whose arm the catalog does not know is absent
from the delegation list rather than present and broken; this rule has an
immediate customer, since Review already pins a model generation nothing else
uses. Current credentials are checked when the preset actually runs, not when
an existing session is restored.

The catalog ships closed, and the seam for opening it is chosen now so it
is not invented under pressure later: `pi-subagents`' override model — a
closed field list per builtin, plus eject-to-editable-copy, disable, and
reset verbs — is the battle-tested answer to "the user wants a different
arm or prompt for a builtin" without forking the catalog. When user
agents arrive, that is the shape they take; the first build adds none of
it.

Fusion adds the sidekick: the one writing subagent, one per fusion
session, persistent. Persistence is not a convenience, it is the
economics — both arms keep their own cached contexts, so a delegation
never re-pays the task's context per call (Devin Fusion is the published
reference for why ad-hoc "ask another model" tools lose exactly here).
Every stop is the same machine — one main, one sidekick — differing only
in which arms fill the seats. The main's posture is the product, and it
is universal across stops: take minimal actions, read only what is
necessary, delegate and monitor by default, and keep the significant
decisions — the plan, the interpretation of ambiguity, the final review —
because delegated judgment is where fusion measurably backfires. A stop
names the orchestrator arm and the sidekick arm:

| Stop   | Main            | Sidekick      |
| ------ | --------------- | ------------- |
| low    | Sol · high      | GLM · medium  |
| medium | Sol · high      | Sol · medium  |
| high   | Fable 5 · high  | Sol · xhigh   |
| ultra  | Fable 5 · xhigh | Sol · xhigh   |
| claw   | Fable 5 · xhigh | Opus 5 · high |

### Capability by construction, not permission

Core has no per-tool permission system (core.md section 5), and subagents
do not reopen that question. A read-only preset's harness is _constructed_
with read-shaped tools only; the sidekick's harness gets the full built-in
set; no subagent's harness gets the `task` tool, which closes recursion.
Permission tables could fence the same shape; tool provisioning is the
difference between a fence and a builder that never installs the door.

The provisioning rules, whole: no
subagent gets the plan tracker — the orchestrator owns the plan — and no
delegated harness may hold any tool that _blocks_ on a human, because an
unattended subagent has nobody to answer. Blocking is the operative word:
a non-blocking escalation channel — the child records a question and keeps
working on its stated assumption — stays permitted by this rule, and
`pi-subagents` shipped exactly that shape. Core satisfies the rule by
construction today (there are no ask tools), but it stays stated so a
future tool cannot violate it silently. A subagent's role prompt is part
of its constructed harness, not a hook that fires per turn — a prompt a
hook appends can be lost the turn the hook does not fire; a constructed
harness cannot lose it.

### Delegation rules

The delegation invariants:

- **Reject teaches; fusion coerces, loudly.** A single-model primary
  delegating to a name outside the catalog fails with an error listing
  the valid targets — the static tool description invites invented names,
  so the error is the documentation. A fusion primary's invented name is
  instead _coerced_ to its paired sidekick: the orchestrator meant
  "delegate this", and the stop already decided to whom. The coercion is
  never silent — the tool result names the substitution — and never
  applies outside fusion. Everywhere else the system prefers explicit
  failure over silent substitution.
- **One delegation in flight per session.** The second concurrent `task`
  call fails. Release is structural — a finalizer around the whole
  delegation — so the child's result, the child erroring, and the session
  erroring all free the lock by construction; the next user message frees
  it explicitly. When minimal background lands, the lock becomes a
  budget, not a wider lock.
- **No reset bypass.** `task` has no reset flag. Replacing a persistent
  sidekick while its old harness remains alive would violate single-flight
  and create two writers. A future replacement operation must first abort
  and settle the old child, then atomically replace its durable link; until
  that lifecycle exists, starting a new parent session is the honest reset.
- **Provisioning is constructive.** An unknown arm is absent from discovery,
  and child creation resolves the exact currently runnable arm before it
  creates a transcript. Read-only presets receive read-shaped tools; the
  sidekick receives the writing set; neither receives `task`.

A delegation's result returns to the parent under a stated budget — the
plugin returned children's answers unbounded (`pi-subagents` defaults to
200 KB inline, roughly fifty thousand tokens of child answer in the
parent's context), and core sets the cap up front instead of discovering
it in a compaction incident. The full answer remains durable in the linked
child's Pi transcript while only the clipped answer enters the parent's
context. A _failed_ delegation always returns inline regardless of budget,
so debugging is never blinded by the cap.

### The mechanism

Pi has no child sessions — the fact that deleted the subagent tray
(conversation.md section 9) — so a subagent is not a child agent;
it is a tool. `task({ subagent_type, prompt })` runs the named arm and
returns its final answer as the tool result; what the primary saw is in the
primary's transcript by construction.

- Today each run drives a second harness in a linked core session: same
  workspace, the subagent's arm and tools, marked as delegation-owned so
  inventory surfaces do not list it as a top-level chat. Preset runs are
  one-shot; the fusion sidekick reuses its linked session for the life of
  the parent. Linked sessions are real Pi sessions — durable, reloadable,
  reviewable — not an invented runtime.
- Pi's v2 harness scaffolds **lanes**: named parallel contexts inside one
  session with per-lane snapshots and operations. Lanes are this design's
  destination — `task` moves onto lanes in the same session, linked
  sessions disappear, and the tool contract does not change. We follow that
  direction now and adopt the API when it is implemented, the same rule
  core.md applies to every harness-v2 feature.

`task` is synchronous in the first build: the delegating turn waits while
the subagent settles, and every stop ships on that footing at once — the
stops are one machine with different arms, and none of them gates on a
capability another lacks. Background — dispatch now, monitor, read the
result explicitly, stop — stages in next, also for every stop at once,
and does not wait for a Pi release: in-process children need none of the
detached-process babysitting that made background expensive elsewhere,
only a durable status row. Steering a running child and restart-surviving
in-flight work wait for lanes, where Pi owns the parallelism and the
persistence.

Attribution needs no subagent awareness: `task` is opaque to
`Tools.writesOf`, so a delegating turn claims its whole checkpoint diff —
which is exactly right, since the sidekick's writes happened inside it.

Rendering shows everything. In the parent transcript a delegation is a
tool row for grammar and grouping — opaque, never collapsed into a read
group — and its expansion is the child session's **full transcript**,
grammar-rendered and live: the child is a real core session with its own
watch, so the surface streams it exactly as it streams the parent, at
every disclosure layer. This holds for every subagent, preset or
sidekick, on every stop. Nothing a subagent does is hidden; linked
sessions stay out of top-level inventory, not out of sight. What returns
to the _model_ is the budgeted result; what is available to the _user_ is
all of it.

### Creation, restore, and the picker

`session.create({ workspaceId, fusion: stop })` is mutually exclusive with
`model` and `thinkingLevel`. It sets the orchestrator arm as the session's
model and level (recorded as Pi's own `model_change` and
`thinking_level_change` entries), appends a `honk.fusion` custom entry
naming the stop, and provisions the sidekick target. Restore reads the last
`honk.fusion` entry to rebuild both arms; a stop whose arms no longer
resolve fails restoration typed rather than silently running something
else. The marker is authoritative, not derivable: two stops can share one
orchestrator arm (low and medium both run Sol · high), so `(model,
thinkingLevel)` cannot recover the stop — a restore test must cover that
pair. Preset delegation needs no marker: it is available in every session
whose catalog resolves, fusion or single-model alike.

Picker rules follow the production selector: Fusion is one row whose
options are the stops; choosing a single model exits fusion, recorded as a
new `honk.fusion` entry with no stop, so the transcript tells the truth
about when orchestration stopped.

## 10. Web search: one keyless tool over hosted search endpoints

**Decision.** Web search is a Honk built-in tool named `websearch`, present on
every harness shape — it writes nothing, so read-only subagents carry it too.
It executes one stateless JSON-RPC `tools/call` POST against a hosted search
MCP endpoint and hands the model the provider's text verbatim. Provider-hosted
search (Anthropic's server-side `web_search`) stays route-owned and out of
scope: the built-in exists so every model on every provider can search, not
only the ones whose API does it for them.

This adopts opencode v2's shipping design (`packages/core/src/tool/websearch.ts`,
MIT) and skips its partnership artifacts. Their docs describe a structured
HTTP websearch API with a provider registry; it does not exist in their
source, and Honk targets the tool that ships, not the API that might.

### The tool

Input: `query`, `numResults` (max 20, default 8), `livecrawl`
(`fallback`/`preferred`), `type` (`auto`/`fast`/`deep`),
`contextMaxCharacters` (max 50 000, default 10 000). The optional fields are
Exa's and Parallel ignores them; they stay because they are the model's only
way to bound result size. Output is `{ provider, text }`: the first non-empty text content item
of the MCP response, or the literal "No search results found. Please try a
different query." The tool description names the current year so models with
stale cutoffs write dated queries correctly.

### Providers

Exa (`https://mcp.exa.ai/mcp`, tool `web_search_exa`) is the keyless default.
Parallel (`https://search.parallel.ai/mcp`, tool `web_search`) runs when
chosen. Selection: `HONK_WEBSEARCH_PROVIDER` overrides; otherwise a provider
with a user key beats a keyless one; otherwise Exa. No per-session A/B split —
opencode's is a partnership artifact, not a design lesson.

One shot per search: 25-second timeout, response body bounded at 256 KiB with
the stream cancelled at the cap, JSON or SSE-framed bodies both parsed. No
retry, no cross-provider fallback, no caching, no result reshaping, no MCP
session handshake.

### Keys and the free tier

Keyless requests ride the providers' own public endpoints; quota is enforced
provider-side and Honk operates no gateway. `EXA_API_KEY` (URL parameter) and
`PARALLEL_API_KEY` (bearer header) raise the ceiling. Env vars only at first;
storing search keys in the host credential store with a settings row can
stage in later. One improvement over opencode, which surfaces every failure
as one generic line: a failed search fails typed with the HTTP status, so a
429 reads as rate limiting and names the remedy — add a key.

### Invariants

- Keys never appear in model-visible output or persisted tool state.
- The tool never writes: `Tools.writesOf` answers none, and no failure mode
  touches the workspace.
- Search failure fails the tool call, never the turn or the session.
- `websearch` discovers; it does not retrieve. A `webfetch` tool for direct
  URL retrieval is a separate later decision.

Sources: opencode v2 `websearch.ts` and `tools.mdx` (MIT); Exa and Parallel
hosted MCP endpoints as exercised by that implementation.

# Part V: internal shape

## 11. One workspace instance, many sessions

MCP shows the lifecycle we need. One trusted workspace owns the MCP manager.
Each primary session receives one proxy tool that resolves that session's
current trusted workspace binding at call time. A delegated child does not.
The SDK namespace and tool both call the same MCP service. There is no
`defineHonkBuiltIn`, `tools.add`, or dynamic harness recomputation layer.

## 12. Built-in lifecycle

```text
core starts
    -> start host-scoped stores and services

workspace becomes trusted
    -> make Files, Git, MCP, skills, and commands available

session opens
    -> construct Pi Session and AgentHarness
    -> choose the exact tool list from the harness shape

session is deleted
    -> abort its harness and release its live resources

core closes
    -> close host services, sessions, MCP servers, and the writer lease
```

An interface disconnect does not run any of these close paths.

# Part VI: decisions we still need

## 13. Hard questions

1. Should Build, Ask, Plan, and Debug be core session modes? With no
   permission system, Plan and Debug would rely on prompt guidance rather than
   blocked tools.
2. Should plan and diagnosis results use Pi custom entries or ordinary tool
   calls whose inputs the clients render?
3. Should the `models.login` relay grammar — typed frames, prompts answered
   by unguessable id, stream end voids pending prompts — become the one shape
   for every interactive request a host relays? opencode v2 ships permissions,
   questions, and forms as three parallel request protocols and admits in-code
   they overlap; one relay grammar reused for model-initiated questions would
   avoid that split. Nothing forces the decision until a feature needs to ask
   the user something mid-turn.
4. What is the writing sidekick's evidence ledger? Checkpoints already tell
   the truth about _content_; the unverified part is the child's claims
   about checks it ran. `pi-subagents`' acceptance gates ("child-reported
   command success does not count" — the runtime re-runs the verify
   command) are the strongest prior art, and some version of it should be
   the sidekick's receipt before fusion is trusted with large work.
