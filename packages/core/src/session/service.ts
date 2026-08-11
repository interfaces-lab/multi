/**
 * The session service: every command from `./contract`, landing on a real Pi
 * `AgentHarness`, with per-turn checkpoints gated by `./attribution`.
 *
 * @module
 */

import {
  AgentHarnessError,
  JsonlSessionRepo,
  type JsonlSessionMetadata,
  parseCommandArgs,
  type Session as PiSession,
} from "@earendil-works/pi-agent-core";
import { Context, Effect, Layer, PubSub, Schema, Stream, SubscriptionRef } from "effect";
import type { Rpc } from "effect/unstable/rpc";

import { Git } from "../git";
import { Mcp } from "../mcp";
import { Models } from "../models";
import { Resources } from "../resources";
import { Workspace } from "../workspace";
import { makeCheckpointLedger } from "./checkpoints";
import {
  makeDelegationRunner,
  releaseStaleLock,
  runAdmitted,
  runAdmittedPi,
  runPi,
  trackPiRun,
} from "./delegation";
import { fusionOf, seatingOf, type Pairing } from "./fusion";
import { PiEntry, PiEvent, PiMessage } from "./contract-foundation";
import {
  closeLiveSession,
  type LiveSession,
  loadResources,
  makeLiveSessionRegistry,
  openLiveSession,
  readStableBranch,
  runtimeForBranch,
  workspaceTrail,
} from "./runtime";
import { makeSessionInventory } from "./inventory";
import { makeSessionPersistence } from "./persistence";
import { PRESETS, type Preset } from "./subagents";
import type {
  Abort,
  AbortOutput,
  Create,
  Delete,
  EditMessage,
  EventsFrame,
  FollowUp,
  Get,
  Interface,
  Prompt,
  Reload,
  Revert,
  RunCommand,
  RunGitAction,
  RunSkill,
  SessionInfo,
  SetModel,
  SetThinkingLevel,
  SetWorkspace,
  Steer,
} from "./contract";
import {
  CreateChoiceError,
  EditMessageCommittedError,
  NotFoundError,
  Rpcs,
  SessionId,
} from "./contract";
import { instructionsFor } from "./git-actions";
import { messageOptions, replaceMessage } from "./message";
import { type GenerateSessionTitle, generateModelSessionTitle } from "./title";

/**
 * What {@link layer} needs beyond its services.
 *
 * The model collection is not here: it lives in {@link Models.Service}, which
 * this layer requires, so the harnesses stream through the same collection
 * the models RPCs describe and credential writes unlock.
 *
 * @category layers
 */
export interface LayerOptions {
  /**
   * The host data directory's environment: Pi session transcripts persist in
   * its `sessions/` subtree through the JSONL repository. The same instance
   * the workspace trust store and lease use.
   */
  readonly storage: Workspace.ExecutionEnv;

  /**
   * The subagent catalog. Production ships {@link PRESETS}; tests inject
   * faux-armed presets so delegation runs deterministically.
   */
  readonly presets?: readonly Preset[];

  /** Per-stop overrides on the shipped seating; tests inject faux arms. */
  readonly pairings?: readonly Pairing[];

  /** Overrides background model title generation; deterministic tests inject this. */
  readonly generateTitle?: GenerateSessionTitle;
}

interface SessionAcquisition {
  readonly session: PiSession<JsonlSessionMetadata>;
  readonly metadata: JsonlSessionMetadata;
  readonly id: SessionId;
  opened: LiveSession | undefined;
  committed: boolean;
}

const runLivePi = <A>(sessionId: SessionId, found: LiveSession, run: () => Promise<A>) =>
  runAdmittedPi(found.lifecycle, () => new NotFoundError({ sessionId }), run);

/**
 * Builds the session service.
 *
 * Requires {@link Workspace.Service}, {@link Git.Service}, and
 * {@link Models.Service} — each the *same* instance its own RPCs use. A second
 * workspace instance splits the trust store; a second models instance splits
 * the catalog credential writes unlock.
 *
 * @example
 * ```ts
 * const services = Session.layer({ storage }).pipe(
 *   Layer.provide(Models.layer({ collection, credentials })),
 *   Layer.provideMerge(Workspace.defaultLayer({ createExecutionEnv, storage })),
 * );
 * ```
 *
 * @category layers
 */
