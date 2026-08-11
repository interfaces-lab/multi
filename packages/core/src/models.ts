/**
 * Models: the provider catalog and the credentials that unlock it.
 *
 * Pi owns the model runtime. Its `Models` collection resolves request auth,
 * runs serialized OAuth refresh, and streams every provider; its transcript
 * records the selected model as a first-class `model_change` entry. Honk's
 * part is deliberately small (spec section 11): persist credentials so Pi can
 * call a provider, expose the catalog with auth status so settings can render
 * it, and resolve a session's chosen model to a Pi `Model` value.
 *
 * The core maintains no model allowlist, calculates no billing, and never
 * silently moves a session between credentials. Presentation policy — which
 * models to feature, what to name them — belongs to the frontend.
 *
 * @see spec/core.md section 11.
 * @module
 */

import type {
  Api,
  AuthEvent,
  AuthPrompt,
  Credential,
  CredentialStore,
  Model,
  MutableModels,
} from "@earendil-works/pi-ai";
import { Context, Effect, Layer, Queue, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { ServiceOf } from "./util/rpc";
import type { Workspace } from "./workspace";

/**
 * Names one model in the catalog: Pi's provider id and model id, exactly as
 * the transcript's `model_change` entries record them.
 *
 * A reference rather than the `Model` object on purpose. Clients hold and
 * transmit the two strings; only the core resolves them against the live
 * collection, so a stale or fabricated reference fails typed instead of
 * smuggling an unvetted model into a harness.
 *
 * @category schemas
 */
export const ModelRef = Schema.Struct({
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
}).annotate({ identifier: "ModelRef" });
export type ModelRef = typeof ModelRef.Type;

/**
 * One model as settings render it.
 *
 * @category schemas
 */
export const ModelSummary = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.String,
}).annotate({ identifier: "ModelSummary" });
export type ModelSummary = typeof ModelSummary.Type;

/**
 * One provider with its auth status and current model list.
 *
 * `configured` is Pi's `checkAuth` verdict: the provider has complete auth —
 * a stored credential, an ambient env var, or keyless access. `source` is
 * Pi's human-readable label for where that auth came from ("ANTHROPIC_API_KEY",
 * "OAuth"), for status UI only. `methods` are the ways a user can configure
 * the provider: which entry field or login flow a settings surface should
 * offer. Ambient-only providers list neither.
 *
 * @category schemas
 */
export const ProviderSummary = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.String,
  configured: Schema.Boolean,
  methods: Schema.Array(Schema.Literals(["api_key", "oauth"])),
  authType: Schema.optionalKey(Schema.Literals(["api_key", "oauth"])),
  source: Schema.optionalKey(Schema.String),
  models: Schema.Array(ModelSummary),
}).annotate({ identifier: "ProviderSummary" });
export type ProviderSummary = typeof ProviderSummary.Type;

/**
 * What {@link List} answers: the whole catalog, credentialed or not.
 *
 * Unconfigured providers are listed on purpose — settings must show what
 * *could* be unlocked, not only what already is.
 *
 * @category schemas
 */
export const ListOutput = Schema.Struct({
  providers: Schema.Array(ProviderSummary),
}).annotate({ identifier: "ModelsListOutput" });
export type ListOutput = typeof ListOutput.Type;

/**
 * One choice in a `select` login prompt, as Pi's flow offers it.
 *
 * @category schemas
 */
export const LoginPromptOption = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "ModelsLoginPromptOption" });
export type LoginPromptOption = typeof LoginPromptOption.Type;

/**
 * One frame of the {@link Login} stream: Pi's interactive login flow relayed
 * as typed messages, carried faithfully rather than reinterpreted.
 *
 * `open_url`, `device_code`, `info`, and `progress` mirror Pi's notify
 * events one for one. `prompt` asks the user for a string — pasted code,
 * secret, or a `select` option id — answered through {@link AnswerLogin} with
 * the frame's `promptId`. Anthropic's flow exercises `open_url`, one
 * `manual_code` prompt raced against its localhost callback, and `progress`.
 * `done` is always the final frame of a successful login; a prompt still
 * pending when the stream ends is void, so a client dismisses its prompt UI
 * on stream end rather than waiting for a cancellation frame.
 *
 * @category schemas
 */
