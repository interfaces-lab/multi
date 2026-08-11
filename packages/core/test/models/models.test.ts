// spec/core.md section 11: the core persists credentials so Pi can call a
// provider, exposes the catalog with auth status, and stores the selected
// model on the session — as Pi's own model_change transcript entry. These
// tests prove the store round-trips through the data directory, the service
// answers typed, and a session's model survives being chosen.

import { createModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Models } from "../../src/models";
import { Session } from "../../src/session";
import { createTestStorage, makeFauxSessionLayer, openTrustedWorkspace } from "../../src/testing";

describe("the credential store", () => {
  it("persists credentials to auth.json and reads them back", async () => {
    const storage = createTestStorage();
    const store = Models.credentialStore(storage);

    await store.modify("anthropic", () =>
      Promise.resolve({ type: "api_key" as const, key: "sk-test" }),
    );

    // The write landed in auth.json under the data directory, not in memory:
    // a store constructed fresh over the same environment sees it.
    const raw = await storage.readTextFile("auth.json");
    expect(raw.ok && raw.value).toContain("sk-test");
    const reopened = Models.credentialStore(storage);
    expect(await reopened.read("anthropic")).toEqual({ type: "api_key", key: "sk-test" });

    // list is the status read: provider and type, never the secret.
    expect(await reopened.list()).toEqual([{ providerId: "anthropic", type: "api_key" }]);
  });

  it("treats an undefined modify result as leave-unchanged", async () => {
    const store = Models.credentialStore(createTestStorage());
    await store.modify("anthropic", () =>
      Promise.resolve({ type: "api_key" as const, key: "sk-original" }),
    );

    const settled = await store.modify("anthropic", () => Promise.resolve(undefined));
    expect(settled).toEqual({ type: "api_key", key: "sk-original" });
    expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "sk-original" });
  });

  it("deletes a credential and answers undefined afterwards", async () => {
    const storage = createTestStorage();
    const store = Models.credentialStore(storage);
    await store.modify("anthropic", () =>
      Promise.resolve({ type: "api_key" as const, key: "sk-gone" }),
    );

    await store.delete("anthropic");

    expect(await Models.credentialStore(storage).read("anthropic")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("starts empty when no auth.json exists", async () => {
    const store = Models.credentialStore(createTestStorage());
    expect(await store.read("anthropic")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });
});

describe("the models service", () => {
  it.effect("lists the catalog with auth status", () =>
    Effect.gen(function* () {
      const { modelsLayer, model } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;
        const { providers } = yield* models.list({});
        const faux = providers.find((provider) => provider.id === "faux");
        // The faux provider's auth always resolves, so it reports configured
        // with an empty credential store — the keyless-provider contract.
        expect(faux?.configured).toBe(true);
        expect(faux?.models.map((entry) => entry.id)).toContain(model.id);
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );

  it.effect("refuses a credential for a provider the collection lacks", () =>
    Effect.gen(function* () {
      const { modelsLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;
        const refused = yield* models
          .setCredential({ providerId: "no-such-provider", key: "sk-anything" })
          .pipe(Effect.flip);
        expect(refused).toBeInstanceOf(Models.UnknownProviderError);
        expect(refused.code).toBe("models.unknown_provider");
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );

  it.effect("keeps OpenAI Platform and Codex credentials distinct", () =>
    Effect.gen(function* () {
      const credentials = Models.credentialStore(createTestStorage());
      yield* Effect.promise(() =>
        credentials.modify("openai-codex", () =>
          Promise.resolve({
            type: "oauth",
            access: "codex-access",
            refresh: "codex-refresh",
            expires: 0,
          }),
        ),
      );
      const collection = builtinModels({
        credentials,
        authContext: {
          env: () => Promise.resolve(undefined),
          fileExists: () => Promise.resolve(false),
        },
      });
      const modelsLayer = Models.layer({ collection, credentials });

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;
        const codex = yield* models.resolveAvailable({
          providerId: "openai-codex",
          modelId: "gpt-5.6-sol",
        });
        expect(codex.provider).toBe("openai-codex");

        const platform = yield* models
          .resolveAvailable({ providerId: "openai", modelId: "gpt-5.6-sol" })
          .pipe(Effect.flip);
        if (!(platform instanceof Models.ProviderNotConfiguredError)) {
          throw new Error("expected the unconfigured Platform provider to be refused");
        }
        expect(platform.code).toBe("models.provider_not_configured");
        expect(platform.providerId).toBe("openai");
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );

  it.effect("lists only models the current credential can run", () =>
    Effect.gen(function* () {
      const storage = createTestStorage();
      const credentials = Models.credentialStore(storage);
      const collection = createModels();
      const faux = fauxProvider();
      collection.setProvider({
        ...faux.provider,
        filterModels: () => [],
      });
      const modelsLayer = Models.layer({ collection, credentials });

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;
        const listed = yield* models.list({});
        const provider = listed.providers.find((candidate) => candidate.id === "faux");

        expect(provider?.configured).toBe(true);
        expect(provider?.models).toEqual([]);
        const refused = yield* models
          .resolveAvailable({ providerId: "faux", modelId: faux.getModel().id })
          .pipe(Effect.flip);
        expect(refused).toBeInstanceOf(Models.ProviderNotConfiguredError);
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );
});

describe("the session's model", () => {
  it.effect("records the resolved default as a model_change entry at create", () =>
    Effect.gen(function* () {
      const { faux, appLayer, model } = makeFauxSessionLayer();
      faux.setResponses([fauxAssistantMessage("hello")]);

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-models-default");

        const { id } = yield* session.create({ workspaceId: workspace.id });
        const state = yield* session.reload({ sessionId: id });

        // The default was resolved and made durable from birth: the entry is
        // what restoration reads after a restart, so an unnamed choice must
        // still be a recorded one.
        const changes = state.entries.filter((entry) => entry.type === "model_change");
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ provider: model.provider, modelId: model.id });
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("creates on an explicitly chosen model", () =>
    Effect.gen(function* () {
      const { appLayer, model } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-models-explicit");

        const { id } = yield* session.create({
          workspaceId: workspace.id,
          model: { providerId: model.provider, modelId: model.id },
        });
        const state = yield* session.reload({ sessionId: id });
        expect(state.entries[0]).toMatchObject({
          type: "model_change",
          provider: model.provider,
          modelId: model.id,
        });
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("refuses to create on a model the catalog lacks", () =>
    Effect.gen(function* () {
      const { appLayer } = makeFauxSessionLayer();

      const program = Effect.gen(function* () {
        const session = yield* Session.Service;
        const workspace = yield* openTrustedWorkspace("/tmp/honk-models-unknown");

        const refused = yield* session
          .create({
            workspaceId: workspace.id,
            model: { providerId: "faux", modelId: "no-such-model" },
          })
          .pipe(Effect.flip);
        expect(refused).toBeInstanceOf(Models.UnknownModelError);

        // Fail-fast contract: a refused create leaves no orphan transcript.
        const { sessions } = yield* session.list({});
        expect(sessions).toHaveLength(0);
      });

      yield* program.pipe(Effect.provide(appLayer));
    }),
  );

  it.effect("answers no_model when nothing is configured", () =>
    Effect.gen(function* () {
      // A collection with no providers at all: the honest answer to "pick a
      // default" is the typed product state, not a crash.
      const storage = createTestStorage();
      const empty = createModels();
      const modelsLayer = Models.layer({
        collection: empty,
        credentials: Models.credentialStore(storage),
      });

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;
        const refused = yield* models.resolveAvailable().pipe(Effect.flip);
        expect(refused).toBeInstanceOf(Models.NoModelError);
        expect(refused.code).toBe("models.no_model");
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );
});
