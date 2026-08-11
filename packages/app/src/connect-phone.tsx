import type {
  DesktopRemoteDevice,
  DesktopRemotePairingInvitation,
  DesktopTailscaleRemoteAccessState,
} from "@honk/shared/desktop-api";
import { parsePairingUrl } from "@honk/core/access";
import { Button, Dialog, Icon, Spinner, Text } from "@honk/ui";
import { IconCircleCheck, IconClipboard, IconExclamationCircle, IconGlobe } from "@honk/ui/icons";
import { borderVars, colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { toQR } from "toqr";

import {
  cancelRemotePairing,
  disableTailscaleRemoteAccess,
  enableTailscaleRemoteAccess,
  getRemotePairingState,
  getTailscaleRemoteAccess,
  issueRemotePairing,
  listRemoteDevices,
  openDesktopExternal,
  revokeRemoteDevice,
} from "./desktop-bridge";
import { actions as toastActions } from "./toast-store";

const QR_MARGIN = 4;
const TAILSCALE_INSTALL_URL = "https://tailscale.com/download";
// A fixed square keeps every connection state from resizing the nested dialog.
const PAIRING_STAGE_SIZE = "264px";
const PAIRING_COPY_MAX_WIDTH = "210px";

type ConnectPhoneView =
  | { readonly status: "loading" }
  | { readonly status: "disabled" }
  | { readonly status: "enabling" }
  | {
      readonly status: "error";
      readonly reason: Extract<
        DesktopTailscaleRemoteAccessState,
        { readonly status: "error" }
      >["reason"];
      readonly message: string;
      readonly enableUrl: string | null;
    }
  | {
      readonly status: "pairing";
      readonly invitation: DesktopRemotePairingInvitation;
      readonly remainingSeconds: number;
    }
  | { readonly status: "expired" }
  | {
      readonly status: "connected";
      readonly device: { readonly id: string; readonly label: string };
    };

const styles = stylex.create({
  body: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
  stage: {
    width: PAIRING_STAGE_SIZE,
    maxWidth: "100%",
    aspectRatio: "1",
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  stageCopy: {
    maxWidth: PAIRING_COPY_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  qrFrame: {
    width: PAIRING_STAGE_SIZE,
    maxWidth: "100%",
    aspectRatio: "1",
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-panel-pad"],
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    borderRadius: radiusVars["--honk-radius-window"],
    // Scanner contrast must not follow the application theme.
    // oxlint-disable-next-line honk/design-no-raw-values
    backgroundColor: "#ffffff",
  },
  qr: { display: "block", width: "100%", height: "100%" },
  copy: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
  },
  deviceList: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    paddingBlockStart: spaceVars["--honk-space-gutter"],
    borderTopWidth: borderVars["--honk-border-hairline"],
    borderTopStyle: "solid",
    borderTopColor: colorVars["--honk-color-border-muted"],
    textAlign: "start",
  },
  device: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
  },
  deviceCopy: { minWidth: 0, display: "flex", flexDirection: "column" },
});

function encodePairingQr(value: string): { readonly path: string; readonly size: number } | null {
  try {
    const modules = toQR(value);
    const matrixSize = Math.sqrt(modules.length);
    if (matrixSize % 1 !== 0) return null;
    return {
      path: Array.from(modules, (module, index) =>
        module === 1
          ? `M${(index % matrixSize) + QR_MARGIN} ${Math.floor(index / matrixSize) + QR_MARGIN}h1v1h-1z`
          : "",
      ).join(""),
      size: matrixSize + QR_MARGIN * 2,
    };
  } catch {
    return null;
  }
}

function PairingQrCode({ value }: { readonly value: string }): React.ReactElement {
  const encoded = encodePairingQr(value);
  if (encoded === null) {
    return (
      <div {...stylex.props(styles.stage)}>
        <div {...stylex.props(styles.stageCopy)}>
          <Icon icon={IconExclamationCircle} size="xl" tone="err" />
          <Text tone="err">Could not draw the code. Copy the link instead.</Text>
        </div>
      </div>
    );
  }
  return (
    <div {...stylex.props(styles.qrFrame)}>
      <svg
        viewBox={`0 0 ${encoded.size} ${encoded.size}`}
        role="img"
        aria-label="Pair this phone with Honk"
        shapeRendering="crispEdges"
        {...stylex.props(styles.qr)}
      >
        <rect width={encoded.size} height={encoded.size} fill="#ffffff" />
        <path d={encoded.path} fill="#000000" />
      </svg>
    </div>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : "Honk could not prepare remote access.";
}

function remainingSeconds(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1_000));
}