export const LoginEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("open_url"),
    url: Schema.String,
    instructions: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("device_code"),
    userCode: Schema.String,
    verificationUri: Schema.String,
    intervalSeconds: Schema.optionalKey(Schema.Finite),
    expiresInSeconds: Schema.optionalKey(Schema.Finite),
  }),
  Schema.Struct({
    kind: Schema.Literal("info"),
    message: Schema.String,
    links: Schema.optionalKey(
      Schema.Array(Schema.Struct({ url: Schema.String, label: Schema.optionalKey(Schema.String) })),
    ),
  }),
  Schema.Struct({ kind: Schema.Literal("progress"), message: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("prompt"),
    promptId: Schema.NonEmptyString,
    promptType: Schema.Literals(["text", "secret", "select", "manual_code"]),
    message: Schema.String,
    placeholder: Schema.optionalKey(Schema.String),
    options: Schema.optionalKey(Schema.Array(LoginPromptOption)),
  }),
  Schema.Struct({ kind: Schema.Literal("done") }),
]).annotate({ identifier: "ModelsLoginEvent" });
export type LoginEvent = typeof LoginEvent.Type;

/**
 * No provider in the collection carries this id.
 *
 * @category errors
 */
export class UnknownProviderError extends Schema.TaggedErrorClass<UnknownProviderError>()(
  "ModelsUnknownProviderError",
  {
    code: Schema.tag("models.unknown_provider"),
    message: Schema.tag("Honk does not know this provider."),
    providerId: Schema.NonEmptyString,
  },
) {}

/**
 * The provider exists but offers no model with this id.
 *
 * Also the honest answer for a restored session whose recorded model left the
 * catalog: the session names its model, and a core that silently substituted
 * another would move the user's conversation without consent (spec section 11).
 *
 * @category errors
 */
export class UnknownModelError extends Schema.TaggedErrorClass<UnknownModelError>()(
  "ModelsUnknownModelError",
  {
    code: Schema.tag("models.unknown_model"),
    message: Schema.tag("This provider does not offer this model."),
    providerId: Schema.NonEmptyString,
    modelId: Schema.NonEmptyString,
  },
) {}

/**
 * The provider and model exist, but the provider has no usable credential.
 *
 * Resolving this before session creation keeps an unrunnable explicit choice
 * from creating a transcript whose first request can only fail. Provider ids
 * remain exact: `openai` API-key auth and `openai-codex` OAuth are different
 * Pi providers, so core never borrows one provider's credential for another.
 *
 * @category errors
 */
export class ProviderNotConfiguredError extends Schema.TaggedErrorClass<ProviderNotConfiguredError>()(
  "ModelsProviderNotConfiguredError",
  {
    code: Schema.tag("models.provider_not_configured"),
    message: Schema.tag("This provider is not configured."),
    providerId: Schema.NonEmptyString,
  },
) {}

/**
 * No configured provider offers any model.
 *
 * The answer to "give me a default" on a host where nothing is unlocked yet.
 * A product state, not a crash: the client's move is to open settings and add
 * a credential.
 *
 * @category errors
 */
export class NoModelError extends Schema.TaggedErrorClass<NoModelError>()("ModelsNoModelError", {
  code: Schema.tag("models.no_model"),
  message: Schema.tag("No configured provider offers a model."),
}) {}

/**
 * The credential store refused a write.
 *
 * @category errors
 */
