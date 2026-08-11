import * as stylex from "@stylexjs/stylex";
import { Badge, Button, Field, Spinner, Text } from "@honk/ui";
import { colorVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { HonkClient } from "@honk/core";
import type { Models } from "@honk/core/models";

import { useHonkCore } from "./chat/client";
import { refreshCatalog, useCatalogPhase } from "./chat/model-catalog";
import { openDesktopExternal } from "./desktop-bridge";
import {
  createProviderAuthStore,
  type LoginNotice,
  type LoginPrompt,
  type ProviderAuthStore,
  type ProviderFlow,
} from "./provider-auth";
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-controls";
import { SettingsNote, SettingsStatus } from "./settings-inventory";

const DeferredAddProviderForm = React.lazy(() =>
  import("./settings-add-provider").then((module) => ({ default: module.AddProviderForm })),
);

const SECTION_DESCRIPTION = "Honk uses these accounts to run models.";

// Product curation: the accounts surfaces lead with these providers, in this
// order. Ids verified against core's builtinModels catalog — zai is Z.AI's
// GLM coding plan, kimi-coding is "Kimi For Coding".
export const DEFAULT_ACCOUNT_PROVIDERS: readonly string[] = [
  "zai",
  "kimi-coding",
  "anthropic",
  "openai-codex",
];

/**
 * What the accounts surfaces render instead of the full catalog wall: the
 * curated defaults in declared order, then any other provider that is
 * already configured — so a provider added via the dialog stays visible and
 * can be signed out.
 */
export function accountProviderRows(
  providers: readonly Models.ProviderSummary[],
): readonly Models.ProviderSummary[] {
  const defaults = DEFAULT_ACCOUNT_PROVIDERS.flatMap((id) => {
    const match = providers.find((provider) => provider.id === id);
    return match === undefined ? [] : [match];
  });
  const extras = providers.filter(
    (provider) => provider.configured && !DEFAULT_ACCOUNT_PROVIDERS.includes(provider.id),
  );
  return [...defaults, ...extras];
}

const styles = stylex.create({
  flow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
  },
  form: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
  },
  actions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
  },
  link: {
    color: colorVars["--honk-color-text-primary"],
    textDecorationLine: "underline",
    overflowWrap: "anywhere",
  },
});

// Desktop routes external URLs through the shell; web falls back to a new tab.
function openExternalUrl(url: string): void {
  void openDesktopExternal(url).then((opened) => {
    if (!opened) window.open(url, "_blank", "noopener,noreferrer");
  });
}

function ExternalLink(props: {
  readonly url: string;
  readonly label?: string;
}): React.ReactElement {
  return (
    <a
      href={props.url}
      {...stylex.props(styles.link)}
      onClick={(event) => {
        event.preventDefault();
        openExternalUrl(props.url);
      }}
    >
      {props.label ?? props.url}
    </a>
  );
}

function ValueForm(props: {
  readonly label: string;
  readonly placeholder?: string;
  readonly secret?: boolean;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = React.useState("");
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit(value);
      }}
    >
      <Text size="sm" weight="regular">
        {props.label}
      </Text>
      <Field>
        <Field.Input
          autoFocus
          aria-label={props.label}
          type={props.secret === true ? "password" : "text"}
          value={value}
          disabled={props.busy}
          {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
          onChange={(event) => {
            setValue(event.currentTarget.value);
          }}
        />
      </Field>
      <div {...stylex.props(styles.actions)}>
        <Button type="submit" variant="primary" disabled={props.busy || value.trim().length === 0}>
          {props.submitLabel}
        </Button>
        <Button type="button" variant="quiet" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </Button>
        {props.busy ? <Spinner size="sm" /> : null}
      </div>
    </form>
  );
}

