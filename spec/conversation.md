# The conversation surface

How a Honk thread renders an agent turn, carries a user's message, and preserves
the session tree. Pi owns the loop, transcript, queues, and branches. Honk
projects that state into a durable chat interface without another message
model.

Reference: Cursor 3.15.1 (`workbench.glass.main.js`, sha256
`020a4bce8862b87b…`), investigated per
[`docs/cursor-parity-handbook.md`](../docs/cursor-parity-handbook.md).
Behavioral rules are translated, not transplanted. Pi's TUI is the reference
for harness semantics.

## 1. The turn grammar

A Pi assistant turn is an ordered stream of content blocks: text, tool calls,
text, tool calls. Tool results arrive separately, keyed by call id. That order
is the segmentation model; Honk stores nothing beside it:

```text
turn    := planning? segment* summary?
segment := headline (one assistant text block)
           followed by a run of tool calls and their results
```

- **Planning** is the gap between the user's message and the first block. The
  surface shows a “Planning next move” shimmer.
- **A headline** is an assistant text block emitted between tool work. The
  model narrates naturally; Honk does not prompt for it. A segment without a
  preceding text block still renders.
- **The summary** is the turn's final text block. It stays visible after the
  turn collapses.

## 2. Disclosure layers

Every turn renders at one of four layers. The data is unchanged; only the
depth differs:

| Layer | Shows                                            |
| ----- | ------------------------------------------------ |
| L0    | “Worked for 5m 16s” and the ending summary       |
| L1    | Segment headlines and the rolling preview window |
| L2    | Full transcript: every headline and tool row     |
| L3    | One opened tool row: arguments, output, or diff  |

Clicks walk down: L0 header → L1/L2, preview window → L2, tool row → L3.
Collapse walks back up.

## 3. Density is state on two axes

- The app-wide `conversationDensity` preference chooses the default layer per
  phase:

  | Value                           | While running | After settle |
  | ------------------------------- | ------------- | ------------ |
  | `compact-all-grouped` (Compact) | L1            | L0           |
  | `compact-ungrouped` (Balanced)  | L1            | L1           |
  | `detailed` (Detailed)           | L2            | L2           |

- A per-turn override, written by clicking that turn's surfaces, wins for
  that turn only.

Effective layer is `turnOverride ?? densityDefault(phase)`. Even at Detailed,
L3 remains closed until clicked; a preference never opens raw tool output.

The Appearance settings panel and the transcript read the same app-settings
store. Settings is a shell overlay, so opening or closing it does not unmount
the active thread, clear a draft, interrupt streaming, or reset a per-turn
override.

## 4. The grouping rule

Only read-shaped work groups. At least two consecutive read-shaped calls form
a group such as “Read 3 files”. **Edits and shell commands never disappear
inside a group**: work that could change the world stays visible.

There is one classifier: core's `Tools.writesOf`, shared with checkpoint
attribution. `none` is read-shaped; `declared` and `opaque` are not. An unknown
tool therefore remains visible. New read-only built-ins become groupable by
joining this classifier, not a transcript-specific list.

## 5. Streaming and the preview window

One status surface has two states and never unmounts:

- **Running:** a fixed-height one-line ticker under the current headline. The
  active tool appears as `action detail`, shimmering. Labels replace one
  another in place so the window never grows. Assistant prose streams outside
  the ticker as transcript markdown. The ticker keeps the last completed label
  while prose arrives and also owns retry and queued-message status.
- **Settled:** the same surface becomes “Worked for 5m 16s”, “Stopped”, or
  “Canceled”. A failed turn collapses like a completed turn; its label tells
  the truth.

Live Pi `message_update` events drive the in-progress assistant projection.
Committed Pi session entries remain authoritative. Reload does not invent or
reconstruct a partial assistant message; it reads the committed active branch,
then live delivery resumes. Smoothness is a rendering concern, not a second
transcript or a second transport protocol. Honk uses Pi's event shapes over
Effect RPC's chunked stream and does not add a protobuf message layer.

A tool row gets its name from the step exactly once. Its detail is a path or
command extracted from arguments, never the tool name repeated.

### Motion

- The ticker is fixed height. An outgoing label rises about 7px and fades; the
  incoming label rises in over about 220ms with ease-out.
- When a tool completes, shimmer stops and a check stamps briefly before the
  next label arrives.
- Read roll-ups happen inside the ticker.
- Settling transforms the ticker into the duration header in place; the
  summary fades in.
- Expansion animates measured container height. Rows do not animate
  independently.
- Under `prefers-reduced-motion`, swaps are immediate and shimmer becomes
  static muted text.

## 6. One message value

Every user-authored chat value is:

```ts
interface ComposerMessage {
  readonly text: string;
  readonly images: readonly PromptImage[];
}
```

This exact value crosses the initial composer, thread composer, `prompt`,
`steer`, `followUp`, queue projection, abort restoration, and edit flow. A
message may contain text, images, or both; neither is refused. An image-only
message is not padded with synthetic text.