export const layer = (options: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const workspaces = yield* Workspace.Service;
      const git = yield* Git.Service;
      const models = yield* Models.Service;
      const mcp = yield* Mcp.Service;
      const resources = yield* Resources.Service;

      // One JSONL transcript per session under <dataDirectory>/sessions,
      // owned by Pi's repository for the core's whole lifetime. The durable
      // truth spec section 9 talks about is these files.
      const repo = new JsonlSessionRepo({ fs: options.storage, sessionsRoot: "sessions" });

      // Sessions are resources, not map entries. The scoped registry owns
      // restore races, deletion tombstones, and parallel harness teardown.
      const live = yield* makeLiveSessionRegistry;

      // The "inventory changed" tick: a notification, never a phase source.
      // Anything that changes what `list` would answer — a session created,
      // deleted, restored, or changing phase — publishes here, and each
      // `watchInventory` frame is a fresh authoritative list read. The refs
      // stay the one phase source (spec section 9); this pubsub only says
      // "read again".
      const inventoryChanged = yield* PubSub.unbounded<void>();
      const presets = options.presets ?? PRESETS;
      const pairings = seatingOf(options.pairings);
      const generateTitle: GenerateSessionTitle =
        options.generateTitle ?? ((input) => generateModelSessionTitle(models.collection, input));
      const checkpoints = makeCheckpointLedger({ git, workspaces });
      const inventory = yield* makeSessionInventory({
        repo,
        storage: options.storage,
        workspaces,
        inventoryChanged,
        liveSnapshot: live.snapshot,
        generateTitle,
      });
      const persistence = makeSessionPersistence({
        repo,
        workspaces,
        git,
        models,
        resources,
        presets,
        inventoryChanged,
        deleted: live.deleted,
        register: live.register,
      });

      // Delegation restores linked sessions through the persistence layer's
      // child-only path. Primary restoration depends on the completed runner,
      // so the dependency graph is now one-way rather than a delayed callback
      // from the runner into its own constructor.
      const runner = makeDelegationRunner<LiveSession>({
        repo,
        models,
        presets,
        pairings,
        mcp,
        liveOf: live.get,
        register: (sessionId, opened) =>
          Effect.gen(function* () {
            const entered = yield* live.register(sessionId, opened);
            if (entered !== opened) return false;
            yield* PubSub.publish(inventoryChanged, undefined);
            return true;
          }),
        restore: persistence.restoreLinked,
        makeLiveSession: (session, binding, model, thinkingLevel, shape, entrySeq) =>
          openLiveSession({
            session,
            origin: { workspace: binding.workspace, env: binding.env },
            binding,
            snapshots: [],
            entrySeq,
            model,
            thinkingLevel,
            shape,
            models,
            resources,
            inventoryChanged,
          }),
        closeLiveSession,
        captureSnapshot: checkpoints.capture,
        settleSnapshot: checkpoints.settle,
      });

      const restore = (sessionId: SessionId) =>
        persistence.restore(sessionId, (request) =>
          request.link === null
            ? runner.primaryShape(sessionId, fusionOf(request.entries))
            : Effect.succeed(runner.childShapeFor(request.link.role)),
        );

      const lookup = Effect.fnUntraced(function* (sessionId: SessionId) {
        const found = yield* live.get(sessionId);
        if (found) return found;
        // Lazy restore: the first use after a restart reopens the session.
        const restored = yield* restore(sessionId);
        if (!restored) return yield* new NotFoundError({ sessionId });
        return restored;
      });
      const findMetadata = persistence.findMetadata;
      const captureSnapshot = checkpoints.capture;
      const settleSnapshot = checkpoints.settle;

      const create = Effect.fn("Session.create")(function* (input: Rpc.Payload<typeof Create>) {
        const workspace = yield* workspaces.find({ workspaceId: input.workspaceId });
        // A stop decides both seats, so it excludes the model and thinking level.
        if (
          input.fusion !== undefined &&
          (input.model !== undefined || input.thinkingLevel !== undefined)
        ) {
          return yield* new CreateChoiceError({});
        }
        const pairing = input.fusion === undefined ? null : pairings[input.fusion];
        // Resolve every arm before creating a transcript.
        const model =
          pairing === null
            ? yield* models.resolveAvailable(input.model)
            : yield* runner.armModel(pairing.main.model);
        const thinkingLevel = pairing === null ? input.thinkingLevel : pairing.main.thinkingLevel;
        if (pairing !== null) yield* runner.armModel(pairing.sidekick.model);
        return yield* Effect.acquireUseRelease(
          Effect.gen(function* () {
            const session = yield* runPi(() => repo.create({ cwd: workspace.directory }));
            const metadata = yield* runPi(() => session.getMetadata());
            const created: SessionAcquisition = {
              session,
              metadata,
              id: SessionId.make(metadata.id),
              opened: undefined,
              committed: false,
            };
            return created;
          }),
          (created) =>
            Effect.gen(function* () {
              // Pi's own entries are the durable source for restore. Fusion's
              // stop is explicit because two stops may share an arm.
              yield* runPi(() => created.session.appendModelChange(model.provider, model.id));
              if (thinkingLevel !== undefined) {
                yield* runPi(() => created.session.appendThinkingLevelChange(thinkingLevel));
              }
              if (pairing !== null) {
                yield* runPi(() =>
                  created.session.appendCustomEntry("honk.fusion", { stop: pairing.stop }),
                );
              }
              const entrySeq = (yield* runPi(() => created.session.getEntries())).length;

              const env = yield* workspaces.env({ workspaceId: workspace.id });
              const shape = yield* runner.primaryShape(
                created.id,
                pairing === null ? null : pairing.stop,
              );
              const liveSession = yield* openLiveSession({
                session: created.session,
                origin: { workspace, env },
                binding: { workspace, env },
                snapshots: [],
                entrySeq,
                model,
                thinkingLevel,
                shape,
                models,
                resources,
                inventoryChanged,
              });
              created.opened = liveSession;

              // "base" is the workspace before this conversation changed it.
              yield* captureSnapshot(created.id, liveSession, "base");

              // Registration and ownership transfer are one uninterruptible
              // step: cleanup must never delete a session the registry owns.
              yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  const registered = yield* live.register(created.id, liveSession);
                  if (registered !== liveSession) {
                    created.opened = undefined;
                    return yield* Effect.die(new Error(`Session id collision: ${created.id}`));
                  }
                  created.committed = true;
                  yield* PubSub.publish(inventoryChanged, undefined);
                }),
              );
              return { id: created.id, workspaceId: workspace.id };
            }),
          (created) =>
            created.committed
              ? Effect.void
              : Effect.gen(function* () {
                  if (created.opened !== undefined) yield* closeLiveSession(created.opened);
                  yield* git
                    .deleteCheckpoints({ workspaceId: workspace.id, prefix: created.id })
                    .pipe(Effect.ignore);
                  yield* runPi(() => repo.delete(created.metadata)).pipe(Effect.ignore);
                }),
        );
      });

      const list = inventory.list;

      const get = Effect.fn("Session.get")(function* (input: Rpc.Payload<typeof Get>) {
        const opened = yield* live.get(input.sessionId);
        if (opened) {
          return {
            id: input.sessionId,
            workspaceId: opened.binding.workspace.id,
          } satisfies SessionInfo;
        }
        // Metadata only — get answers identity, and identity must not cost a
        // harness. The origin workspace is the honest answer for a session
        // nobody has opened; the current binding exists only once it is open.
        const metadata = yield* findMetadata(input.sessionId);
        if (!metadata) return yield* new NotFoundError({ sessionId: input.sessionId });
        const located = yield* workspaces.locate({ directory: metadata.cwd });
        if (!located) return yield* new NotFoundError({ sessionId: input.sessionId });
        return { id: input.sessionId, workspaceId: located.id } satisfies SessionInfo;
      });

      const remove = Effect.fn("Session.delete")(function* (input: Rpc.Payload<typeof Delete>) {
        const metadata = yield* findMetadata(input.sessionId);
        if (!metadata) return yield* new NotFoundError({ sessionId: input.sessionId });
        const opened = yield* live.remove(input.sessionId);
        if (opened) {
          // End the run before its transcript disappears under it. A failed
          // abort must not block deletion — the user asked for gone.
          yield* closeLiveSession(opened);
        }

        // Every repository this session snapshotted into: the live list when
        // the session is open, the transcript's /cd trail when it is not.
        // Best-effort by design — a broken transcript or a vanished workspace
        // must not block the deletion the user asked for.
        const targets = yield* Effect.gen(function* () {
          const ids = new Set<Workspace.WorkspaceId>();
          if (opened) {
            ids.add(opened.binding.workspace.id);
            for (const snapshot of opened.snapshots) ids.add(snapshot.workspaceId);
            return ids;
          }
          const origin = yield* workspaces.locate({ directory: metadata.cwd });
          if (!origin) return ids;
          const session = yield* runPi(() => repo.open(metadata));
          const entries = yield* runPi(() => session.getEntries());
          const { attributed } = yield* workspaceTrail(workspaces, entries, origin);
          for (const snapshot of attributed) ids.add(snapshot.workspaceId);
          return ids;
        }).pipe(Effect.orElseSucceed(() => new Set<Workspace.WorkspaceId>()));

        yield* Effect.forEach(
          [...targets],
          (workspaceId) =>
            git.deleteCheckpoints({ workspaceId, prefix: input.sessionId }).pipe(Effect.ignore),
          { discard: true },
        );
        yield* runPi(() => repo.delete(metadata));
        yield* inventory.forget(input.sessionId);
        yield* PubSub.publish(inventoryChanged, undefined);
      });

      const prompt = Effect.fn("Session.prompt")(function* (input: Rpc.Payload<typeof Prompt>) {
        // Before the lookup: a message with nothing in it must not restore a
        // session to be refused by it.
        const options = yield* messageOptions(input);
        const found = yield* lookup(input.sessionId);
        // The user's message frees a stale delegation lock explicitly (spec
        // section 9); an in-flight delegation keeps the harness busy, so
        // this prompt would be refused before touching a healthy lock.
        releaseStaleLock(found.delegation, yield* SubscriptionRef.get(found.phase));
        // Title persistence and prompt start are one short transaction. Two
        // concurrent first sends cannot append competing names, and deletion
        // cannot land between the title and the message that justified it.
        const started = yield* runAdmitted(
          found.lifecycle,
          () => new NotFoundError({ sessionId: input.sessionId }),
          () =>
            Effect.uninterruptible(
              Effect.gen(function* () {
                const generation = yield* inventory.preparePrompt({
                  sessionId: input.sessionId,
                  live: found,
                  text: input.text,
                  images: input.images ?? [],
                });
                const running = trackPiRun(found.lifecycle, () =>
                  found.harness.prompt(input.text, options),
                );
                return { running, generation };
              }),
            ),
        );
        yield* inventory.scheduleTitle(input.sessionId, found, started.generation);
        yield* runPi(() => started.running);
        // Pi's prompt promise resolves at the settlement point, so this is
        // "after the turn": one checkpoint per settled turn, no event-side
        // bookkeeping. Steers and follow-ups fold into the same run and are
        // covered by this capture.
        yield* settleSnapshot(input.sessionId, found);
      });

      const editMessage = Effect.fn("Session.editMessage")(function* (
        input: Rpc.Payload<typeof EditMessage>,
      ) {
        const options = yield* messageOptions(input);
        const selectedModel =
          input.model === undefined ? undefined : yield* models.resolveAvailable(input.model);
        const found = yield* lookup(input.sessionId);
        yield* replaceMessage({
          sessionId: input.sessionId,
          entryId: input.entryId,
          text: input.text,
          options,
          ...(selectedModel === undefined ? {} : { model: selectedModel }),
          ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
          live: found,
          runtimeOf: (entries) =>
            runtimeForBranch({ live: found, entries, workspaces, models, resources }),
        });
        yield* settleSnapshot(input.sessionId, found).pipe(
          Effect.mapError((error) => EditMessageCommittedError.from("settlement", error)),
        );
      });

      const abort = Effect.fn("Session.abort")(function* (input: Rpc.Payload<typeof Abort>) {
        const found = yield* lookup(input.sessionId);
        const cleared = yield* runLivePi(input.sessionId, found, () => found.harness.abort());
        // An aborted run still wrote whatever it wrote before the abort.
        yield* settleSnapshot(input.sessionId, found);
        // The cleared queue goes back to the caller: stopping never destroys
        // text the user typed (spec/conversation.md section 7).
        return {
          clearedSteer: toWireMessages(jsonValue(cleared.clearedSteer)),
          clearedFollowUp: toWireMessages(jsonValue(cleared.clearedFollowUp)),
        } satisfies AbortOutput;
      });

      const steer = Effect.fn("Session.steer")(function* (input: Rpc.Payload<typeof Steer>) {
        const options = yield* messageOptions(input);
        const found = yield* lookup(input.sessionId);
        yield* runLivePi(input.sessionId, found, () => found.harness.steer(input.text, options));
      });

      const followUp = Effect.fn("Session.followUp")(function* (
        input: Rpc.Payload<typeof FollowUp>,
      ) {
        const options = yield* messageOptions(input);
        const found = yield* lookup(input.sessionId);
        yield* runLivePi(input.sessionId, found, () => found.harness.followUp(input.text, options));
      });

      const setThinkingLevel = Effect.fn("Session.setThinkingLevel")(function* (
        input: Rpc.Payload<typeof SetThinkingLevel>,
      ) {
        const found = yield* lookup(input.sessionId);
        // Pi owns the semantics: idle appends the thinking_level_change entry
        // now; running buffers it until the turn settles. No busy refusal —
        // changing effort mid-run is a supported Pi operation.
        yield* runLivePi(input.sessionId, found, () =>
          found.harness.setThinkingLevel(input.thinkingLevel),
        );
      });

      const setModel = Effect.fn("Session.setModel")(function* (
        input: Rpc.Payload<typeof SetModel>,
      ) {
        const found = yield* lookup(input.sessionId);
        // Resolve before touching the harness: an unknown reference fails
        // typed and leaves the session on the model it already had. Pi's
        // change semantics then mirror setThinkingLevel — immediate record
        // when idle, buffered until settlement when running.
        const model = yield* models.resolveAvailable(input.model);
        // Choosing a single model exits fusion, and the transcript says so
        // before the model moves: the exit marker is what restore and the
        // delegation gate read. The harness keeps its orchestrator shape
        // until the next open; the gate refuses sidekick delegation either
        // way, so the exit is behaviorally immediate.
        const entries = yield* runLivePi(input.sessionId, found, () => found.session.getBranch());
        if (fusionOf(entries) !== null) {
          yield* runLivePi(input.sessionId, found, () =>
            found.session.appendCustomEntry("honk.fusion", { stop: null }),
          );
        }
        yield* runLivePi(input.sessionId, found, () => found.harness.setModel(model));
      });

      const runGitAction = Effect.fn("Session.runGitAction")(function* (
        input: Rpc.Payload<typeof RunGitAction>,
      ) {
        const found = yield* lookup(input.sessionId);
        // Refuse a busy session before appending anything. Pi buffers a
        // running turn's user message until settlement, so a marker appended
        // mid-run would land *before* that turn's user message and pair with
        // the wrong turn. Same class, code, and copy as Pi's own refusal.
        if ((yield* SubscriptionRef.get(found.phase)) !== "idle") {
          return yield* Effect.fail(new AgentHarnessError("busy", "AgentHarness is busy"));
        }
        // Marker before prompt: if the model request fails, the transcript
        // keeps a marker with no turn after it — that *is* the failure state
        // a surface renders (spec/conversation.md §8). The instructions ride
        // the prompt's own user message, so model context and stored
        // transcript stay identical by construction.
        yield* runLivePi(input.sessionId, found, () =>
          found.session.appendCustomEntry("honk.git_action", {
            action: input.action,
            ...(input.files === undefined ? {} : { files: input.files }),
          }),
        );
        yield* runLivePi(input.sessionId, found, () =>
          found.harness.prompt(instructionsFor(input.action, input.files)),
        );
        yield* settleSnapshot(input.sessionId, found);
      });

      // Both invocation verbs are `prompt` with the text left to Pi: it holds
      // the skill and the template, and it owns the invocation format
      // (`formatSkillInvocation`, `formatPromptTemplateInvocation`). Neither
      // appends a marker entry the way runGitAction does — the turn's own user
      // message is already the record of what ran, because Pi writes the
      // formatted invocation into the transcript as that message. Both settle
      // at Pi's settlement point and capture the turn's checkpoint there, so a
      // skill that edits files gets the same receipt a typed prompt would.
      const runSkill = Effect.fn("Session.runSkill")(function* (
        input: Rpc.Payload<typeof RunSkill>,
      ) {
        const found = yield* lookup(input.sessionId);
        yield* runLivePi(input.sessionId, found, () =>
          input.instructions === undefined || input.instructions.length === 0
            ? found.harness.skill(input.name)
            : found.harness.skill(input.name, input.instructions),
        );
        yield* settleSnapshot(input.sessionId, found);
      });

      const runCommand = Effect.fn("Session.runCommand")(function* (
        input: Rpc.Payload<typeof RunCommand>,
      ) {
        const found = yield* lookup(input.sessionId);
        // Pi's own splitter, not a Honk one: `parseCommandArgs` is the rule
        // `substituteArgs` was written against, so `$1` means the same thing
        // here as it does inside the template.
        const args = parseCommandArgs(input.args ?? "");
        yield* runLivePi(input.sessionId, found, () =>
          found.harness.promptFromTemplate(input.name, args),
        );
        yield* settleSnapshot(input.sessionId, found);
      });

      const reload = Effect.fn("Session.reload")(function* (input: Rpc.Payload<typeof Reload>) {
        const found = yield* lookup(input.sessionId);
        // Authoritative committed read straight from the Pi session. It never
        // touches the harness, which is what makes it safe during a run and
        // proves invariant 3: reloading cannot execute work. Pi's own cursor
        // keeps repair reads proportional to newly committed entries.
        const state = yield* runLivePi(input.sessionId, found, async () => {
          if (input.afterEntrySeq !== undefined) {
            const entries = await found.session.getEntries({ afterEntrySeq: input.afterEntrySeq });
            return { entries, entrySeq: input.afterEntrySeq + entries.length };
          }
          return readStableBranch(found.session);
        });
        return { ...state, phase: yield* SubscriptionRef.get(found.phase) };
      });

      const changes = Effect.fn("Session.changes")(function* (input: {
        readonly sessionId: SessionId;
      }) {
        const found = yield* lookup(input.sessionId);
        return yield* checkpoints.changes(input.sessionId, found);
      });

      const setWorkspace = Effect.fn("Session.setWorkspace")(function* (
        input: Rpc.Payload<typeof SetWorkspace>,
      ) {
        const found = yield* lookup(input.sessionId);
        if (found.binding.workspace.id === input.workspaceId) return;
        const workspace = yield* workspaces.find({ workspaceId: input.workspaceId });
        const env = yield* workspaces.env({ workspaceId: workspace.id });
        const binding = { workspace, env };
        const loaded = yield* loadResources(resources, binding);
        yield* runAdmitted(
          found.lifecycle,
          () => new NotFoundError(input),
          () =>
            Effect.gen(function* () {
              found.binding.workspace = binding.workspace;
              found.binding.env = binding.env;
              yield* runPi(() => found.harness.setResources(loaded));
              const entryId = yield* runPi(() =>
                found.session.appendCustomEntry("honk.workspace_change", {
                  workspaceId: workspace.id,
                  directory: workspace.directory,
                }),
              );
              yield* captureSnapshot(input.sessionId, found, entryId);
            }),
        );
      });

      const revert = Effect.fn("Session.revert")(function* (input: Rpc.Payload<typeof Revert>) {
        const found = yield* lookup(input.sessionId);
        yield* checkpoints.revert(input, found);
      });

      const events = Effect.fn("Session.events")(function* (input: {
        readonly sessionId: SessionId;
      }) {
        const found = yield* lookup(input.sessionId);
        // Subscribing before returning is the guarantee: once this effect
        // completes, every subsequent event reaches the caller's stream.
        const subscription = yield* PubSub.subscribe(found.events);
        const stream = Stream.fromSubscription(subscription);
        // The run's current queue, replayed ahead of the live events because
        // Pi announces the queue only when it changes. Read after
        // subscribing, so a frame published in between is repeated rather
        // than lost — every queue_update carries the whole queue, and a
        // client that renders the same queue twice renders it once.
        const queued = found.queue.last;
        return queued === undefined ? stream : Stream.concat(Stream.make(queued), stream);
      });

      const watchInventory = inventory.watch;

      return Service.of({
        create,
        prompt,
        editMessage,
        abort,
        steer,
        followUp,
        runGitAction,
        runSkill,
        runCommand,
        reload,
        changes,
        setWorkspace,
        setThinkingLevel,
        setModel,
        revert,
        list,
        get,
        delete: remove,
        events,
        watchInventory,
      });
    }),
  );