export class CredentialError extends Schema.TaggedErrorClass<CredentialError>()(
  "ModelsCredentialError",
  {
    code: Schema.tag("models.credential_failed"),
    message: Schema.tag("Honk could not update this credential."),
    providerId: Schema.NonEmptyString,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/**
 * The provider-owned login flow did not produce a credential.
 *
 * Covers refusal, network failure, and cancellation alike: Pi's flow rejects
 * with one Error either way, preserved here as the cause. The stored
 * credential, if any, is untouched — a failed login never logs anyone out.
 *
 * @category errors
 */
export class LoginError extends Schema.TaggedErrorClass<LoginError>()("ModelsLoginError", {
  code: Schema.tag("models.login_failed"),
  message: Schema.tag("Honk could not complete this login."),
  providerId: Schema.NonEmptyString,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * No login flow is waiting on this prompt.
 *
 * The honest answer for an answer that raced the flow: the localhost callback
 * won, the login ended, or the id was never minted. A client treats it as
 * "this prompt is over", not as a failure of the login itself.
 *
 * @category errors
 */
export class UnknownLoginPromptError extends Schema.TaggedErrorClass<UnknownLoginPromptError>()(
  "ModelsUnknownLoginPromptError",
  {
    code: Schema.tag("models.unknown_login_prompt"),
    message: Schema.tag("This login prompt is no longer pending."),
    promptId: Schema.NonEmptyString,
  },
) {}

/**
 * Every way resolving a model reference can fail.
 *
 * Session commands carry this union: any command may be the first touch of a
 * stored session, and restoring one resolves its recorded model.
 *
 * @category errors
 */
export const ResolveError = Schema.Union([UnknownProviderError, UnknownModelError]);
export type ResolveError = typeof ResolveError.Type;

/** Every way choosing a currently runnable model can fail. */
export const AvailableError = Schema.Union([
  UnknownProviderError,
  UnknownModelError,
  ProviderNotConfiguredError,
  NoModelError,
]);
export type AvailableError = typeof AvailableError.Type;

/**
 * Every expected failure this domain owns.
 *
 * @category errors
 */
export type Error = AvailableError | CredentialError | LoginError | UnknownLoginPromptError;

/**
 * The catalog with auth status, for settings.
 *
 * @category commands
 */
export const List = Rpc.make("models.list", {
  payload: {},
  success: ListOutput,
});

/**
 * Stores an API key for a provider.
 *
 * The direct credential write. Interactive, provider-owned flows enter
 * through {@link Login} instead.
 *
 * @category commands
 */
export const SetCredential = Rpc.make("models.set_credential", {
  payload: { providerId: Schema.NonEmptyString, key: Schema.NonEmptyString },
  error: Schema.Union([UnknownProviderError, CredentialError]),
});

/**
 * Removes the stored credential for a provider (logout).
 *
 * Covers OAuth and API keys alike: disconnecting a Claude subscription is
 * this command on `anthropic`.
 *
 * @category commands
 */
export const DeleteCredential = Rpc.make("models.delete_credential", {
  payload: { providerId: Schema.NonEmptyString },
  error: Schema.Union([UnknownProviderError, CredentialError]),
});

/**
 * Runs a provider's interactive OAuth login, relaying its prompts.
 *
 * The stream drives Pi's `Models.login`: each frame is a {@link LoginEvent},
 * `prompt` frames are answered through {@link AnswerLogin}, and Pi persists
 * the credential itself before the closing `done` frame — after which
 * {@link List} reports the provider configured with `authType: "oauth"`.
 * Ending the stream early aborts the flow and stores nothing. Settings owns
 * every visual; the core owns nothing but the relay.
 *
 * @category commands
 */
export const Login = Rpc.make("models.login", {
  payload: { providerId: Schema.NonEmptyString },
  success: LoginEvent,
  error: Schema.Union([UnknownProviderError, LoginError]),
  stream: true,
});

/**
 * Answers one pending {@link Login} prompt with the user's input.
 *
 * `value` is the entered or pasted string; for a `select` prompt it is the
 * chosen option's id.
 *
 * @category commands
 */
export const AnswerLogin = Rpc.make("models.answer_login", {
  payload: { promptId: Schema.NonEmptyString, value: Schema.String },
  error: UnknownLoginPromptError,
});

/**
 * The request/response command catalog, declared once.
 *
 * Everything else derives from this record: the {@link Rpcs} group, the
 * wire-facing half of {@link Interface}, and the client namespace in
 * `honk-core`. {@link Login} stays outside it because a stream command is not
 * a request/response method; it is added to the group and the interface by
 * hand, the same shape the session domain uses.
 *
 * @category commands
 */
export const commands = {
  list: List,
  setCredential: SetCredential,
  deleteCredential: DeleteCredential,
  answerLogin: AnswerLogin,
};

/**
 * The models command group, derived from {@link commands} plus the
 * {@link Login} stream.
 *
 * @category commands
 */
export class Rpcs extends RpcGroup.make(...Object.values(commands), Login) {}

/**
 * The service the session layer and the RPC handlers share.
 *
 * The wire-facing methods derive from {@link commands}, so the service cannot
 * drift from the wire contract. `collection`, `resolve`, and
 * `resolveAvailable` are service-only additions with no RPC behind them.
 *
 * @category service
 */
export interface Interface extends ServiceOf<typeof commands> {
  /**
   * Pi's collection itself, for harness construction.
   *
   * Sessions hand this to `AgentHarness`, which resolves request auth through
   * it on every model call — so a credential added mid-session applies to the
   * next request without rebuilding anything.
   */
  readonly collection: MutableModels;

  /**
   * Resolves a model reference to the Pi `Model` a harness runs on.
   *
   * Historical resolution is exact and credential-independent: a provider
   * logout does not make its existing transcript unreadable.
   */
  readonly resolve: (ref: ModelRef) => Effect.Effect<Model<Api>, ResolveError>;

  /**
   * Resolves a model that can run with the provider's current credential.
   *
   * Creation, model changes, and delegation use this boundary. Restoration
   * deliberately uses {@link resolve}: a disconnected provider must not make
   * an existing transcript unreadable.
   */
  readonly resolveAvailable: (
    ref?: ModelRef,
  ) => Effect.Effect<
    Model<Api>,
    UnknownProviderError | UnknownModelError | ProviderNotConfiguredError | NoModelError
  >;

  /**
   * The {@link Login} relay as in-process callers consume it: one stream per
   * login attempt. Declared by hand because a stream command is not a
   * request/response method.
   */
  readonly login: (input: {
    readonly providerId: string;
  }) => Stream.Stream<LoginEvent, UnknownProviderError | LoginError>;
}

/**
 * What {@link layer} binds together.
 *
 * The collection and the store arrive as a pair because they are already
 * entangled: production builds `builtinModels({ credentials })`, so the
 * collection resolves auth through the same store this service writes. Passing
 * them separately here keeps the faux seam trivial — tests pass a collection
 * whose providers need no credentials at all.
 *
 * @category layers
 */
export interface LayerOptions {
  readonly collection: MutableModels;
  readonly credentials: CredentialStore;
}

/**
 * Builds the models service over a Pi collection and its credential store.
 *
 * The explicit return type breaks the reference cycle with the {@link Service}
 * class that carries it.
 */
const make = (options: LayerOptions): Effect.Effect<Interface> =>
  Effect.sync(() => {
    const { collection, credentials } = options;

    const resolve = Effect.fnUntraced(function* (ref: ModelRef) {
      if (collection.getProvider(ref.providerId) === undefined) {
        return yield* new UnknownProviderError({ providerId: ref.providerId });
      }
      const model = collection.getModel(ref.providerId, ref.modelId);
      if (model === undefined) {
        return yield* new UnknownModelError({ providerId: ref.providerId, modelId: ref.modelId });
      }
      return model;
    });

    const resolveAvailable = Effect.fnUntraced(function* (ref?: ModelRef) {
      const available = yield* Effect.promise(() => collection.getAvailable(ref?.providerId));
      if (ref === undefined) {
        const first = available[0];
        if (first === undefined) return yield* new NoModelError({});
        return first;
      }
      const model = yield* resolve(ref);
      if (available.some((candidate) => candidate.id === ref.modelId)) return model;
      return yield* new ProviderNotConfiguredError({ providerId: ref.providerId });
    });

    const list = Effect.fnUntraced(function* (_input: Rpc.Payload<typeof List>) {
      const providers: ProviderSummary[] = [];
      for (const provider of collection.getProviders()) {
        // checkAuth reads stored credentials and ambient env without
        // refreshing OAuth, so listing the catalog never touches a network.
        const check = yield* Effect.promise(() => collection.checkAuth(provider.id));
        // A provider is user-configurable by key entry only when Pi's api-key
        // auth carries a login step; ambient-only providers omit it.
        const methods: ("api_key" | "oauth")[] = [];
        if (provider.auth.apiKey?.login !== undefined) methods.push("api_key");
        if (provider.auth.oauth !== undefined) methods.push("oauth");
        // Configured rows are the exact credential-filtered set creation can
        // run. Unconfigured rows retain the full catalog for setup UI.
        const models =
          check === undefined
            ? provider.getModels()
            : yield* Effect.promise(() => collection.getAvailable(provider.id));
        providers.push({
          id: provider.id,
          name: provider.name,
          configured: check !== undefined,
          methods,
          ...(check?.type !== undefined ? { authType: check.type } : {}),
          ...(check?.source !== undefined ? { source: check.source } : {}),
          models: models.map((model) => ({ id: model.id, name: model.name })),
        });
      }
      return { providers } satisfies ListOutput;
    });

    const setCredential = Effect.fnUntraced(function* (input: {
      readonly providerId: string;
      readonly key: string;
    }) {
      if (collection.getProvider(input.providerId) === undefined) {
        return yield* new UnknownProviderError({ providerId: input.providerId });
      }
      // `modify` is Pi's only credential write path; going through it keeps
      // this serialized against any OAuth refresh the collection is running.
      yield* Effect.tryPromise({
        try: () =>
          credentials.modify(
            input.providerId,
            (): Promise<Credential | undefined> =>
              Promise.resolve({ type: "api_key", key: input.key }),
          ),
        catch: (cause) => new CredentialError({ providerId: input.providerId, cause }),
      });
    });

    const deleteCredential = Effect.fnUntraced(function* (input: { readonly providerId: string }) {
      if (collection.getProvider(input.providerId) === undefined) {
        return yield* new UnknownProviderError({ providerId: input.providerId });
      }
      yield* Effect.tryPromise({
        try: () => collection.logout(input.providerId),
        catch: (cause) => new CredentialError({ providerId: input.providerId, cause }),
      });
    });

    // Prompts pending an answer, across every live login attempt. Ids are
    // unguessable and minted per prompt, so one flat map serves all attempts
    // and an answer can never land on another flow's prompt by accident; the
    // attempt tag lets a finalizer sweep only its own flow's entries.
    // `globalThis.Error` because this module's own `Error` union shadows the
    // global type name here.
    const pendingPrompts = new Map<
      string,
      {
        readonly attempt: symbol;
        readonly resolve: (value: string) => void;
        readonly reject: (cause: globalThis.Error) => void;
      }
    >();

    const login = (input: { readonly providerId: string }) =>
      Stream.callback<LoginEvent, UnknownProviderError | LoginError>((queue) =>
        Effect.gen(function* () {
          // Failures travel through the queue: the callback effect runs on a
          // forked fiber, so failing the effect itself would never reach the
          // subscriber.
          if (collection.getProvider(input.providerId) === undefined) {
            yield* Queue.fail(queue, new UnknownProviderError({ providerId: input.providerId }));
            return;
          }

          const attempt = Symbol("models.login");

          const notify = (event: AuthEvent) => {
            Queue.offerUnsafe(queue, toLoginEvent(event));
          };

          const prompt = (request: AuthPrompt) =>
            new Promise<string>((resolve, reject) => {
              // A prompt can arrive already cancelled: Pi races prompts
              // against out-of-band completion, e.g. a localhost callback.
              if (request.signal?.aborted === true) {
                reject(new Error("The login flow cancelled this prompt."));
                return;
              }
              const promptId = crypto.randomUUID();
              pendingPrompts.set(promptId, { attempt, resolve, reject });
              request.signal?.addEventListener(
                "abort",
                () => {
                  pendingPrompts.delete(promptId);
                  reject(new Error("The login flow cancelled this prompt."));
                },
                { once: true },
              );
              Queue.offerUnsafe(queue, toPromptEvent(promptId, request));
            });

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              for (const [promptId, pending] of pendingPrompts) {
                if (pending.attempt !== attempt) continue;
                pendingPrompts.delete(promptId);
                pending.reject(new Error("The login flow ended."));
              }
            }),
          );

          // Pi owns the flow and persists the credential before this promise
          // resolves, so `done` is only ever emitted over a stored credential.
          // The fork is scoped to the stream: a detaching subscriber closes
          // the scope, interruption aborts the signal, and Pi's flow honors
          // the signal by tearing down its callback server.
          yield* Effect.tryPromise({
            try: (signal) =>
              collection.login(input.providerId, "oauth", { signal, notify, prompt }),
            catch: (cause) => new LoginError({ providerId: input.providerId, cause }),
          }).pipe(
            Effect.matchCauseEffect({
              onSuccess: () =>
                Queue.offer(queue, { kind: "done" }).pipe(Effect.andThen(Queue.end(queue))),
              onFailure: (cause) => Queue.failCause(queue, cause),
            }),
            Effect.forkScoped,
          );
        }),
      );

    const answerLogin = Effect.fnUntraced(function* (input: {
      readonly promptId: string;
      readonly value: string;
    }) {
      const pending = pendingPrompts.get(input.promptId);
      if (pending === undefined) {
        return yield* new UnknownLoginPromptError({ promptId: input.promptId });
      }
      pendingPrompts.delete(input.promptId);
      pending.resolve(input.value);
    });

    return {
      collection,
      resolve,
      resolveAvailable,
      list,
      setCredential,
      deleteCredential,
      login,
      answerLogin,
    } satisfies Interface;
  });

/** One Pi notify event as the {@link Login} stream carries it. */
const toLoginEvent = (event: AuthEvent): LoginEvent => {
  switch (event.type) {
    case "auth_url":
      return {
        kind: "open_url",
        url: event.url,
        ...(event.instructions === undefined ? {} : { instructions: event.instructions }),
      };
    case "device_code":
      return {
        kind: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
        ...(event.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: event.expiresInSeconds }),
      };
    case "info":
      return {
        kind: "info",
        message: event.message,
        ...(event.links === undefined
          ? {}
          : {
              links: event.links.map((link) => ({
                url: link.url,
                ...(link.label === undefined ? {} : { label: link.label }),
              })),
            }),
      };
    case "progress":
      return { kind: "progress", message: event.message };
  }
};

