import type { DesktopUpdateState } from "@honk/shared/desktop-api";
import { Button, Icon, IconButton, Picker, Switch, Text, Tooltip } from "@honk/ui";
import { IconClipboard, IconComputerUse, IconFolder1, IconFolderOpen } from "@honk/ui/icons";
import { colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import {
  actions as appSettingsActions,
  getSnapshot as getAppSettingsSnapshot,
  useAppSettings,
} from "./app-settings-store";
import { deleteCustomAlertSound, playAlertSound, saveCustomAlertSound } from "./completion-sound";
import { DEFAULT_ALERT_SOUND, type AlertSoundName } from "./alert-sound-model";
import { useHonkDesktopSettings } from "./desktop-extensions/runtime";
import {
  canShowItemInFolder,
  pickFolder,
  readDesktopRemoteAccessAvailability,
  showItemInFolder,
} from "./desktop-bridge";
import { errorMessage } from "./error-message";
import {
  buildNotificationSettingsSupportText,
  requestBrowserNotificationPermission,
  useNotificationPermission,
} from "./notification-permission";
import {
  SettingResetButton,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "./settings-controls";
import { DesktopSettingsToggleRow } from "./settings-desktop-toggle";
import { actions as toastActions } from "./toast-store";
import { updatePillActions, useUpdatePill } from "./update-pill";

const DeferredConnectPhoneDialog = React.lazy(() =>
  import("./connect-phone").then((module) => ({ default: module.ConnectPhoneDialog })),
);

const UPDATE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const ALERT_SOUND_OPTIONS: readonly {
  value: AlertSoundName;
  label: string;
  description: string;
}[] = [
  { value: "ready", label: "Ready", description: "Focused tone with a soft bloom." },
  { value: "chime", label: "Chime", description: "Soft two-note bell." },
];

const styles = stylex.create({
  hiddenFileInput: {
    display: "none",
  },
  location: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: controlVars["--honk-control-pad-sm"],
  },
  locationHeader: {
    display: "flex",
    flexDirection: {
      default: "column",
      "@media (min-width: 720px)": "row",
    },
    alignItems: {
      default: "stretch",
      "@media (min-width: 720px)": "center",
    },
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
  },
  locationCopy: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
  locationControls: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
  },
  resetSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: controlVars["--honk-control-h-sm"],
    height: controlVars["--honk-control-h-sm"],
    flexShrink: 0,
  },
  locationPanel: {
    minHeight: controlVars["--honk-control-h-lg"],
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  locationPath: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    flexGrow: 1,
    overflow: "hidden",
  },
  pathActions: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
  },
});

