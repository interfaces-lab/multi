import * as stylex from "@stylexjs/stylex";
import { Mcp } from "@honk/core";
import { Badge, Button, Field, Spinner, Text } from "@honk/ui";
import { Session } from "@honk/core/session";
import type { Workspace } from "@honk/core/workspace";
import { useParams } from "@tanstack/react-router";
import { Option, Schema } from "effect";
import * as React from "react";

import { describeError, requireHonkClient } from "./chat/client";
import { useSessionWorkspace } from "./chat/session-workspace";
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-controls";
import { SettingsAlert, SettingsFailure, SettingsNote, SettingsStatus } from "./settings-inventory";

const SECTION_DESCRIPTION =
  "Servers for this chat's folder. Honk writes changes to its own override file and never edits shared MCP configs.";

type McpSource = "global" | "project" | "override";

const SOURCE_LABELS: Record<McpSource, string> = {
  global: "Global",
  project: "Project",
  override: "Override",
};

const styles = stylex.create({
  sectionAction: {
    marginInlineStart: "auto",
  },
});

type McpRow = {
  readonly name: string;
  readonly transport: "stdio" | "http";
  readonly source: McpSource;
  readonly disabled: boolean;
  readonly connected: boolean;
  readonly tools: number;
};

type PanelState =
  | { readonly phase: "loading" }
  | { readonly phase: "failed"; readonly message: string; readonly code: string | null }
  | { readonly phase: "ready"; readonly rows: readonly McpRow[] };

type McpDraft = {
  readonly name: string;
  readonly command: string;
};

const decodeMcpFailure = Schema.decodeUnknownOption(Mcp.Failure);

const errorCode = (error: unknown): string | null =>
  Option.getOrNull(Option.map(decodeMcpFailure(error), (failure) => failure.code));

// ConnectError carries the underlying failure verbatim in `detail`; the coded
// line alone would hide the actionable part.
function failureLine(error: unknown): string {
  const line = describeError(error);
  return Option.match(decodeMcpFailure(error), {
    onNone: () => line,
    onSome: (failure) =>
      failure.code === "mcp.connect_failed" && failure.detail.length > 0
        ? `${line} (${failure.detail})`
        : line,
  });
}