/**
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Session") {}

/**
 * Normalizes a Pi value for JSON transport.
 *
 * Pi values can carry explicit `undefined` properties, which JSON cannot
 * represent, so the serializer rejects them. This round-trips each value
 * through JSON exactly once — the same normalization Pi's own JSONL persistence
 * applies — and changes nothing else.
 */
const jsonValue = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const toWireEntry = (value: unknown) => Schema.decodeUnknownSync(PiEntry)(jsonValue(value));
const toWireEvent = (value: unknown) => Schema.decodeUnknownSync(PiEvent)(jsonValue(value));
const toWireMessages = Schema.decodeUnknownSync(Schema.Array(PiMessage));
const liveFrame: EventsFrame = { type: "live" };
const eventFrame = (event: unknown): EventsFrame => ({ type: "event", event: toWireEvent(event) });

/**
 * Binds the session RPCs to {@link Service}.
 *
 * Handlers stay thin: decoding already happened at the RPC boundary, so they
 * only bind payloads to service methods and apply wire normalization.
 * `Rpcs.toLayer` checks the map is total at compile time. Provide
 * `layer(options)` to satisfy the `Service` requirement.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const session = yield* Service;
    return {
      "session.create": (payload) => session.create(payload),
      "session.prompt": (payload) => session.prompt(payload),
      "session.edit_message": (payload) => session.editMessage(payload),
      "session.abort": (payload) => session.abort(payload),
      "session.steer": (payload) => session.steer(payload),
      "session.follow_up": (payload) => session.followUp(payload),
      "session.run_git_action": (payload) => session.runGitAction(payload),
      "session.run_skill": (payload) => session.runSkill(payload),
      "session.run_command": (payload) => session.runCommand(payload),
      "session.changes": (payload) => session.changes(payload),
      "session.set_workspace": (payload) => session.setWorkspace(payload),
      "session.set_thinking_level": (payload) => session.setThinkingLevel(payload),
      "session.set_model": (payload) => session.setModel(payload),
      "session.revert": (payload) => session.revert(payload),
      "session.list": (payload) => session.list(payload),
      "session.get": (payload) => session.get(payload),
      "session.delete": (payload) => session.delete(payload),
      "session.reload": (payload) =>
        session
          .reload(payload)
          .pipe(Effect.map((state) => ({ ...state, entries: state.entries.map(toWireEntry) }))),
      // Stream.unwrap folds the subscription Scope into the stream lifetime:
      // when the rpc call ends, the stream closes and the client detaches
      // without touching the run. The `live` head frame is prepended here
      // rather than inside the service, because in-process callers already get
      // that guarantee from the Effect resolving.
      "session.events": (payload) =>
        Stream.unwrap(
          session
            .events(payload)
            .pipe(
              Effect.map((stream) =>
                Stream.concat(Stream.make(liveFrame), stream.pipe(Stream.map(eventFrame))),
              ),
            ),
        ),
      // No `live` head frame here: the stream's own first element is the
      // current inventory, which carries the same guarantee as data.
      "session.watch_inventory": () => Stream.unwrap(session.watchInventory),
    };
  }),
);
