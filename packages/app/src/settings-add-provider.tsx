// The long tail of the provider catalog, disclosed inline from the Accounts
// panel's "Add provider" action: pick a provider, then paste its key. Inline
// rather than a nested dialog — the panel already discloses row credential
// entry in place, and a third card over the settings window would bury the
// list the user is choosing from. The key field only exists once a provider is
// chosen, so the form never offers a control with no target. TanStack Form
// holds the field state; every rendered control is @honk/ui. Saving goes
// through the panel's provider-auth store so a success lands in the shared
// catalog and the new provider renders as a configured row.

import * as stylex from "@stylexjs/stylex";
import { Button, Field, Picker, Spinner, Text } from "@honk/ui";
import { controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import { useForm } from "@tanstack/react-form";
import * as React from "react";

import type { Models } from "@honk/core/models";

import { describeError } from "./chat/client";

const styles = stylex.create({
  form: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
    outline: "none",
  },
  // The picker trigger caps at the shared picker measure. The key field takes
  // the same cap so the two controls share one width instead of two.
  controls: {
    alignSelf: "stretch",
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    maxWidth: controlVars["--honk-control-picker-max-w"],
  },
  actions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
  },
});

export function AddProviderForm(props: {
  readonly providers: readonly Models.ProviderSummary[];
  readonly onSave: (providerId: string, key: string) => Promise<void>;
  readonly onClose: () => void;
}): React.ReactElement {
  const [error, setError] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const form = useForm({
    defaultValues: { providerId: "", key: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await props.onSave(value.providerId, value.key.trim());
        props.onClose();
      } catch (cause) {
        setError(describeError(cause));
      }
    },
  });

  // Opening the form disables the action that opened it, so focus would fall to
  // the document. Move it into the form instead; Tab then reaches the picker.
  React.useEffect(() => {
    formRef.current?.focus();
  }, []);

  const nameFor = (providerId: string): string | undefined =>
    props.providers.find((provider) => provider.id === providerId)?.name;

  return (
    <form
      ref={formRef}
      tabIndex={-1}
      aria-label="Add provider"
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Text size="sm" weight="regular">
        Connect any other provider with an API key.
      </Text>
      <div {...stylex.props(styles.controls)}>
        <form.Field name="providerId">
          {(field) => (
            <Picker.Root value={field.state.value} onValueChange={field.handleChange}>
              <Picker.Trigger accessibilityLabel="Provider">
                {nameFor(field.state.value) ?? "Choose a provider"}
              </Picker.Trigger>
              <Picker.Popup label="Provider" layer="dialog" align="start">
                {props.providers.map((provider) => (
                  <Picker.Option key={provider.id} value={provider.id} label={provider.name} />
                ))}
              </Picker.Popup>
            </Picker.Root>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.providerId}>
          {(providerId) =>
            providerId === "" ? null : (
              <form.Field name="key">
                {(field) => (
                  <Field>
                    <Field.Input
                      autoFocus
                      aria-label={`${nameFor(providerId) ?? "Provider"} API key`}
                      type="password"
                      placeholder="API key"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.currentTarget.value);
                      }}
                    />
                  </Field>
                )}
              </form.Field>
            )
          }
        </form.Subscribe>
      </div>
      {error === null ? null : (
        <Text as="p" role="alert" size="sm" tone="err">
          {error}
        </Text>
      )}
      <div {...stylex.props(styles.actions)}>
        <form.Subscribe
          selector={(state) => ({
            pending: state.isSubmitting,
            chosen: state.values.providerId !== "",
            keyed: state.values.key.trim().length > 0,
          })}
        >
          {({ pending, chosen, keyed }) => (
            <>
              {chosen ? (
                <Button type="submit" variant="primary" disabled={pending || !keyed}>
                  Add provider
                </Button>
              ) : null}
              <Button type="button" variant="quiet" disabled={pending} onClick={props.onClose}>
                Cancel
              </Button>
              {pending ? <Spinner size="sm" /> : null}
            </>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