function NoticeLine({ notice }: { readonly notice: LoginNotice }): React.ReactElement {
  if (notice.kind === "open_url") {
    return (
      <Text as="p" size="sm">
        {notice.instructions === undefined
          ? "Open this link to continue: "
          : `${notice.instructions} `}
        <ExternalLink url={notice.url} />
      </Text>
    );
  }
  if (notice.kind === "device_code") {
    return (
      <Text as="p" size="sm">
        Enter code{" "}
        <Text as="span" family="mono">
          {notice.userCode}
        </Text>{" "}
        at <ExternalLink url={notice.verificationUri} />
      </Text>
    );
  }
  if (notice.kind === "info") {
    return (
      <Text as="p" size="sm">
        {notice.message}
        {notice.links?.map((link) => (
          <React.Fragment key={link.url}>
            {" "}
            <ExternalLink
              url={link.url}
              {...(link.label === undefined ? {} : { label: link.label })}
            />
          </React.Fragment>
        ))}
      </Text>
    );
  }
  return (
    <Text as="p" size="sm" tone="muted">
      {notice.message}
    </Text>
  );
}

function PromptPanel({
  prompt,
  answering,
  store,
}: {
  readonly prompt: LoginPrompt;
  readonly answering: boolean;
  readonly store: ProviderAuthStore;
}): React.ReactElement {
  if (prompt.promptType === "select") {
    return (
      <div {...stylex.props(styles.flow)}>
        <Text size="sm" weight="regular">
          {prompt.message}
        </Text>
        <div {...stylex.props(styles.actions)}>
          {prompt.options?.map((option) => (
            <Button
              key={option.id}
              variant="neutral"
              disabled={answering}
              onClick={() => {
                void store.answerPrompt(option.id);
              }}
            >
              {option.label}
            </Button>
          ))}
          <Button variant="quiet" disabled={answering} onClick={store.cancel}>
            Cancel
          </Button>
          {answering ? <Spinner size="sm" /> : null}
        </div>
      </div>
    );
  }
  return (
    <ValueForm
      key={prompt.promptId}
      label={prompt.message}
      secret={prompt.promptType === "secret"}
      {...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder })}
      submitLabel="Continue"
      busy={answering}
      onSubmit={(value) => {
        void store.answerPrompt(value);
      }}
      onCancel={store.cancel}
    />
  );
}

export function ProviderFlowPanel({
  flow,
  store,
}: {
  readonly flow: ProviderFlow | null;
  readonly store: ProviderAuthStore;
}): React.ReactElement | null {
  if (flow === null) return null;
  if (flow.kind === "api-key") {
    return (
      <ValueForm
        label="API key"
        secret
        submitLabel="Save API key"
        busy={flow.saving}
        onSubmit={(value) => {
          void store.submitApiKey(value);
        }}
        onCancel={store.cancel}
      />
    );
  }
  if (flow.kind === "signing-out") {
    return (
      <div {...stylex.props(styles.actions)}>
        <Spinner size="sm" />
        <Text size="sm" tone="muted">
          Signing out…
        </Text>
      </div>
    );
  }
  return (
    <div {...stylex.props(styles.flow)}>
      {flow.notices.length === 0 && flow.prompt === null ? (
        <div {...stylex.props(styles.actions)}>
          <Spinner size="sm" />
          <Text size="sm" tone="muted">
            Starting sign-in…
          </Text>
        </div>
      ) : null}
      {flow.notices.map((notice, index) => (
        // Notices are append-only for the flow's lifetime, so the index is stable.
        <NoticeLine key={index} notice={notice} />
      ))}
      {flow.prompt === null ? (
        <Button variant="quiet" onClick={store.cancel}>
          Cancel
        </Button>
      ) : (
        <PromptPanel prompt={flow.prompt} answering={flow.answering} store={store} />
      )}
    </div>
  );
}