async function loadRows(workspaceId: Workspace.WorkspaceId): Promise<readonly McpRow[]> {
  const client = requireHonkClient();
  const [list, status] = await Promise.all([
    client.mcp.list({ workspaceId }),
    client.mcp.status({ workspaceId }),
  ]);
  // The config list is the truth; status only overlays live state, so a
  // server the status read does not mention is simply not running.
  const live = new Map(status.servers.map((server) => [server.name, server]));
  return list.servers
    .map((server) => ({
      name: server.name,
      transport: server.transport,
      source: server.source,
      disabled: server.disabled,
      connected: live.get(server.name)?.connected ?? false,
      tools: live.get(server.name)?.tools ?? 0,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

export function SettingsMcp(): React.ReactElement {
  // The overlay renders inside the router tree, so the open thread's route
  // param decides which workspace this panel manages.
  const params = useParams({ strict: false });
  const sessionId = params.sessionId;
  if (sessionId === undefined) {
    return (
      <SettingsSection description={SECTION_DESCRIPTION}>
        <SettingsNote>Open a chat in a folder to manage its MCP servers.</SettingsNote>
      </SettingsSection>
    );
  }
  return <McpWorkspacePanel sessionId={Session.SessionId.make(sessionId)} />;
}

function McpWorkspacePanel(props: { readonly sessionId: Session.SessionId }): React.ReactElement {
  const workspace = useSessionWorkspace(props.sessionId);
  if (workspace.status === "loading") {
    return (
      <SettingsSection description={SECTION_DESCRIPTION}>
        <SettingsStatus>Finding this chat's folder…</SettingsStatus>
      </SettingsSection>
    );
  }
  if (workspace.status === "failed") {
    return (
      <SettingsSection description={SECTION_DESCRIPTION}>
        <SettingsNote>{workspace.message}</SettingsNote>
      </SettingsSection>
    );
  }
  return (
    <McpServerList
      key={workspace.workspace.workspaceId}
      workspaceId={workspace.workspace.workspaceId}
    />
  );
}

function McpServerList(props: { readonly workspaceId: Workspace.WorkspaceId }): React.ReactElement {
  const { workspaceId } = props;
  const [state, setState] = React.useState<PanelState>({ phase: "loading" });
  const [draft, setDraft] = React.useState<McpDraft | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  // The load lives in the effect, keyed by workspace and an explicit reload
  // tick: a stable dependency set, so the effect runs once per (workspace,
  // reload) and an unmounted or superseded load is dropped by its own flag.
  const [loadTick, setLoadTick] = React.useState(0);
  const reload = () => {
    setState({ phase: "loading" });
    setLoadTick((tick) => tick + 1);
  };

  React.useEffect(() => {
    let stale = false;
    loadRows(workspaceId).then(
      (rows) => {
        if (!stale) setState({ phase: "ready", rows });
      },
      (error: unknown) => {
        if (!stale) {
          setState({ phase: "failed", message: failureLine(error), code: errorCode(error) });
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [workspaceId, loadTick]);

  const runServerAction = (name: string, action: () => Promise<unknown>): void => {
    setPending(name);
    setFailure(null);
    void action()
      .then(
        () => undefined,
        (error: unknown) => {
          setFailure(failureLine(error));
        },
      )
      .then(() => {
        setPending(null);
        reload();
      });
  };

  const addServer = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (draft === null) return;
    const server = draft.name.trim();
    const [command, ...args] = draft.command
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (server.length === 0 || command === undefined) {
      setFailure("Enter a name and a command.");
      return;
    }
    setPending(server);
    setFailure(null);
    void requireHonkClient()
      .mcp.add({ workspaceId, server, command, ...(args.length === 0 ? {} : { args }) })
      .then(
        () => {
          setDraft(null);
        },
        (error: unknown) => {
          setFailure(failureLine(error));
        },
      )
      .then(() => {
        setPending(null);
        reload();
      });
  };

  return (
    <SettingsSection
      description={SECTION_DESCRIPTION}
      action={
        state.phase !== "ready" || draft !== null ? undefined : (
          <div {...stylex.props(styles.sectionAction)}>
            <Button
              size="sm"
              variant="neutral"
              onClick={() => {
                setFailure(null);
                setDraft({ name: "", command: "" });
              }}
            >
              Add server
            </Button>
          </div>
        )
      }
    >
      {draft === null ? null : (
        <form onSubmit={addServer}>
          <SettingsRows>
            <SettingsRow
              title="Name"
              description="How the chat refers to this server."
              control={
                <Field>
                  <Field.Input
                    required
                    autoFocus
                    size={28}
                    aria-label="MCP server name"
                    placeholder="linear"
                    value={draft.name}
                    disabled={pending !== null}
                    onChange={(event) => {
                      setDraft({ ...draft, name: event.currentTarget.value });
                    }}
                  />
                </Field>
              }
            />
            <SettingsRow
              title="Command"
              description="The executable and arguments, separated by spaces."
              control={
                <Field>
                  <Field.Input
                    required
                    size={28}
                    aria-label="MCP server command"
                    placeholder="npx -y @example/mcp-server"
                    value={draft.command}
                    disabled={pending !== null}
                    onChange={(event) => {
                      setDraft({ ...draft, command: event.currentTarget.value });
                    }}
                  />
                </Field>
              }
            />
            <SettingsRow
              title="Add server"
              description="Saved to this folder's Honk override file."
              control={
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="quiet"
                    disabled={pending !== null}
                    onClick={() => {
                      setDraft(null);
                      setFailure(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" variant="primary" disabled={pending !== null}>
                    {pending === null ? "Add" : "Adding…"}
                  </Button>
                  {pending === null ? null : <Spinner size="sm" />}
                </>
              }
            />
          </SettingsRows>
        </form>
      )}

      {state.phase === "loading" ? <SettingsStatus>Loading MCP servers…</SettingsStatus> : null}
      {state.phase === "failed" ? (
        // An untrusted workspace is a product state, not a failure to retry.
        state.code === "workspace.not_found" ? (
          <SettingsNote>{state.message}</SettingsNote>
        ) : (
          <SettingsFailure message={state.message} onRetry={reload} />
        )
      ) : null}
      {state.phase === "ready" && state.rows.length === 0 ? (
        <SettingsNote>No MCP servers configured.</SettingsNote>
      ) : null}
      {state.phase !== "ready" || state.rows.length === 0 ? null : (
        <SettingsRows>
          {state.rows.map((row) => (
            <SettingsRow
              key={row.name}
              title={row.name}
              description={SOURCE_LABELS[row.source]}
              control={
                <>
                  <Badge size="sm" tone="outline">
                    {row.transport}
                  </Badge>
                  {row.disabled ? (
                    <Badge size="sm" tone="neutral">
                      Disabled
                    </Badge>
                  ) : null}
                  {row.connected ? (
                    <>
                      <Badge size="sm" tone="ok">
                        Connected
                      </Badge>
                      <Text size="sm" tone="muted">
                        {`${String(row.tools)} ${row.tools === 1 ? "tool" : "tools"}`}
                      </Text>
                    </>
                  ) : null}
                  {pending === row.name ? <Spinner size="sm" /> : null}
                  {row.connected ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={pending !== null}
                      aria-busy={pending === row.name}
                      onClick={() => {
                        runServerAction(row.name, () =>
                          requireHonkClient().mcp.disconnect({ workspaceId, server: row.name }),
                        );
                      }}
                    >
                      Disconnect
                    </Button>
                  ) : row.disabled ? null : (
                    <Button
                      size="sm"
                      variant="neutral"
                      disabled={pending !== null}
                      aria-busy={pending === row.name}
                      onClick={() => {
                        runServerAction(row.name, () =>
                          requireHonkClient().mcp.connect({ workspaceId, server: row.name }),
                        );
                      }}
                    >
                      Connect
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={pending !== null}
                    aria-busy={pending === row.name}
                    onClick={() => {
                      runServerAction(row.name, () =>
                        requireHonkClient().mcp.remove({ workspaceId, server: row.name }),
                      );
                    }}
                  >
                    Remove
                  </Button>
                </>
              }
            />
          ))}
        </SettingsRows>
      )}
      {failure === null ? null : <SettingsAlert>{failure}</SettingsAlert>}
    </SettingsSection>
  );
}
