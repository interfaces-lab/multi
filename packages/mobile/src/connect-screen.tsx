import { parsePairingUrl, previewPairing } from "@honk/core/access";
import { Button, Text } from "@honk/ui";
import { TextField } from "@honk/ui/text-field";
import * as Clipboard from "expo-clipboard";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Linking from "expo-linking";
import { router, Stack } from "expo-router";
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCoreConnection } from "./core-connection";
import { useHonkTheme } from "./ui";

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}

interface PairingPreviewState {
  readonly computerLabel: string;
  readonly environmentId: string;
}

async function withPreviewDeadline<T>(task: Promise<T>): Promise<T> {
  let cancelDeadline = (): void => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Honk could not check this code within 15 seconds.")),
      15_000,
    );
    cancelDeadline = () => clearTimeout(timer);
  });
  try {
    return await Promise.race([task, deadline]);
  } finally {
    cancelDeadline();
  }
}

export function ConnectScreen(): React.ReactElement {
  const theme = useHonkTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const remote = useCoreConnection();
  const [permission, requestPermission] = useCameraPermissions();
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [checkingCode, setCheckingCode] = React.useState(false);
  const [scanLocked, setScanLocked] = React.useState(false);
  const [preview, setPreview] = React.useState<PairingPreviewState | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);
  const checkingRef = React.useRef(false);
  const previewGeneration = React.useRef(0);
  const previewedUrl = React.useRef<string | null>(null);

  const inspectPairing = React.useCallback((pairingUrl: string): void => {
    const candidate = pairingUrl.trim();
    if (candidate.length === 0 || checkingRef.current) return;
    setScanLocked(true);
    setPreview(null);
    previewedUrl.current = null;
    const grant = parsePairingUrl(candidate);
    if (grant === null) {
      setMessage("Scan a Honk pairing code from your computer.");
      return;
    }
    checkingRef.current = true;
    const requestGeneration = ++previewGeneration.current;
    setCheckingCode(true);
    setMessage(null);
    void withPreviewDeadline(previewPairing(grant))
      .then(
        (inspected) => {
          if (requestGeneration !== previewGeneration.current) return;
          previewedUrl.current = candidate;
          setPreview({
            computerLabel: inspected.computerLabel,
            environmentId: inspected.environmentId,
          });
        },
        (cause: unknown) => {
          if (requestGeneration !== previewGeneration.current) return;
          setMessage(messageOf(cause, "Honk could not check this pairing code."));
        },
      )
      .finally(() => {
        if (requestGeneration === previewGeneration.current) {
          checkingRef.current = false;
          setCheckingCode(false);
        }
      });
  }, []);

  React.useEffect(() => {
    return () => {
      previewGeneration.current += 1;
      checkingRef.current = false;
    };
  }, []);

  const connect = React.useCallback(
    (pairingUrl: string): void => {
      const candidate = pairingUrl.trim();
      if (candidate.length === 0 || busyRef.current) return;
      if (previewedUrl.current !== candidate) {
        setMessage("Check the pairing code before connecting.");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setScanLocked(true);
      setMessage(null);
      void remote
        .pair(candidate)
        .then(
          () => router.dismissTo("/"),
          (cause: unknown) => {
            setMessage(messageOf(cause, "Honk could not connect to this computer."));
          },
        )
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [remote.pair],
  );

  React.useEffect(() => {
    const incoming = remote.pendingPairingUrl;
    if (
      incoming === null ||
      busyRef.current ||
      remote.status === "restoring" ||
      remote.status === "connecting" ||
      remote.status === "disconnecting" ||
      remote.status === "forgetting"
    ) {
      return;
    }
    remote.claimPairingUrl(incoming);
    setValue(incoming);
    inspectPairing(incoming);
  }, [inspectPairing, remote.claimPairingUrl, remote.pendingPairingUrl, remote.status]);

  const retryAttach = React.useCallback((): void => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    void remote
      .retry()
      .then(
        () => router.dismissTo("/"),
        (cause: unknown) => {
          setMessage(messageOf(cause, "Honk still cannot reach this computer."));
        },
      )
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, [remote.retry]);

  const cameraSize = Math.min(
    420,
    Math.max(0, window.width - theme.metrics.space.screenGutter * 2),
  );
  const savedAttachFailed = remote.status === "error" && remote.connection !== null;
  const replacementBlocked =
    preview !== null &&
    remote.connection !== null &&
    preview.environmentId !== remote.connection.environmentId;
  const replacingAccess =
    preview !== null &&
    remote.connection !== null &&
    preview.environmentId === remote.connection.environmentId;

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={[styles.page, { backgroundColor: theme.colors.bgBase }]}
      contentContainerStyle={{
        flexGrow: 1,
        gap: theme.metrics.space.sectionGap,
        paddingBottom: Math.max(insets.bottom, theme.metrics.space.screenGutter),
        paddingHorizontal: theme.metrics.space.screenGutter,
        paddingTop: theme.metrics.space.sectionGap,
      }}
    >
      <Stack.Screen options={{ headerBackVisible: remote.connection !== null, title: "Connect" }} />

      <View
        style={[
          styles.content,
          {
            gap: theme.metrics.space.sectionGap,
            maxWidth: 560,
          },
        ]}
      >
        <View style={{ gap: theme.metrics.space.contentGap }}>
          <Text size="lg" weight="semibold" align="center" accessibilityRole="header">
            Scan a pairing code
          </Text>
          <Text tone="muted" align="center">
            In Honk on your computer, open Settings, choose Connect phone, then scan the QR code.
            Both devices must be on the same Tailscale network.
          </Text>
        </View>

        {savedAttachFailed ? (
          <View
            style={[
              styles.recovery,
              {
                backgroundColor: theme.colors.layer01,
                borderColor: theme.colors.borderBase,
                borderRadius: theme.metrics.radius.panel,
                gap: theme.metrics.space.contentGap,
                padding: theme.metrics.space.panelPad,
              },
            ]}
          >
            <Text weight="semibold">Saved connection unavailable</Text>
            <Text tone="muted">
              Honk could not reach this computer. Try the saved connection before scanning another
              code.
            </Text>
            <Button variant="primary" isPending={busy} onClick={retryAttach}>
              Try again
            </Button>
          </View>
        ) : null}

        <View
          style={[
            styles.cameraFrame,
            {
              backgroundColor: theme.colors.layer01,
              borderColor: theme.colors.borderBase,
              borderRadius: theme.metrics.radius.panel,
              height: cameraSize,
              width: cameraSize,
            },
          ]}
        >
          {permission === null ? (
            <View style={[styles.cameraFallback, { gap: theme.metrics.space.contentGap }]}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text tone="muted" align="center" accessibilityLiveRegion="polite">
                Preparing camera…
              </Text>
            </View>
          ) : permission.granted ? (
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              accessibilityLabel="QR code scanner"
              accessible
              onBarcodeScanned={
                busy || checkingCode || scanLocked
                  ? undefined
                  : ({ data }) => {
                      if (busyRef.current || checkingRef.current) return;
                      setValue(data);
                      inspectPairing(data);
                    }
              }
            />
          ) : (
            <View style={[styles.cameraFallback, { gap: theme.metrics.space.contentGap }]}>
              <Text weight="semibold">Camera access is off</Text>
              <Text tone="muted" align="center">
                Honk only uses the camera to scan a pairing code. You can also paste the link below.
              </Text>
              <Button
                onClick={() => {
                  setMessage(null);
                  const action = permission.canAskAgain
                    ? requestPermission()
                    : Linking.openSettings();
                  void action.catch((cause: unknown) => {
                    setMessage(messageOf(cause, "Camera settings could not be opened."));
                  });
                }}
              >
                {permission.canAskAgain ? "Allow camera" : "Open Settings"}
              </Button>
            </View>
          )}
          {busy || checkingCode ? (
            <View style={[styles.busy, { backgroundColor: theme.colors.scrim }]}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text accessibilityLiveRegion="polite">
                {checkingCode ? "Checking code…" : "Connecting…"}
              </Text>
            </View>
          ) : null}
        </View>

        {preview === null ? null : (
          <View
            style={[
              styles.recovery,
              {
                backgroundColor: theme.colors.layer01,
                borderColor: theme.colors.borderBase,
                borderRadius: theme.metrics.radius.panel,
                gap: theme.metrics.space.contentGap,
                padding: theme.metrics.space.panelPad,
              },
            ]}
          >
            <Text weight="semibold">
              {replacementBlocked
                ? `${preview.computerLabel} is a different computer`
                : replacingAccess
                  ? `Replace access for ${preview.computerLabel}?`
                  : `Connect to ${preview.computerLabel}?`}
            </Text>
            <Text tone="muted">
              {replacementBlocked
                ? `Disconnect from ${remote.connection?.computerLabel ?? "the saved computer"} before connecting this one.`
                : replacingAccess
                  ? "This replaces this phone’s saved access. Continue only if this computer is showing the pairing code."
                  : "Continue only if this is the computer showing the pairing code."}
            </Text>
            {replacementBlocked ? null : (
              <Button variant="primary" isPending={busy} onClick={() => connect(value)}>
                {replacingAccess ? "Replace access" : "Connect"}
              </Button>
            )}
          </View>
        )}

        {scanLocked && !checkingCode && !busy ? (
          <Button
            onClick={() => {
              previewGeneration.current += 1;
              checkingRef.current = false;
              previewedUrl.current = null;
              setPreview(null);
              setValue("");
              setMessage(null);
              setScanLocked(false);
            }}
          >
            Scan again
          </Button>
        ) : null}

        <View style={{ gap: theme.metrics.space.contentGap }}>
          <TextField
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            disabled={busy || checkingCode}
            inputMode="url"
            label="Pairing link"
            onChangeText={(next) => {
              previewGeneration.current += 1;
              checkingRef.current = false;
              previewedUrl.current = null;
              setCheckingCode(false);
              setValue(next);
              setPreview(null);
              setMessage(null);
              setScanLocked(false);
            }}
            onSubmit={inspectPairing}
            placeholder="honk://connect…"
            returnKeyType="go"
            value={value}
          />
          <View style={[styles.actions, { gap: theme.metrics.space.contentGap }]}>
            <Button
              disabled={busy || checkingCode}
              onClick={() => {
                void Clipboard.getStringAsync().then(
                  (text) => {
                    if (text.trim().length === 0) {
                      setMessage("The clipboard does not contain a pairing link.");
                      return;
                    }
                    previewedUrl.current = null;
                    setValue(text);
                    setPreview(null);
                    setMessage(null);
                    setScanLocked(false);
                  },
                  (cause: unknown) => {
                    setMessage(messageOf(cause, "Honk could not read the clipboard."));
                  },
                );
              }}
            >
              Paste
            </Button>
            {preview === null ? (
              <Button
                variant="primary"
                isPending={busy}
                disabled={checkingCode || value.trim().length === 0}
                onClick={() => inspectPairing(value)}
              >
                Check code
              </Button>
            ) : null}
          </View>
          {message !== null || (remote.status === "error" && remote.error !== null) ? (
            <Text
              tone="err"
              align="center"
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              selectable
            >
              {message ?? remote.error}
            </Text>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { alignSelf: "center", width: "100%" },
  cameraFrame: {
    alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  camera: { flex: 1 },
  cameraFallback: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  busy: {
    alignItems: "center",
    bottom: 0,
    gap: 12,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  recovery: { borderWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", justifyContent: "flex-end" },
});
