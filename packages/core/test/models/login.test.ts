// spec/honk-built-ins.md section 3: subscription auth needs the interactive
// flow — models.login runs Pi's provider-owned login and relays its prompts
// as typed frames, answers flow back by prompt id, and Pi persists the
// credential before the closing done frame, after which list reports the
// provider configured with authType "oauth". These tests drive the relay over
// a stub provider whose flow exercises exactly what Anthropic's does: an
// auth_url notify, one manual_code prompt, a progress notify, a credential.

import type { AuthInteraction, OAuthCredential } from "@earendil-works/pi-ai";
import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Stream } from "effect";

import { Models } from "../../src/models";
import { createTestStorage } from "../../src/testing";

const makeOAuthLayer = (login: (interaction: AuthInteraction) => Promise<OAuthCredential>) => {
  const provider = createProvider({
    id: "anthropic",
    name: "Anthropic",
    auth: {
      oauth: {
        name: "Anthropic (Claude Pro/Max)",
        login,
        refresh: (credential) => Promise.resolve(credential),
        toAuth: (credential) => Promise.resolve({ apiKey: credential.access }),
      },
    },
    models: [],
    api: {
      stream: () => createAssistantMessageEventStream(),
      streamSimple: () => createAssistantMessageEventStream(),
    },
  });
  const credentials = Models.credentialStore(createTestStorage());
  const collection = createModels({ credentials });
  collection.setProvider(provider);
  return Models.layer({ collection, credentials });
};

