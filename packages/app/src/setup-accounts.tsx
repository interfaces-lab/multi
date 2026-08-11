// The coding-accounts step of /setup. Honk Core owns provider discovery,
// credentials, and sign-in. This step renders the shared model catalog and a
// step-owned sign-in store in onboarding's scene instead of keeping a second
// authentication state machine.

import * as stylex from "@stylexjs/stylex";
import { Badge, Button, Spinner, Text } from "@honk/ui";
import { IconUserKey } from "@honk/ui/icons";
import { spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { HonkClient } from "@honk/core";

import { useHonkCore } from "./chat/client";
import { refreshCatalog, useCatalogPhase } from "./chat/model-catalog";
import { createProviderAuthStore } from "./provider-auth";
import { accountProviderRows, ProviderFlowPanel } from "./settings-providers";
import { SetupFooter, SetupPanel, SetupRow, SetupScene } from "./setup-scene";

const styles = stylex.create({
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
});

function LoadingAccountsRow(): React.ReactElement {
  return (
    <div {...stylex.props(styles.actions)} role="status">
      <Spinner size="sm" />
      <Text size="sm" tone="muted">
        Loading accounts…
      </Text>
    </div>
  );
}

export function SetupAccountsStep({
  onBack,
  onContinue,
}: {
  readonly onBack: () => void;
  readonly onContinue: () => void;
}): React.ReactElement {
  const core = useHonkCore();
  return (
    <SetupScene
      icon={IconUserKey}
      title="Coding accounts"
      description="Connect the accounts Honk can use to run models. You can skip this and connect them later in Settings."
    >
      {core.status === "ready" ? (
        <SetupAccountsBody client={core.client} onBack={onBack} onContinue={onContinue} />
      ) : (
        <>
          <SetupPanel label="Coding accounts">
            {core.status === "connecting" ? (
              <LoadingAccountsRow />
            ) : (
              // No retry: an absent core endpoint is terminal for this host.
              <SetupRow
                title="Accounts unavailable"
                description="Honk Core is not available in this host."
                control={null}
              />
            )}
          </SetupPanel>
          <SetupFooter onBack={onBack} onNext={onContinue} nextLabel="Skip for now" />
        </>
      )}
    </SetupScene>
  );
}

function SetupAccountsBody({
  client,
  onBack,
  onContinue,
}: {
  readonly client: HonkClient;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}): React.ReactElement {
  // The step retains its store while mounted. Releasing the last owner
  // cancels any live login stream.
  const [store] = React.useState(() => createProviderAuthStore(client));
  React.useEffect(() => store.retain(), [store]);
  const state = React.useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const catalog = useCatalogPhase();
  const flowActive = state.flow !== null;

  // Credentials change behind the app's back (terminal logins, keys added
  // elsewhere), so re-check when this step opens.
  React.useEffect(() => {
    void refreshCatalog();
  }, []);

  const errorLine = state.error ?? (catalog.status === "ready" ? catalog.error : null);

  return (
    <>
      <SetupPanel label="Coding accounts">
        {catalog.status === "loading" ? <LoadingAccountsRow /> : null}
        {catalog.status === "failed" ? (
          <SetupRow
            title="Accounts unavailable"
            description={catalog.message}
            control={
              <Button
                size="sm"
                variant="neutral"
                onClick={() => {
                  void refreshCatalog();
                }}
              >
                Try again
              </Button>
            }
          />
        ) : null}
        {catalog.status === "ready"
          ? accountProviderRows(catalog.providers).map((provider) => (
              <SetupRow
                key={provider.id}
                title={provider.name}
                description={
                  provider.configured && provider.source !== undefined
                    ? provider.source
                    : provider.methods.includes("oauth") && provider.methods.includes("api_key")
                      ? "Connect with sign-in or an API key."
                      : provider.methods.includes("oauth")
                        ? "Connect with sign-in."
                        : "Connect with an API key."
                }
                control={
                  <div {...stylex.props(styles.actions)}>
                    <Badge tone={provider.configured ? "ok" : "neutral"}>
                      {provider.configured ? "Connected" : "Not connected"}
                    </Badge>
                    {provider.methods.includes("oauth") ? (
                      <Button
                        size="sm"
                        variant="neutral"
                        disabled={flowActive}
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
                        disabled={flowActive}
                        onClick={() => {
                          store.beginApiKey(provider.id);
                        }}
                      >
                        Add API key
                      </Button>
                    ) : null}
                  </div>
                }
              />
            ))
          : null}
      </SetupPanel>
      <ProviderFlowPanel flow={state.flow} store={store} />
      {errorLine === null ? null : (
        <Text as="p" role="alert" size="sm" tone="err">
          {errorLine}
        </Text>
      )}
      <SetupFooter
        onBack={onBack}
        onNext={onContinue}
        nextLabel={
          catalog.status === "ready" && catalog.providers.some((provider) => provider.configured)
            ? "Next"
            : "Skip for now"
        }
      />
    </>
  );
}
