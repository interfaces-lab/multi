import { Session } from "@honk/core/session";
import { Button, Text } from "@honk/ui";
import { LegendList } from "@legendapp/list/react-native";
import { Redirect, router, Stack } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCoreConnection } from "./core-connection";
import { useHonkTheme } from "./ui";

interface WorkspaceOption {
  readonly id: Session.SessionSummary["workspaceId"];
  readonly directory: string;
}

type PendingAction = "retry" | "disconnect" | "forget" | null;

function folderName(directory: string): string {
  const leaf = directory.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1);
  return leaf === undefined || leaf.length === 0 ? directory : leaf;
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}

export function HomeScreen(): React.ReactElement {
  const theme = useHonkTheme();
  const insets = useSafeAreaInsets();
  const remote = useCoreConnection();
  const [refreshing, setRefreshing] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [choosingWorkspace, setChoosingWorkspace] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const creatingRef = React.useRef(false);
  const pendingActionRef = React.useRef<PendingAction>(null);

  const beginAction = (action: Exclude<PendingAction, null>): boolean => {
    if (pendingActionRef.current !== null) return false;
    pendingActionRef.current = action;
    setPendingAction(action);
    return true;
  };

  const finishAction = (): void => {
    pendingActionRef.current = null;
    setPendingAction(null);
  };

  const sessions = React.useMemo(
    () =>
      remote.sessions
        .filter((session) => session.delegation === undefined)
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [remote.sessions],
  );

  const workspaces = React.useMemo<readonly WorkspaceOption[]>(() => {
    const unique = new Map<Session.SessionSummary["workspaceId"], WorkspaceOption>();
    const inventory = remote.sessions
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const session of inventory) {
      if (!unique.has(session.workspaceId)) {
        unique.set(session.workspaceId, {
          id: session.workspaceId,
          directory: session.directory,
        });
      }
    }
    return [...unique.values()];
  }, [remote.sessions]);

  const createSession = React.useCallback(
    async (workspaceId: Session.SessionSummary["workspaceId"]): Promise<void> => {
      const client = remote.client;
      if (client === null || creatingRef.current) return;
      creatingRef.current = true;
      setCreating(true);
      setChoosingWorkspace(false);
      setMessage(null);
      try {
        const session = await client.session.create({ workspaceId });
        router.push({ pathname: "/session/[sessionId]", params: { sessionId: session.id } });
      } catch (cause: unknown) {
        setMessage(messageOf(cause, "Honk could not create the session. Try again."));
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [remote.client],
  );

  const startNewSession = React.useCallback((): void => {
    if (workspaces.length === 1) {
      const workspace = workspaces[0];
      if (workspace !== undefined) void createSession(workspace.id);
      return;
    }
    if (workspaces.length > 1) setChoosingWorkspace(true);
    else {
      setMessage(
        "Start the first session from a workspace on your computer. Honk will offer that workspace here afterward.",
      );
    }
  }, [createSession, workspaces]);

  const retry = React.useCallback(async (): Promise<void> => {
    if (!beginAction("retry")) return;
    setMessage(null);
    try {
      await remote.retry();
    } catch (cause: unknown) {
      setMessage(messageOf(cause, "Honk still cannot reach this computer."));
    } finally {
      finishAction();
    }
  }, [remote.retry]);

  const confirmDisconnect = React.useCallback((): void => {
    const label = remote.connection?.computerLabel ?? "this computer";
    Alert.alert(
      `Disconnect from ${label}?`,
      "This revokes this phone’s access on the computer. You’ll need a new pairing code to reconnect.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            if (!beginAction("disconnect")) return;
            setMessage(null);
            void remote
              .disconnect()
              .catch((cause: unknown) => {
                setMessage(messageOf(cause, "Honk could not disconnect this phone."));
              })
              .finally(finishAction);
          },
        },
      ],
    );
  }, [remote.connection?.computerLabel, remote.disconnect]);

  const confirmForget = React.useCallback((): void => {
    const label = remote.connection?.computerLabel ?? "this computer";
    Alert.alert(
      `Forget ${label}?`,
      "This only removes the saved connection from this phone. Because the computer is unavailable, Honk cannot revoke this phone’s access there.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            if (!beginAction("forget")) return;
            setMessage(null);
            void remote
              .forget()
              .catch((cause: unknown) => {
                setMessage(messageOf(cause, "Honk could not remove the saved connection."));
              })
              .finally(finishAction);
          },
        },
      ],
    );
  }, [remote.connection?.computerLabel, remote.forget]);

  if (
    remote.status === "restoring" ||
    remote.status === "connecting" ||
    remote.status === "disconnecting" ||
    remote.status === "forgetting"
  ) {
    const statusMessage =
      remote.status === "disconnecting"
        ? "Disconnecting…"
        : remote.status === "forgetting"
          ? "Removing saved connection…"
          : "Connecting to Honk…";
    return (
      <View
        style={[
          styles.center,
          {
            backgroundColor: theme.colors.bgBase,
            padding: theme.metrics.space.screenGutter,
          },
        ]}
      >
        <ActivityIndicator color={theme.colors.accent} />
        <Text tone="muted" accessibilityLiveRegion="polite">
          {statusMessage}
        </Text>
      </View>
    );
  }

  if (remote.status === "disconnected") return <Redirect href="/connect" />;

  if (remote.status === "error" || remote.client === null || remote.connection === null) {
    return (
      <View
        style={[
          styles.center,
          {
            backgroundColor: theme.colors.bgBase,
            padding: theme.metrics.space.screenGutter,
          },
        ]}
      >
        <Text size="lg" weight="semibold" align="center">
          Computer unavailable
        </Text>
        <Text tone="muted" align="center" selectable>
          {message ?? remote.error ?? "Honk cannot reach this computer through Tailscale."}
        </Text>
        <View style={[styles.actions, { gap: theme.metrics.space.contentGap }]}>
          <Button
            variant="primary"
            isPending={pendingAction === "retry"}
            disabled={pendingAction !== null && pendingAction !== "retry"}
            onClick={() => void retry()}
          >
            Try again
          </Button>
          <Button
            variant="destructive"
            isPending={pendingAction === "forget"}
            disabled={pendingAction !== null && pendingAction !== "forget"}
            onClick={confirmForget}
          >
            Forget computer
          </Button>
        </View>
      </View>
    );
  }

  const connection = remote.connection;

  return (
    <View style={[styles.page, { backgroundColor: theme.colors.bgBase }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button size="sm" variant="primary" isPending={creating} onClick={startNewSession}>
              New
            </Button>
          ),
          title: "Sessions",
        }}
      />

      <Modal
        animationType="slide"
        onRequestClose={() => setChoosingWorkspace(false)}
        presentationStyle="pageSheet"
        visible={choosingWorkspace}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={{ backgroundColor: theme.colors.bgBase }}
          contentContainerStyle={{
            gap: theme.metrics.space.sectionGap,
            paddingBottom: Math.max(insets.bottom, theme.metrics.space.screenGutter),
            paddingHorizontal: theme.metrics.space.screenGutter,
            paddingTop: Math.max(insets.top, theme.metrics.space.screenGutter),
          }}
        >
          <View style={[styles.sheetTitle, { gap: theme.metrics.space.contentGap }]}>
            <View style={styles.connectionCopy}>
              <Text size="lg" weight="semibold" accessibilityRole="header">
                Choose a workspace
              </Text>
              <Text tone="muted">The new session will start in this workspace.</Text>
            </View>
            <Button size="sm" variant="quiet" onClick={() => setChoosingWorkspace(false)}>
              Cancel
            </Button>
          </View>

          <View
            style={[
              styles.workspaceChooser,
              {
                backgroundColor: theme.colors.layer01,
                borderColor: theme.colors.borderBase,
                borderRadius: theme.metrics.radius.panel,
                paddingHorizontal: theme.metrics.space.panelPad,
              },
            ]}
          >
            {workspaces.map((workspace) => (
              <Pressable
                key={workspace.id}
                accessibilityRole="button"
                disabled={creating}
                onPress={() => void createSession(workspace.id)}
                style={({ pressed }) => [
                  styles.workspace,
                  {
                    borderTopColor: theme.colors.borderMuted,
                    opacity: pressed ? 0.65 : 1,
                    paddingVertical: theme.metrics.space.panelPad,
                  },
                ]}
              >
                <Text weight="semibold">{folderName(workspace.directory)}</Text>
                <Text size="xs" tone="faint" family="mono" numberOfLines={2}>
                  {workspace.directory}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </Modal>

      {message === null ? null : (
        <Text
          tone="err"
          align="center"
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          selectable
          style={{ padding: theme.metrics.space.contentGap }}
        >
          {message}
        </Text>
      )}

      <LegendList
        data={sessions}
        keyExtractor={(session) => session.id}
        recycleItems
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: Math.max(insets.bottom, theme.metrics.space.screenGutter),
          paddingHorizontal: theme.metrics.space.screenGutter,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.colors.accent}
            onRefresh={() => {
              if (refreshing) return;
              setRefreshing(true);
              setMessage(null);
              void remote.refresh().then(
                () => setRefreshing(false),
                (cause: unknown) => {
                  setMessage(messageOf(cause, "Honk could not refresh the session list."));
                  setRefreshing(false);
                },
              );
            }}
          />
        }
        ListHeaderComponent={
          <View
            style={[
              styles.listHeader,
              {
                borderBottomColor: theme.colors.borderMuted,
                gap: theme.metrics.space.sectionGap,
                paddingBottom: theme.metrics.space.panelPad,
                paddingTop: theme.metrics.space.compactGap,
              },
            ]}
          >
            <View style={[styles.connection, { gap: theme.metrics.space.contentGap }]}>
              <View style={styles.connectionCopy}>
                <Text weight="semibold">{connection.computerLabel}</Text>
                <Text size="sm" tone="muted">
                  Connected through Tailscale
                </Text>
              </View>
              <Button
                size="sm"
                isPending={pendingAction === "disconnect"}
                disabled={pendingAction !== null && pendingAction !== "disconnect"}
                onClick={confirmDisconnect}
              >
                Disconnect
              </Button>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={[styles.center, { padding: theme.metrics.space.screenGutter }]}>
            <Text weight="semibold">No sessions yet</Text>
            <Text tone="muted" align="center">
              Start a session from a workspace on your computer. It will appear here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: "/session/[sessionId]", params: { sessionId: item.id } })
            }
            style={({ pressed }) => [
              styles.row,
              {
                borderBottomColor: theme.colors.borderMuted,
                gap: theme.metrics.space.contentGap,
                opacity: pressed ? 0.65 : 1,
                paddingVertical: theme.metrics.space.panelPad,
              },
            ]}
          >
            <View style={styles.rowCopy}>
              <Text weight="semibold">{item.title ?? folderName(item.directory)}</Text>
              <Text size="xs" tone="faint" family="mono" truncate>
                {item.directory}
              </Text>
            </View>
            <Text size="sm" tone={item.phase === "idle" ? "muted" : "accent"}>
              {item.phase === "idle" ? "Idle" : "Working"}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { alignItems: "center", flex: 1, gap: 12, justifyContent: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  listHeader: { borderBottomWidth: StyleSheet.hairlineWidth },
  connection: { alignItems: "center", flexDirection: "row" },
  connectionCopy: { flex: 1, minWidth: 0 },
  sheetTitle: { alignItems: "center", flexDirection: "row" },
  workspaceChooser: { borderWidth: StyleSheet.hairlineWidth },
  workspace: { borderTopWidth: StyleSheet.hairlineWidth, gap: 2 },
  row: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row" },
  rowCopy: { flex: 1, minWidth: 0 },
});
