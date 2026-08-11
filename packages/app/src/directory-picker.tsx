import * as stylex from "@stylexjs/stylex";
import { basename } from "@honk/shared/paths";
import { Button, Field, Icon, ListRow, Separator, Text } from "@honk/ui";
import { IconFolder1, IconFolderOpen } from "@honk/ui/icons";
import * as React from "react";

const PICKER_WIDTH = "360px";
const PICKER_MAX_HEIGHT = "320px";
const RECENT_LIST_MAX_HEIGHT = "200px";
const EMPTY_DIRECTORY_PATHS: readonly string[] = Object.freeze([]);

const intrinsicStyles = stylex.create({
  pickerBounds: {
    width: PICKER_WIDTH,
    maxWidth: "100%",
    maxHeight: PICKER_MAX_HEIGHT,
  },
  recentListBounds: {
    maxHeight: RECENT_LIST_MAX_HEIGHT,
  },
});

function looksLikeDirectoryPath(value: string): boolean {
  return (
    value === "~" ||
    value.startsWith("~/") ||
    value.startsWith("~\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function DirectoryPicker({
  recentDirectories,
  excludedDirectories = EMPTY_DIRECTORY_PATHS,
  allowDirectPath = true,
  isPending = false,
  onSelect,
  onBrowse,
}: {
  readonly recentDirectories: readonly string[];
  readonly excludedDirectories?: readonly string[];
  readonly allowDirectPath?: boolean;
  readonly isPending?: boolean;
  readonly onSelect: (path: string) => void;
  readonly onBrowse?: () => void;
}): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const excludedDirectorySet = new Set(excludedDirectories);
  const visibleDirectories = recentDirectories.filter(
    (path) =>
      !excludedDirectorySet.has(path) &&
      (normalizedQuery.length === 0 || path.toLowerCase().includes(normalizedQuery)),
  );
  const directPath = query.trim();
  const canSubmitDirectPath = allowDirectPath && looksLikeDirectoryPath(directPath);

  const submit = (): void => {
    if (isPending) {
      return;
    }
    if (canSubmitDirectPath) {
      onSelect(directPath);
      return;
    }
    const first = visibleDirectories[0];
    if (first !== undefined) {
      onSelect(first);
    }
  };

  return (
    <div data-directory-picker="" {...stylex.props(intrinsicStyles.pickerBounds)}>
      <div className="flex max-h-[inherit] flex-col gap-gutter">
        <form
          className="flex items-center gap-gutter"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            submit();
          }}
        >
          <Field>
            <Field.Input
              aria-label={
                allowDirectPath ? "Search folders or enter a path" : "Search recent folders"
              }
              placeholder={
                allowDirectPath ? "Search folders or enter a path…" : "Search recent folders…"
              }
              value={query}
              disabled={isPending}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
            />
          </Field>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={isPending || (!canSubmitDirectPath && visibleDirectories.length === 0)}
          >
            Use folder
          </Button>
        </form>

        <div className="px-control-pad-x">
          <Text as="div" size="xs" tone="faint" weight="regular">
            Recent folders
          </Text>
        </div>
        <div {...stylex.props(intrinsicStyles.recentListBounds)}>
          <div className="flex max-h-[inherit] min-h-0 flex-col overflow-y-auto [scrollbar-width:thin]">
            {visibleDirectories.length === 0 ? (
              <div className="px-control-pad-x py-panel-pad font-ui text-detail text-faint">
                {canSubmitDirectPath ? "Press Enter to use this folder." : "No matching folders."}
              </div>
            ) : (
              visibleDirectories.map((path) => (
                <ListRow
                  key={path}
                  disabled={isPending}
                  onClick={() => {
                    onSelect(path);
                  }}
                >
                  <ListRow.Slot>
                    <Icon icon={IconFolder1} size="sm" tone="muted" />
                  </ListRow.Slot>
                  <ListRow.Content>
                    <ListRow.Title>{basename(path)}</ListRow.Title>
                    <ListRow.Description>{path}</ListRow.Description>
                  </ListRow.Content>
                </ListRow>
              ))
            )}
          </div>
        </div>

        {onBrowse !== undefined ? (
          <div className="flex flex-col">
            <Separator />
            <ListRow disabled={isPending} onClick={onBrowse}>
              <ListRow.Slot>
                <Icon icon={IconFolderOpen} size="sm" tone="muted" />
              </ListRow.Slot>
              <ListRow.Title>Choose folder…</ListRow.Title>
            </ListRow>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { DirectoryPicker };