function ConnectPhoneSettingsRow(props: {
  readonly availability: "ready" | "restart-required";
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const ready = props.availability === "ready";
  return (
    <>
      <SettingsRow
        title="Connect phone"
        description={
          ready
            ? "Reach this computer securely from Honk mobile through Tailscale."
            : "Restart Honk to load phone pairing, then scan the code with Honk mobile."
        }
        control={
          ready ? (
            <Button
              size="sm"
              iconStart={<Icon icon={IconComputerUse} size="sm" />}
              onClick={() => setOpen(true)}
            >
              Show code…
            </Button>
          ) : (
            <Text size="sm" tone="warn">
              Restart required
            </Text>
          )
        }
      />
      {ready && open ? (
        <React.Suspense fallback={null}>
          <DeferredConnectPhoneDialog open onClose={() => setOpen(false)} />
        </React.Suspense>
      ) : null}
    </>
  );
}

export function SettingsGeneral(): React.ReactElement {
  const appSettings = useAppSettings();
  const alertSoundInputRef = React.useRef<HTMLInputElement>(null);
  const directory = appSettings.defaultProjectDirectory;
  const desktopSettings = useHonkDesktopSettings().filter(
    (setting) => setting.section === "general",
  );
  const canChooseDirectory = globalThis.window?.desktopBridge?.pickFolder !== undefined;
  const clipboard = globalThis.navigator?.clipboard;
  const remoteAccess = readDesktopRemoteAccessAvailability();
  const canCopyDirectory = directory !== null && clipboard !== undefined;
  const canRevealDirectory = directory !== null && canShowItemInFolder();

  const choose = (): void => {
    void pickFolder(directory).then((path) => {
      if (path !== null) appSettingsActions.setDefaultProjectDirectory(path);
    });
  };

  const copy = (): void => {
    if (directory === null || clipboard === undefined) return;
    void clipboard.writeText(directory).then(
      () => {
        toastActions.add({ type: "success", title: "Copied project folder" });
      },
      (cause: unknown) => {
        toastActions.add({
          type: "error",
          title: "Could not copy project folder",
          description: errorMessage(cause),
        });
      },
    );
  };

  const reveal = (): void => {
    if (directory === null) return;
    void showItemInFolder(directory).then(
      (didReveal) => {
        if (didReveal) return;
        toastActions.add({ type: "error", title: "Could not show project folder" });
      },
      (cause: unknown) => {
        toastActions.add({
          type: "error",
          title: "Could not show project folder",
          description: errorMessage(cause),
        });
      },
    );
  };

  const previewAlertSound = (): void => {
    const selection = appSettings.alertSoundSelection;
    const customFileName = appSettings.customAlertSoundFileName;
    void playAlertSound(selection, customFileName).then((result) => {
      if (result === "custom" || (result === "built-in" && selection !== "custom")) return;
      if (result === "unavailable") {
        toastActions.add({ type: "error", title: "Could not play alert sound" });
        return;
      }
      const current = getAppSettingsSnapshot();
      if (
        current.alertSoundSelection === selection &&
        current.customAlertSoundFileName === customFileName
      ) {
        appSettingsActions.clearCustomAlertSound();
      }
      toastActions.add({
        type: "warning",
        title: "Custom sound unavailable",
        description: "Switched to Ready.",
      });
    });
  };

  const resetAlertSound = (): void => {
    if (appSettings.alertSoundSelection !== "custom") {
      appSettingsActions.setAlertSoundSelection(DEFAULT_ALERT_SOUND);
      return;
    }
    void deleteCustomAlertSound().then(
      () => {
        appSettingsActions.clearCustomAlertSound();
      },
      (cause: unknown) => {
        appSettingsActions.clearCustomAlertSound();
        toastActions.add({
          type: "error",
          title: "Could not remove saved sound",
          description: errorMessage(cause),
        });
      },
    );
  };

  return (
    <>
      <SettingsSection>
        <SettingsRows>
          <UpdateSettingsRow />
          <SettingsRow
            title="Default environment"
            description="Choose whether new threads start in the project or an isolated worktree."
            resetAction={
              appSettings.defaultThreadEnvironment === "local" ? null : (
                <SettingResetButton
                  label="default environment"
                  onClick={() => {
                    appSettingsActions.resetDefaultThreadEnvironment();
                  }}
                />
              )
            }
            control={
              <Picker.Root
                value={appSettings.defaultThreadEnvironment}
                onValueChange={(value) => {
                  if (value !== "local" && value !== "worktree") return;
                  appSettingsActions.setDefaultThreadEnvironment(value);
                }}
              >
                <Picker.Trigger size="sm" accessibilityLabel="Default environment">
                  {appSettings.defaultThreadEnvironment === "worktree"
                    ? "New worktree"
                    : "Current project"}
                </Picker.Trigger>
                <Picker.Popup label="Default environment" width="wide" layer="dialog" align="end">
                  <Picker.Option
                    value="local"
                    label="Current project"
                    description="Work directly in the selected project."
                  />
                  <Picker.Option
                    value="worktree"
                    label="New worktree"
                    description="Create an isolated worktree for each new thread."
                  />
                </Picker.Popup>
              </Picker.Root>
            }
          />
        </SettingsRows>

        <div {...stylex.props(styles.location)}>
          <div {...stylex.props(styles.locationHeader)}>
            <div {...stylex.props(styles.locationCopy)}>
              <Text size="base" weight="regular">
                Default project folder
              </Text>
              <Text size="sm" tone="muted">
                Where new threads start unless you choose a different folder.
              </Text>
            </div>
            <div {...stylex.props(styles.locationControls)}>
              <span {...stylex.props(styles.resetSlot)}>
                {directory === null ? null : (
                  <SettingResetButton
                    label="default project folder"
                    onClick={() => {
                      appSettingsActions.setDefaultProjectDirectory(null);
                    }}
                  />
                )}
              </span>
              {canChooseDirectory ? (
                <Button size="sm" variant="neutral" onClick={choose}>
                  {directory === null ? "Choose folder…" : "Change folder…"}
                </Button>
              ) : (
                <Text size="sm" tone="faint">
                  Desktop only
                </Text>
              )}
            </div>
          </div>

          <div {...stylex.props(styles.locationPanel)}>
            <Icon icon={IconFolder1} size="md" tone="muted" />
            <div {...stylex.props(styles.locationPath)}>
              {directory === null ? (
                <Text size="xs" tone="muted">
                  Choose a folder when you start a chat
                </Text>
              ) : (
                <Text as="div" size="xs" family="mono" truncate>
                  {directory}
                </Text>
              )}
            </div>
            {directory === null ? null : (
              <div {...stylex.props(styles.pathActions)}>
                {canCopyDirectory ? (
                  <Tooltip label="Copy folder path">
                    <IconButton
                      size="sm"
                      variant="quiet"
                      aria-label="Copy default project folder path"
                      onClick={copy}
                    >
                      <Icon icon={IconClipboard} size="sm" />
                    </IconButton>
                  </Tooltip>
                ) : null}
                {canRevealDirectory ? (
                  <Tooltip label="Show in Finder">
                    <IconButton
                      size="sm"
                      variant="quiet"
                      aria-label="Show default project folder in Finder"
                      onClick={reveal}
                    >
                      <Icon icon={IconFolderOpen} size="sm" />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Background work">
        <SettingsRows>
          {desktopSettings.map((setting) => (
            <DesktopSettingsToggleRow key={setting.key} setting={setting} />
          ))}
          <NotificationPermissionRow />
          <SettingsRow
            title="Thread finished"
            description="Notify when a thread finishes while Honk is in the background."
            control={
              <Switch
                size="sm"
                checked={appSettings.notifyWhenThreadFinishes}
                aria-label="Notify when a thread finishes"
                onCheckedChange={(checked) => {
                  appSettingsActions.setNotifyWhenThreadFinishes(checked);
                }}
              />
            }
          />
          <SettingsRow
            title="Input needed"
            description="Notify when a thread needs a decision, permission, or answer."
            control={
              <Switch
                size="sm"
                checked={appSettings.notifyWhenThreadNeedsInput}
                aria-label="Notify when a thread needs input"
                onCheckedChange={(checked) => {
                  appSettingsActions.setNotifyWhenThreadNeedsInput(checked);
                }}
              />
            }
          />
          <SettingsRow
            title="Alert sounds"
            description="Play an alert when a background thread finishes, fails, or needs input. Failures use Error."
            resetAction={
              appSettings.alertSoundSelection === DEFAULT_ALERT_SOUND ? null : (
                <SettingResetButton label="alert sound" onClick={resetAlertSound} />
              )
            }
            control={
              <>
                <Switch
                  size="sm"
                  checked={appSettings.alertSoundsEnabled}
                  aria-label="Play alert sounds"
                  onCheckedChange={(checked) => {
                    appSettingsActions.setAlertSoundsEnabled(checked);
                  }}
                />
                <Picker.Root
                  value={appSettings.alertSoundSelection}
                  onValueChange={(value) => {
                    switch (value) {
                      case "ready":
                      case "chime":
                      case "custom":
                        appSettingsActions.setAlertSoundSelection(value);
                    }
                  }}
                >
                  <Picker.Trigger size="sm" accessibilityLabel="Alert sound">
                    {appSettings.alertSoundSelection === "custom"
                      ? (appSettings.customAlertSoundFileName ?? "Custom sound")
                      : (ALERT_SOUND_OPTIONS.find(
                          (option) => option.value === appSettings.alertSoundSelection,
                        )?.label ?? "Ready")}
                  </Picker.Trigger>
                  <Picker.Popup label="Alert sound" width="wide" layer="dialog" align="end">
                    <Picker.Group>
                      <Picker.GroupLabel>Default sounds</Picker.GroupLabel>
                      {ALERT_SOUND_OPTIONS.map((option) => (
                        <Picker.Option
                          key={option.value}
                          value={option.value}
                          label={option.label}
                          description={option.description}
                        />
                      ))}
                    </Picker.Group>
                    {appSettings.customAlertSoundFileName === null ? null : (
                      <Picker.Group>
                        <Picker.GroupLabel>Custom sounds</Picker.GroupLabel>
                        <Picker.Option
                          value="custom"
                          label={appSettings.customAlertSoundFileName}
                          description="Saved on this device."
                        />
                      </Picker.Group>
                    )}
                  </Picker.Popup>
                </Picker.Root>
                <Button
                  size="sm"
                  variant="neutral"
                  aria-label="Add a custom alert sound"
                  onClick={() => {
                    alertSoundInputRef.current?.click();
                  }}
                >
                  Add custom sound…
                </Button>
                <Button
                  size="sm"
                  variant="neutral"
                  aria-label="Preview alert sound"
                  disabled={!appSettings.alertSoundsEnabled}
                  onClick={previewAlertSound}
                >
                  Preview
                </Button>
                <input
                  {...stylex.props(styles.hiddenFileInput)}
                  ref={alertSoundInputRef}
                  type="file"
                  accept="audio/*"
                  aria-label="Custom alert sound file"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file === undefined) return;
                    void saveCustomAlertSound(file)
                      .then(() => {
                        appSettingsActions.selectCustomAlertSound(file.name);
                      })
                      .catch((cause: unknown) => {
                        toastActions.add({
                          type: "error",
                          title: "Could not save alert sound",
                          description: errorMessage(cause),
                        });
                      });
                  }}
                />
              </>
            }
          />
        </SettingsRows>
      </SettingsSection>

      {remoteAccess.status === "web" ? null : (
        <SettingsSection title="Remote access">
          <SettingsRows>
            <ConnectPhoneSettingsRow availability={remoteAccess.status} />
          </SettingsRows>
        </SettingsSection>
      )}

      <SettingsSection title="Interaction">
        <SettingsRows>
          <SettingsRow
            title="Pointer cursor"
            description="Show a pointer cursor over buttons and other clickable controls."
            control={
              <Switch
                size="sm"
                checked={appSettings.cursorPointerOnButtons}
                aria-label="Pointer cursor"
                onCheckedChange={(checked) => {
                  appSettingsActions.setCursorPointerOnButtons(checked);
                }}
              />
            }
          />
        </SettingsRows>
      </SettingsSection>
    </>
  );
}

function UpdateSettingsRow(): React.ReactElement | null {
  const update = useUpdatePill();
  if (!update.bridgePresent || update.state === null) return null;

  const state = update.state;
  const action = updateAction(state);
  const busy =
    state.status === "checking" || state.status === "downloading" || state.status === "installing";

  return (
    <SettingsRow
      title={`Honk ${formatVersion(state.currentVersion)}`}
      description={updateDescription(state)}
      control={
        state.status === "disabled" ? (
          <Text size="sm" tone="faint">
            Unavailable
          </Text>
        ) : (
          <Button
            size="sm"
            variant="neutral"
            disabled={busy}
            onClick={() => {
              if (action === "download") {
                void updatePillActions.download();
                return;
              }
              if (action === "install") {
                void updatePillActions.install(state);
                return;
              }
              void updatePillActions.check();
            }}
          >
            {action === "download"
              ? "Download update"
              : action === "install"
                ? "Restart to update"
                : "Check for updates"}
          </Button>
        )
      }
    />
  );
}

function NotificationPermissionRow(): React.ReactElement {
  const permission = useNotificationPermission();
  const supportText = buildNotificationSettingsSupportText(permission);
  const isGranted = permission === "granted";
  const canRequest = permission === "default";
  const isDesktopShell =
    globalThis.document?.documentElement.getAttribute("data-shell-platform") === "electron";

  return (
    <SettingsRow
      title="Desktop notifications"
      description={
        isDesktopShell && isGranted ? "Enabled automatically in the desktop app." : supportText
      }
      control={
        isGranted ? (
          <Text size="sm" tone="muted">
            On
          </Text>
        ) : canRequest ? (
          <Button
            size="sm"
            variant="neutral"
            onClick={() => {
              void requestBrowserNotificationPermission();
            }}
          >
            Enable
          </Button>
        ) : (
          <Text size="sm" tone="faint">
            {permission === "denied"
              ? "Blocked"
              : permission === "insecure"
                ? "Unavailable"
                : "Unsupported"}
          </Text>
        )
      }
    />
  );
}

function updateAction(state: DesktopUpdateState): "check" | "download" | "install" {
  if (state.downloadedVersion !== null) return "install";
  if (state.availableVersion !== null && state.status !== "checking") return "download";
  return "check";
}

function updateDescription(state: DesktopUpdateState): string {
  const checked = formatCheckedAt(state.checkedAt);
  switch (state.status) {
    case "disabled":
      return state.message ?? "Automatic updates are unavailable in this build.";
    case "idle":
      return "Updates are checked automatically.";
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return checked === null ? "Up to date." : `Up to date. Last checked ${checked}.`;
    case "available":
      return `Update ${formatVersion(state.availableVersion ?? state.currentVersion)} is available.`;
    case "downloading":
      return state.downloadPercent !== null
        ? `Downloading update… ${Math.floor(state.downloadPercent)}%`
        : "Downloading update…";
    case "downloaded":
      return `Update ${formatVersion(state.downloadedVersion ?? state.currentVersion)} is ready.`;
    case "installing":
      return "Installing update…";
    case "error":
      return state.message ?? "The last update action failed.";
  }
}

function formatVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function formatCheckedAt(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (date.toJSON() === null) return null;
  return UPDATE_DATE_TIME_FORMATTER.format(date);
}