describe("the login relay", () => {
  it.effect("relays the flow, routes the answer back, and persists the credential", () =>
    Effect.gen(function* () {
      const modelsLayer = makeOAuthLayer(async (interaction) => {
        interaction.notify({
          type: "auth_url",
          url: "https://claude.test/authorize",
          instructions: "Complete login in your browser.",
        });
        const code = await interaction.prompt({
          type: "manual_code",
          message: "Paste the authorization code:",
          placeholder: "code",
        });
        interaction.notify({ type: "progress", message: "Exchanging authorization code..." });
        return {
          type: "oauth",
          refresh: `refresh-${code}`,
          access: `sk-ant-oat01-${code}`,
          expires: Date.now() + 3_600_000,
        };
      });

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;

        const events: Models.LoginEvent[] = [];
        yield* models.login({ providerId: "anthropic" }).pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              events.push(event);
              if (event.kind === "prompt") {
                expect(event.promptType).toBe("manual_code");
                yield* models.answerLogin({ promptId: event.promptId, value: "the-code" });
              }
            }),
          ),
        );

        expect(events.map((event) => event.kind)).toEqual([
          "open_url",
          "prompt",
          "progress",
          "done",
        ]);
        expect(events[0]).toMatchObject({ url: "https://claude.test/authorize" });

        // Pi persisted the credential before done, so the settings read now
        // reports the provider configured over OAuth.
        const { providers } = yield* models.list({});
        const anthropic = providers.find((provider) => provider.id === "anthropic");
        expect(anthropic?.configured).toBe(true);
        expect(anthropic?.authType).toBe("oauth");
        expect(anthropic?.methods).toEqual(["oauth"]);
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );

  it.effect("fails typed when the provider flow rejects", () =>
    Effect.gen(function* () {
      const modelsLayer = makeOAuthLayer(() =>
        Promise.reject(new Error("the callback server never heard back")),
      );

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;
        const refused = yield* models
          .login({ providerId: "anthropic" })
          .pipe(Stream.runDrain, Effect.flip);
        expect(refused).toBeInstanceOf(Models.LoginError);
        if (refused instanceof Models.LoginError) {
          expect(refused.code).toBe("models.login_failed");
          expect(refused.providerId).toBe("anthropic");
        }

        // A failed login stored nothing.
        const { providers } = yield* models.list({});
        expect(providers.find((provider) => provider.id === "anthropic")?.configured).toBe(false);
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );

  it.effect("fails typed on a provider the collection lacks", () =>
    Effect.gen(function* () {
      const modelsLayer = makeOAuthLayer(() => Promise.reject(new Error("unreachable")));

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;
        const refused = yield* models
          .login({ providerId: "no-such-provider" })
          .pipe(Stream.runDrain, Effect.flip);
        expect(refused).toBeInstanceOf(Models.UnknownProviderError);
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );

  it.effect("aborts the flow when the subscriber detaches early", () =>
    Effect.gen(function* () {
      let sawAbort = false;
      const modelsLayer = makeOAuthLayer(
        (interaction) =>
          new Promise((_resolve, reject) => {
            interaction.notify({ type: "auth_url", url: "https://claude.test/authorize" });
            interaction.signal?.addEventListener("abort", () => {
              sawAbort = true;
              reject(new Error("login aborted"));
            });
          }),
      );

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;
        // Take only the first frame: ending the subscription is cancellation.
        const first = yield* models
          .login({ providerId: "anthropic" })
          .pipe(Stream.take(1), Stream.runCollect);
        expect(first.map((event) => event.kind)).toEqual(["open_url"]);
        expect(sawAbort).toBe(true);
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );

  it.effect("a detaching flow sweeps only its own pending prompt", () =>
    Effect.gen(function* () {
      const oauth = {
        name: "stub",
        login: (interaction: AuthInteraction) =>
          interaction
            .prompt({ type: "manual_code", message: "Paste the authorization code:" })
            .then(
              (code): OAuthCredential => ({
                type: "oauth",
                refresh: `refresh-${code}`,
                access: `sk-ant-oat01-${code}`,
                expires: Date.now() + 3_600_000,
              }),
            ),
        refresh: (credential: OAuthCredential) => Promise.resolve(credential),
        toAuth: (credential: OAuthCredential) => Promise.resolve({ apiKey: credential.access }),
      };
      const api = {
        stream: () => createAssistantMessageEventStream(),
        streamSimple: () => createAssistantMessageEventStream(),
      };
      const credentials = Models.credentialStore(createTestStorage());
      const collection = createModels({ credentials });
      collection.setProvider(
        createProvider({ id: "anthropic", name: "Anthropic", auth: { oauth }, models: [], api }),
      );
      collection.setProvider(
        createProvider({ id: "other", name: "Other", auth: { oauth }, models: [], api }),
      );
      const modelsLayer = Models.layer({ collection, credentials });

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;

        // The surviving flow stays subscribed on its own fiber; capture its
        // prompt id so it can be answered after the other flow detaches.
        const survivorPrompt = yield* Deferred.make<string>();
        const survivor = yield* models.login({ providerId: "other" }).pipe(
          Stream.runForEach((event) =>
            event.kind === "prompt"
              ? Deferred.succeed(survivorPrompt, event.promptId)
              : Effect.void,
          ),
          Effect.forkChild,
        );
        const survivorId = yield* Deferred.await(survivorPrompt);

        // The detaching flow ends after its prompt frame, sweeping its entry.
        const frames = yield* models
          .login({ providerId: "anthropic" })
          .pipe(Stream.take(1), Stream.runCollect);
        const [frame] = frames;
        if (frame?.kind !== "prompt") throw new Error("expected a prompt frame");

        const refused = yield* models
          .answerLogin({ promptId: frame.promptId, value: "anything" })
          .pipe(Effect.flip);
        expect(refused).toBeInstanceOf(Models.UnknownLoginPromptError);

        // The survivor's prompt was untouched and completes its login.
        yield* models.answerLogin({ promptId: survivorId, value: "the-code" });
        yield* Fiber.join(survivor);
        const { providers } = yield* models.list({});
        expect(providers.find((provider) => provider.id === "other")?.configured).toBe(true);
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );

  it.effect("refuses an answer to a prompt nothing is waiting on", () =>
    Effect.gen(function* () {
      const modelsLayer = makeOAuthLayer(() => Promise.reject(new Error("unreachable")));

      const program = Effect.gen(function* () {
        const models = yield* Models.Service;
        const refused = yield* models
          .answerLogin({ promptId: "never-minted", value: "anything" })
          .pipe(Effect.flip);
        expect(refused).toBeInstanceOf(Models.UnknownLoginPromptError);
        expect(refused.code).toBe("models.unknown_login_prompt");
      });

      yield* program.pipe(Effect.provide(modelsLayer));
    }),
  );
});