/** One Pi prompt as the {@link Login} stream carries it. */
const toPromptEvent = (promptId: string, prompt: AuthPrompt): LoginEvent => ({
  kind: "prompt",
  promptId,
  promptType: prompt.type,
  message: prompt.message,
  ...(prompt.type !== "select" && prompt.placeholder !== undefined
    ? { placeholder: prompt.placeholder }
    : {}),
  ...(prompt.type === "select"
    ? {
        options: prompt.options.map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.description === undefined ? {} : { description: option.description }),
        })),
      }
    : {}),
});

/**
 * The service key and its construction, declared together.
 *
 * @category service
 */
export class Service extends Context.Service<Service, Interface>()("honk/Models", { make }) {}

/**
 * Builds the models service.
 *
 * One instance per host: the session layer and the models RPCs must share it,
 * because both must see the same collection the harnesses stream through.
 *
 * @category layers
 */
export const layer = (options: LayerOptions) => Layer.effect(Service, Service.make(options));

/**
 * Binds the models RPCs to {@link Service}.
 *
 * @category layers
 */
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const models = yield* Service;
    return {
      "models.list": (payload) => models.list(payload),
      "models.set_credential": (payload) => models.setCredential(payload),
      "models.delete_credential": (payload) => models.deleteCredential(payload),
      "models.login": (payload) => models.login(payload),
      "models.answer_login": (payload) => models.answerLogin(payload),
    };
  }),
);