export function SettingsProviders(): React.ReactElement {
  const core = useHonkCore();
  if (core.status === "connecting") {
    return (
      <SettingsSection description={SECTION_DESCRIPTION}>
        <SettingsStatus>Connecting to Honk Core…</SettingsStatus>
      </SettingsSection>
    );
  }
  if (core.status === "unavailable") {
    return (
      <SettingsSection description={SECTION_DESCRIPTION}>
        <SettingsNote>Honk Core is not available in this host.</SettingsNote>
      </SettingsSection>
    );
  }
  return <ProvidersPanel client={core.client} />;
}

function ProvidersPanel({ client }: { readonly client: HonkClient }): React.ReactElement {
  // The panel retains its store while mounted. Releasing the last owner
  // cancels any live login stream, so OAuth does not survive closing the overlay.
  const [store] = React.useState(() => createProviderAuthStore(client));
  React.useEffect(() => store.retain(), [store]);
  const state = React.useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const catalog = useCatalogPhase();
  const [adding, setAdding] = React.useState(false);
  // One credential form at a time: a live login flow and the add form both own
  // the panel's focus and its single error line.
  const busy = state.flow !== null || adding;
  const rows = catalog.status === "ready" ? accountProviderRows(catalog.providers) : [];

  // Credentials change behind the app's back (terminal logins, keys added
  // elsewhere), so re-check when the Accounts surface opens.
  React.useEffect(() => {
    void refreshCatalog();
  }, []);

  const errorLine = state.error ?? (catalog.status === "ready" ? catalog.error : null);

  return (
    <SettingsSection
      description={SECTION_DESCRIPTION}
      action={
        <Button
          size="sm"
          variant="neutral"
          disabled={busy || catalog.status !== "ready"}
          onClick={() => {
            setAdding(true);
          }}
        >
          Add provider
        </Button>
      }
    >
      {catalog.status === "loading" ? <SettingsStatus>Loading accounts…</SettingsStatus> : null}
      {catalog.status === "failed" ? (
        <div {...stylex.props(styles.actions)}>
          <Text as="p" role="alert" size="sm" tone="err">
            {catalog.message}
          </Text>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              void refreshCatalog();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {catalog.status === "ready" ? (
        <SettingsRows>
          {rows.map((provider) => (
            <SettingsRow
              key={provider.id}
              title={provider.name}
              {...(provider.configured && provider.source !== undefined
                ? { description: provider.source }
                : {})}
              control={
                <div {...stylex.props(styles.actions)}>
                  <Badge tone={provider.configured ? "ok" : "neutral"}>
                    {provider.configured ? "Connected" : "Not connected"}
                  </Badge>
                  {provider.methods.includes("oauth") ? (
                    <Button
                      size="sm"
                      variant="neutral"
                      disabled={busy}
                      onClick={() => {
                        store.beginOauth(provider.id);
                      }}
                    >
                      Sign in
                    </Button>
                  ) : null}
                  {provider.methods.includes("api_key") ? (
                    <Button
                      size="sm"
                      variant="neutral"
                      disabled={busy}
                      onClick={() => {
                        store.beginApiKey(provider.id);
                      }}
                    >
                      Add API key
                    </Button>
                  ) : null}
                  {provider.configured ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy}
                      onClick={() => {
                        void store.signOut(provider.id);
                      }}
                    >
                      Sign out
                    </Button>
                  ) : null}
                </div>
              }
            />
          ))}
        </SettingsRows>
      ) : null}
      <ProviderFlowPanel flow={state.flow} store={store} />
      {adding && catalog.status === "ready" ? (
        <React.Suspense fallback={<SettingsStatus>Loading provider form…</SettingsStatus>}>
          <DeferredAddProviderForm
            providers={catalog.providers
              .filter((provider) => !rows.includes(provider))
              .toSorted((a, b) => a.name.localeCompare(b.name))}
            onSave={store.saveCredential}
            onClose={() => {
              setAdding(false);
            }}
          />
        </React.Suspense>
      ) : null}
      {errorLine === null ? null : (
        <Text as="p" role="alert" size="sm" tone="err">
          {errorLine}
        </Text>
      )}
    </SettingsSection>
  );
}