Images are Pi prompt content, not a Honk attachment side channel. At the RPC
boundary each image has non-empty base64 data and an `image/*` media type.
Core adds Pi's `ImageContent` discriminant and passes the images through the
public harness prompt options. Committed messages render images from Pi's
stored user content, so reload, reconnect, and branch navigation cannot lose
them. One message carries at most eight images; each image is at most 10 MiB
before base64 encoding. The editor preflights those same limits before reading
a file, while core's schema remains authoritative for every client.

The editor owns its current `ComposerMessage`. Picker and paste add images;
each thumbnail can be removed before send. File reads may finish out of order,
but an older selection may never attach to a newer draft or edit intent. One
unreadable file does not discard readable siblings.

## 7. Sending, queues, and stopping

| User intent             | Pi verb    | Delivery                                  |
| ----------------------- | ---------- | ----------------------------------------- |
| Send while idle         | `prompt`   | Starts the turn                           |
| Send during a run now   | `steer`    | At the next agent-loop boundary           |
| Queue after current run | `followUp` | After the agent finishes its current work |

Bindings are fixed:

- **Enter enqueues.** While idle, the queue drains immediately and feels like
  send. During a run it queues a follow-up and the queue tray appears.
- **⌘Enter / Ctrl+Enter steers** into the running work.
- **Shift+Enter** inserts a newline.

Streaming never changes the bindings. Pi's `steeringMode` and `followUpMode`
still own whether queued messages are delivered one at a time or all at once.

### Queue truth and restoration

Pi's `queue_update` event carries complete steer, follow-up, and next-turn
buckets. Honk projects each queued Pi user message back to the same
`ComposerMessage`, including images, and keeps no shadow queue. Image-only rows
therefore remain visible.

Queue editing is recall, not an in-row editor. `abort()` returns the messages
Pi cleared. Honk combines their text and images and restores them to the
ordinary reply editor. A rejected send likewise restores the exact initiating
message. “Stop and send” is composition — abort, restore, then prompt — not a
fourth harness verb.

## 8. Editing a committed message

Only an idle, committed user message is editable. Entering edit mode replaces
the editor with that message's existing text and images. The user may retain,
remove, paste, or pick images. The ordinary reply draft remains untouched
behind the edit intent.

Saving uses only Pi's public tree and prompt APIs:

```ts
await harness.navigateTree(entryId, { summarize: false });
await harness.prompt(text, { images });
```

Pi selects the target message's parent and appends the revision as a sibling.
The old branch remains in the session tree. Honk does not mutate a historical
entry, rewrite JSONL, patch Pi, or maintain an edit overlay.

The edit lifecycle is lossless:

- **Cancel** discards the edit intent and restores the untouched reply draft.
- **Busy refusal or pre-prompt failure** keeps the edit text and images visible
  and restores the previous active leaf when navigation had already moved it.
- **Provider failure after the revised user entry commits** stays on the new
  branch with Pi's failed assistant entry; it is not mistaken for a failed
  navigation and rolled back.
- **Stop during the revised run** aborts Pi's run without replacing the
  ordinary reply draft.
- **Success** exits edit mode. The authoritative active-branch state replaces
  the transcript; no local splice guesses what Pi committed.

## 9. Active branch and reload

Every linear conversation read follows Pi's active branch through
`getBranch()`, never the whole append log. Turn segmentation, visible messages,
workspace trails, model records, and per-turn change pairing all walk that
path. Checkpoints remain keyed by entry id and branch-agnostic.

Branch length is not the reload cursor. Reload atomically pairs:

- `entries`: the full active branch; and
- `entrySeq`: the append-log position used for later tails.

If the append log changes while the branch is read, core retries the pair.
`session_tree` is an authoritative replacement signal: the client replaces its
visible branch instead of appending it. This prevents an overlapping edit,
reload, or reconnect from skipping an entry or mixing two branches.

## 10. Git actions in the conversation

A Git action is an ordinary agent turn started by a button rather than typed
text:

- One core command appends a `honk.git_action` marker and prompts the harness
  with canonical instructions.
- The transcript pairs the marker with the following user message and renders
  one chip. Detailed disclosure shows exactly what the model received.
- A marker without a following user message means the request did not start.
- Git actions are idle-only because Pi buffers a running turn's user message;
  allowing a mid-run marker would make pairing ambiguous.

The resulting turn uses the same grammar, density, streaming, and receipts as
every other turn.

## 11. What this deliberately does not add

- No Pi source edits, `node_modules` patches, forked agent loop, or copied TUI.
- No Honk transcript, message tree, queue, branch, or protobuf mirror.
- No attachment registry beside Pi messages.
- No synthetic “running” transition before Pi reports one.
- No global chat failure for a refusal owned by one button or composer action.
- No permission or question trays: trusted workspaces run the capabilities core
  constructed.
- No composer modes beyond model, thinking level, and the fixed send verbs.