export function ConnectPhoneDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
}): React.ReactElement {
  const [view, setView] = React.useState<ConnectPhoneView>({ status: "loading" });
  const [devices, setDevices] = React.useState<readonly DesktopRemoteDevice[]>([]);
  const generation = React.useRef(0);
  const pairingId = view.status === "pairing" ? view.invitation.id : null;
  const pairingExpiresAt = view.status === "pairing" ? view.invitation.expiresAt : null;
  const pairingOrigin =
    view.status === "pairing" ? parsePairingUrl(view.invitation.url)?.origin : undefined;

  const loadDevices = React.useCallback((): void => {
    void listRemoteDevices().then(setDevices, () => setDevices([]));
  }, []);

  const issue = React.useCallback(async (requestGeneration: number): Promise<void> => {
    try {
      const invitation = await issueRemotePairing();
      if (requestGeneration !== generation.current) {
        if (invitation !== null) await cancelRemotePairing(invitation.id);
        return;
      }
      if (invitation === null) throw new Error("Honk could not create a pairing code.");
      setView({
        status: "pairing",
        invitation,
        remainingSeconds: remainingSeconds(invitation.expiresAt),
      });
    } catch (cause: unknown) {
      if (requestGeneration !== generation.current) return;
      const access = await getTailscaleRemoteAccess().catch(() => null);
      if (requestGeneration !== generation.current) return;
      if (access?.status === "error") {
        setView(access);
        return;
      }
      setView({
        status: "error",
        reason: "failed",
        message: messageOf(cause),
        enableUrl: null,
      });
    }
  }, []);

  const load = React.useCallback(async (): Promise<void> => {
    const requestGeneration = ++generation.current;
    setView({ status: "loading" });
    loadDevices();
    try {
      const access = await getTailscaleRemoteAccess();
      if (requestGeneration !== generation.current) return;
      if (access === null || access.status === "disabled") {
        setView({ status: "disabled" });
      } else if (access.status === "enabling") {
        setView({ status: "enabling" });
      } else if (access.status === "error") {
        setView(access);
      } else {
        await issue(requestGeneration);
      }
    } catch (cause: unknown) {
      if (requestGeneration !== generation.current) return;
      setView({
        status: "error",
        reason: "failed",
        message: messageOf(cause),
        enableUrl: null,
      });
    }
  }, [issue, loadDevices]);

  React.useEffect(() => {
    if (props.open) void load();
    return () => {
      generation.current += 1;
    };
  }, [load, props.open]);

  React.useEffect(() => {
    if (pairingId === null || pairingExpiresAt === null) return;
    let active = true;
    let checking = false;
    const check = (): void => {
      const remaining = remainingSeconds(pairingExpiresAt);
      setView((current) =>
        current.status === "pairing" && current.invitation.id === pairingId
          ? { ...current, remainingSeconds: remaining }
          : current,
      );
      if (checking) return;
      checking = true;
      void getRemotePairingState(pairingId)
        .then((pairing) => {
          if (!active) return;
          if (pairing?.status === "completed") {
            setView({ status: "connected", device: pairing.device });
            loadDevices();
          } else if (
            pairing === null ||
            pairing.status === "unknown" ||
            pairing.status === "expired" ||
            pairing.status === "cancelled" ||
            remaining === 0
          ) {
            setView({ status: "expired" });
          }
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setView({
            status: "error",
            reason: "failed",
            message: messageOf(cause),
            enableUrl: null,
          });
        })
        .finally(() => {
          checking = false;
        });
    };
    check();
    const timer = window.setInterval(check, 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadDevices, pairingExpiresAt, pairingId]);

  const enable = (): void => {
    const requestGeneration = ++generation.current;
    setView({ status: "enabling" });
    void enableTailscaleRemoteAccess().then(
      async (access) => {
        if (requestGeneration !== generation.current) return;
        if (access?.status === "connected") await issue(requestGeneration);
        else if (access?.status === "error") setView(access);
        else setView({ status: "disabled" });
      },
      (cause: unknown) => {
        if (requestGeneration !== generation.current) return;
        setView({
          status: "error",
          reason: "failed",
          message: messageOf(cause),
          enableUrl: null,
        });
      },
    );
  };

  const close = (): void => {
    const pairingId = view.status === "pairing" ? view.invitation.id : null;
    generation.current += 1;
    void (pairingId === null ? Promise.resolve() : cancelRemotePairing(pairingId))
      .catch(() => undefined)
      .finally(props.onClose);
  };

  const disable = (): void => {
    const pairingId = view.status === "pairing" ? view.invitation.id : null;
    generation.current += 1;
    setView({ status: "loading" });
    void (pairingId === null ? Promise.resolve() : cancelRemotePairing(pairingId))
      .then(() => disableTailscaleRemoteAccess())
      .then(
        () => setView({ status: "disabled" }),
        (cause: unknown) => {
          setView({
            status: "error",
            reason: "failed",
            message: messageOf(cause),
            enableUrl: null,
          });
        },
      );
  };

  const removeDevice = (device: DesktopRemoteDevice): void => {
    void revokeRemoteDevice(device.id).then(
      (removed) => {
        if (!removed) return;
        setDevices((current) => current.filter((candidate) => candidate.id !== device.id));
        toastActions.add({ type: "success", title: `${device.label} disconnected` });
      },
      (cause: unknown) => {
        toastActions.add({
          type: "error",
          title: `Could not disconnect ${device.label}`,
          description: messageOf(cause),
        });
      },
    );
  };

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <Dialog.Popup>
        <Dialog.Header>
          <Dialog.Title>
            {view.status === "pairing" ? "Scan with your phone" : "Connect your phone"}
          </Dialog.Title>
          <Dialog.Description>
            {view.status === "pairing"
              ? "Open Honk mobile and scan this one-time code."
              : "Honk uses Tailscale to keep Core private to your tailnet. Tailscale must be connected on this computer and your phone."}
          </Dialog.Description>
        </Dialog.Header>

        <div {...stylex.props(styles.body)}>
          {view.status === "loading" || view.status === "enabling" ? (
            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageCopy)}>
                <Spinner size="lg" label="Preparing Tailscale access" />
                <Text tone="muted">
                  {view.status === "enabling" ? "Publishing Honk…" : "Checking Tailscale…"}
                </Text>
              </div>
            </div>
          ) : null}

          {view.status === "disabled" ? (
            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageCopy)}>
                <Icon icon={IconGlobe} size="xl" tone="accent" />
                <Text>Turn on private remote access, then scan one pairing code.</Text>
                <Button variant="primary" onClick={enable}>
                  Turn on Tailscale access
                </Button>
              </div>
            </div>
          ) : null}

          {view.status === "error" ? (
            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageCopy)}>
                <Icon icon={IconExclamationCircle} size="xl" tone="err" />
                <Text tone="err">{view.message}</Text>
                <div {...stylex.props(styles.actions)}>
                  <Button variant="primary" onClick={enable}>
                    Try again
                  </Button>
                  {view.enableUrl !== null ? (
                    <Button
                      onClick={() => {
                        if (view.enableUrl !== null) void openDesktopExternal(view.enableUrl);
                      }}
                    >
                      Approve Tailscale Serve
                    </Button>
                  ) : view.reason === "unavailable" ? (
                    <Button
                      onClick={() => {
                        void openDesktopExternal(TAILSCALE_INSTALL_URL);
                      }}
                    >
                      Get Tailscale
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {view.status === "pairing" ? (
            <>
              <PairingQrCode value={view.invitation.url} />
              <div {...stylex.props(styles.copy)}>
                {pairingOrigin === undefined ? null : (
                  <Text size="xs" tone="faint" family="mono" truncate>
                    {pairingOrigin}
                  </Text>
                )}
                <Text size="sm" tone="muted">
                  Expires in {view.remainingSeconds}s. The saved phone connection does not expire.
                </Text>
                <Button
                  size="sm"
                  iconStart={<Icon icon={IconClipboard} size="sm" />}
                  onClick={() => {
                    void navigator.clipboard.writeText(view.invitation.url).then(
                      () => {
                        toastActions.add({ type: "success", title: "Pairing link copied" });
                      },
                      (cause: unknown) => {
                        toastActions.add({
                          type: "error",
                          title: "Could not copy pairing link",
                          description: messageOf(cause),
                        });
                      },
                    );
                  }}
                >
                  Copy pairing link
                </Button>
              </div>
            </>
          ) : null}

          {view.status === "expired" ? (
            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageCopy)}>
                <Icon icon={IconExclamationCircle} size="xl" tone="warn" />
                <Text>This pairing code expired without changing remote access.</Text>
                <Button
                  variant="primary"
                  onClick={() => {
                    void issue(++generation.current);
                  }}
                >
                  Create a new code
                </Button>
              </div>
            </div>
          ) : null}

          {view.status === "connected" ? (
            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageCopy)}>
                <Icon icon={IconCircleCheck} size="xl" tone="ok" />
                <Text weight="semibold">{view.device.label} is connected</Text>
                <Text size="sm" tone="muted">
                  It can use this computer while Honk and Tailscale are running.
                </Text>
              </div>
            </div>
          ) : null}

          {devices.length > 0 ? (
            <div {...stylex.props(styles.deviceList)}>
              <Text size="sm" tone="muted">
                Connected devices
              </Text>
              {devices.map((device) => (
                <div key={device.id} {...stylex.props(styles.device)}>
                  <div {...stylex.props(styles.deviceCopy)}>
                    <Text>{device.label}</Text>
                    <Text size="xs" tone="faint">
                      Added {new Date(device.createdAt).toLocaleDateString()}
                    </Text>
                  </div>
                  <Button size="sm" variant="quiet" onClick={() => removeDevice(device)}>
                    Disconnect
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <Dialog.Footer>
          {view.status !== "disabled" ? (
            <Button variant="quiet" onClick={disable}>
              Turn off remote access
            </Button>
          ) : null}
          <Button onClick={close}>Done</Button>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