/** Where credentials persist, relative to the host data directory. */
const credentialsFile = "auth.json";

/**
 * Pi's `CredentialStore` over the host data directory.
 *
 * One JSON object keyed by provider id — the ecosystem's `auth.json` shape —
 * beside the trust store and the session transcripts, through the same
 * injected environment, so the core stays platform-free.
 *
 * Every operation queues on one promise chain. Pi's contract demands
 * serialized read-modify-write per provider (its `Models.getAuth` runs OAuth
 * refresh inside `modify` and must not double-refresh); one file written
 * whole makes global serialization the simplest correct implementation.
 * Rejections mean storage failure, which Pi surfaces as `ModelsError` with
 * code "auth" — a missing file is not a failure, just an empty store.
 */
export const credentialStore = (storage: Workspace.ExecutionEnv): CredentialStore => {
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const load = async (): Promise<Record<string, Credential>> => {
    const read = await storage.readTextFile(credentialsFile);
    if (!read.ok) {
      if (read.error.code === "not_found") return {};
      throw read.error;
    }
    return JSON.parse(read.value) as Record<string, Credential>;
  };

  const store = async (map: Record<string, Credential>): Promise<void> => {
    const written = await storage.writeFile(credentialsFile, `${JSON.stringify(map, null, 2)}\n`);
    if (!written.ok) throw written.error;
  };

  return {
    read: (providerId) => enqueue(async () => (await load())[providerId]),
    list: () =>
      enqueue(async () =>
        Object.entries(await load()).map(([providerId, credential]) => ({
          providerId,
          type: credential.type,
        })),
      ),
    modify: (providerId, fn) =>
      enqueue(async () => {
        const map = await load();
        const current = map[providerId];
        const next = await fn(current);
        if (next === undefined) return current;
        map[providerId] = next;
        await store(map);
        return next;
      }),
    delete: (providerId) =>
      enqueue(async () => {
        const map = await load();
        if (!(providerId in map)) return;
        delete map[providerId];
        await store(map);
      }),
  };
};

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Models from "./models";
