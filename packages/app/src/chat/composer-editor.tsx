// The composer's editor, shared by the start card and the thread reply.
//
// A mention is a node, not a substring. That is the whole design, and it is
// the one the released composer shipped (`ComposerMentionNode` in
// `HEAD:packages/app/src/composer/prompt-editor-nodes.tsx`). A `DecoratorNode`
// carries its own payload and serializes itself through `getTextContent()`, so
// the submitted string is `$getRoot().getTextContent()` and nothing else. No
// parallel array of attachments, no reconciling one against the other, and
// deleting a chip deletes what it referenced because the reference *is* the
// chip. A plain textarea cannot express that, which is why the previous pass
// degenerated into matching `@` + label against the draft text.
//
// The node kinds are exactly Pi's surface. A path mention is text Pi's file
// tools can act on. A skill and a command are Pi resources it invokes from its
// own list, so the chip carries the name and the host formats the invocation
// (`formatSkillInvocation`, `formatPromptTemplateInvocation`). Nothing here
// composes prompt text on Pi's behalf.

import { Icon } from "@honk/ui";
import { IconBuildingBlocks, IconConsoleSimple } from "@honk/ui/icons";
import { colorVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable, type ContentEditableProps } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { mergeRegister } from "@lexical/utils";
import * as stylex from "@stylexjs/stylex";
import { Schema } from "effect";
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type TextNode,
} from "lexical";
import * as React from "react";

import { basename } from "@honk/shared/paths";
import { Session } from "@honk/core/session";

import { composerKeyActionOf, type ComposerMessage } from "./composer-store";
import { MessageImages } from "./message-images";

const styles = stylex.create({
  editor: {
    outline: "none",
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    cursor: "text",
  },
  placeholder: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineStart: 0,
    pointerEvents: "none",
    userSelect: "none",
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
  },
  shell: { position: "relative", minHeight: 0, display: "flex", flexDirection: "column" },
  fileInput: { display: "none" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-state-hover"],
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-detail"],
    verticalAlign: "baseline",
  },
});

type SerializedMention = SerializedLexicalNode & { readonly path: string };

const decodeSerializedMention = Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }));

// A chip must not be enterable, or the caret parks inside it and backspace
// edits a payload the user cannot see.
function createChipHost(): HTMLElement {
  const element = document.createElement("span");
  element.contentEditable = "false";
  element.style.display = "inline";
  return element;
}

/**
 * One `@path` mention.
 *
 * `getTextContent()` returns the bare workspace-relative path, which is what
 * Pi's file tools take. The chip shows the basename because that is what
 * distinguishes one mention from another at a glance; the full path is still
 * what the model receives.
 */
export class ComposerMentionNode extends DecoratorNode<React.ReactElement> {
  readonly __path: string;

  static override getType(): string {
    return "composer-mention";
  }

  static override clone(node: ComposerMentionNode): ComposerMentionNode {
    return new ComposerMentionNode(node.__path, node.__key);
  }

  static override importJSON(serialized: SerializedLexicalNode): ComposerMentionNode {
    return new ComposerMentionNode(decodeSerializedMention(serialized).path);
  }

  constructor(path: string, key?: NodeKey) {
    super(key);
    this.__path = path;
  }

  override exportJSON(): SerializedMention {
    return { type: "composer-mention", version: 1, path: this.__path };
  }

  override createDOM(): HTMLElement {
    return createChipHost();
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return this.__path;
  }

  override isInline(): true {
    return true;
  }

  // Backspace selects the whole chip, then removes it. Half a mention is not
  // a state this node can be in.
  override isKeyboardSelectable(): boolean {
    return true;
  }

  override decorate(): React.ReactElement {
    return <span {...stylex.props(styles.chip)}>{basename(this.__path)}</span>;
  }
}

type SerializedResource = SerializedLexicalNode & {
  readonly name: string;
  readonly resource: "skill" | "command";
};

const decodeSerializedResource = Schema.decodeUnknownSync(
  Schema.Struct({
    name: Schema.String,
    resource: Schema.Literals(["skill", "command"]),
  }),
);

/**
 * One `/name` skill or command, held as the name Pi knows it by.
 *
 * The chip is the reason this is a node rather than text: a resource
 * invocation is a whole-message decision, and letting someone backspace half
 * of `/review` into `/revie` would silently turn a run into a typo. Deleting
 * the chip is the only edit, and it removes the invocation completely.
 *
 * `getTextContent()` is `/name` so a draft that also carries typed words
 * round-trips as something readable; the submit path reads the node itself
 * rather than parsing that back out.
 */
export class ComposerResourceNode extends DecoratorNode<React.ReactElement> {
  readonly __name: string;
  readonly __resource: "skill" | "command";

  static override getType(): string {
    return "composer-resource";
  }

  static override clone(node: ComposerResourceNode): ComposerResourceNode {
    return new ComposerResourceNode(node.__name, node.__resource, node.__key);
  }

  static override importJSON(serialized: SerializedLexicalNode): ComposerResourceNode {
    const node = decodeSerializedResource(serialized);
    return new ComposerResourceNode(node.name, node.resource);
  }

  constructor(name: string, resource: "skill" | "command", key?: NodeKey) {
    super(key);
    this.__name = name;
    this.__resource = resource;
  }

  override exportJSON(): SerializedResource {
    return {
      type: "composer-resource",
      version: 1,
      name: this.__name,
      resource: this.__resource,
    };
  }

  override createDOM(): HTMLElement {
    return createChipHost();
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return `/${this.__name}`;
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }

  override decorate(): React.ReactElement {
    return (
      <span {...stylex.props(styles.chip)}>
        <Icon
          icon={this.__resource === "skill" ? IconBuildingBlocks : IconConsoleSimple}
          size="xs"
          tone="muted"
        />
        {this.__name}
      </span>
    );
  }
}

function $createMentionNode(path: string): ComposerMentionNode {
  return $applyNodeReplacement(new ComposerMentionNode(path));
}

function $createResourceNode(name: string, resource: "skill" | "command"): ComposerResourceNode {
  return $applyNodeReplacement(new ComposerResourceNode(name, resource));
}

/** An image the user pasted or picked; Pi's prompt verbs carry these natively. */
export type ComposerImage = Session.PromptImage;

/**
 * What one submit carries: exactly `session.prompt`'s payload.
 *
 * `resource` is present when the draft names a skill or a command, which
 * routes the send to `run_skill` or `run_command` instead of `prompt`. `text`
 * is then the arguments, because that is what the user typed beside the chip.
 */
export interface ComposerSubmission {
  readonly text: string;
  readonly images: readonly ComposerImage[];
  readonly resource: { readonly kind: "skill" | "command"; readonly name: string } | null;
}

/**
 * Reads the editor as a submission.
 *
 * One walk of the root. The text is Lexical's own `getTextContent()`, so every
 * node contributes its serialized form and no second serializer can disagree
 * with the chips on screen.
 */
function $readSubmission(images: readonly ComposerImage[]): ComposerSubmission {
  const root = $getRoot();
  const found = $firstResource(root);
  const resource: ComposerSubmission["resource"] =
    found === null ? null : { kind: found.__resource, name: found.__name };
  const full = root.getTextContent();
  // The chip's own token comes out of the text: `run_skill` names the skill,
  // so leaving `/tidy` in the arguments would hand Pi the name twice.
  const text = resource === null ? full : full.replace(`/${resource.name}`, "").trim();
  return { text, images, resource };
}

/** Imperative operations the menu driver performs on the editor. */
export interface ComposerEditorHandle {
  readonly focus: () => void;
  /** Replaces the trigger token with a mention chip. */
  readonly insertMention: (trigger: { start: number; end: number }, path: string) => void;
  /** Replaces the trigger token with a skill or command chip. */
  readonly insertResource: (
    trigger: { start: number; end: number },
    resource: "skill" | "command",
    name: string,
  ) => void;
  /** Replaces the trigger token with plain text, for a command awaiting arguments. */
  readonly insertText: (trigger: { start: number; end: number }, text: string) => void;
  /** Appends text at the end, for focus-on-type. */
  readonly appendText: (text: string) => void;
  readonly read: () => ComposerSubmission;
  /** New intent: replace the message and cancel its in-flight image reads. */
  readonly replace: (message: ComposerMessage) => void;
  /** Same intent: reconcile the message without cancelling image reads. */
  readonly reconcile: (message: ComposerMessage) => void;
  readonly chooseImages: () => void;
  readonly clear: () => void;
  /** The live DOM rect of the trigger token, for anchoring the menu. */
  readonly triggerRect: (start: number) => DOMRect | null;
}

/**
 * The draft's resource chip, if it has one.
 *
 * First wins, and there is only ever one worth honoring: a message runs as a
 * skill, as a command, or as a prompt, so a second chip is text the user is
 * still editing rather than a second turn.
 */
function $firstResource(node: LexicalNode): ComposerResourceNode | null {
  if (node instanceof ComposerResourceNode) return node;
  if (!$isElementNode(node)) return null;
  for (const child of node.getChildren()) {
    const found = $firstResource(child);
    if (found !== null) return found;
  }
  return null;
}

export const COMPOSER_EDITOR_NAMESPACE = "honk-composer";

/**
 * The shared editor.
 *
 * Keyboard ownership is the subtle part: while the menu is open it owns Enter,
 * Tab, the arrows, and the first Escape, and it must win before Lexical's own
 * handlers see them. Registering at `COMMAND_PRIORITY_HIGH` and returning true
 * is how Lexical expresses that, and it is why the menu's keyboard contract
 * lives in the editor rather than on a `keydown` prop.
 */
export interface ComposerEditorProps {
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly autoFocus?: boolean;
  /**
   * The draft this editor opens with.
   *
   * Read once, at construction. `composer-store` owns the text so it survives
   * route changes, and an editor that started empty would throw that away
   * every time the surface remounted.
   */
  readonly initialText: string;
  readonly initialImages: readonly ComposerImage[];
  readonly readOnly?: boolean;
  readonly containerStyle?: stylex.StyleXStyles;
  readonly editorStyle?: stylex.StyleXStyles;
  readonly handleRef: React.MutableRefObject<ComposerEditorHandle | null>;
  /** Fires with the complete draft and the caret offset after every edit. */
  readonly onChange: (message: ComposerMessage, caret: number) => void;
  /** True while selected files are still becoming message images. */
  readonly onImageReadPendingChange: (pending: boolean) => void;
  readonly onSubmit: (sendNow: boolean) => void;
  /** Cancels the owning surface when Escape is not first closing an open menu. */
  readonly onEscape?: () => void;
  /** Null for plain-message editors that never expose suggestions. */
  readonly menu: {
    readonly open: boolean;
    readonly listboxId: string;
    readonly activeOptionId: string | null;
    readonly accept: () => void;
    readonly dismiss: () => void;
    readonly move: (delta: number) => void;
  } | null;
}

/** The node set the editor understands; shared with headless tests. */
export const COMPOSER_EDITOR_NODES = [ComposerMentionNode, ComposerResourceNode];

/** Fills an empty editor with the stored draft. Runs inside an editor update. */
export function $seedComposerText(text: string): void {
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(text));
  $getRoot().append(paragraph);
}

export function ComposerEditor(props: ComposerEditorProps): React.ReactElement {
  const initialText = props.initialText;
  const initialConfig: InitialConfigType = {
    namespace: COMPOSER_EDITOR_NAMESPACE,
    editable: true,
    nodes: COMPOSER_EDITOR_NODES,
    ...(initialText.length === 0
      ? {}
      : {
          editorState: () => {
            $seedComposerText(initialText);
          },
        }),
    onError: (error) => {
      throw error;
    },
  };
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ComposerEditorInner {...props} />
    </LexicalComposer>
  );
}

function ComposerEditorInner(props: ComposerEditorProps): React.ReactElement {
  const [editor] = useLexicalComposerContext();
  const [images, setImages] = React.useState<readonly ComposerImage[]>(props.initialImages);
  const imagesRef = React.useRef(images);
  imagesRef.current = images;
  const imageReadVersion = React.useRef(0);
  const pendingImageCountRef = React.useRef(0);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  // Lexical owns the command listeners' lifetime, so the latest callbacks are
  // reached through a ref rather than by re-registering on every render.
  const menuRef = React.useRef(props.menu);
  menuRef.current = props.menu;
  const submitRef = React.useRef(props.onSubmit);
  submitRef.current = props.onSubmit;
  const escapeRef = React.useRef(props.onEscape);
  escapeRef.current = props.onEscape;

  React.useLayoutEffect(() => {
    props.handleRef.current = makeHandle(
      editor,
      imagesRef,
      imageReadVersion,
      pendingImageCountRef,
      setImages,
      fileInputRef,
      props.onImageReadPendingChange,
    );
    return () => {
      imageReadVersion.current += 1;
      props.handleRef.current = null;
    };
  }, [editor, props.handleRef, props.onImageReadPendingChange]);

  React.useEffect(() => {
    editor.setEditable(props.readOnly !== true);
  }, [editor, props.readOnly]);

  React.useEffect(
    () => () => {
      props.onImageReadPendingChange(false);
    },
    [props.onImageReadPendingChange],
  );

  const reportImages = (next: readonly ComposerImage[]): void => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      const text = $getRoot().getTextContent();
      props.onChange(
        { text, images: next },
        $isRangeSelection(selection) ? $caretOffset() : text.length,
      );
    });
  };
  const replaceImages = (next: readonly ComposerImage[]): void => {
    imagesRef.current = next;
    setImages(next);
    reportImages(next);
  };
  const appendFiles = (files: readonly File[]): void => {
    const available = Math.max(
      0,
      Session.PROMPT_IMAGE_MAX_COUNT - imagesRef.current.length - pendingImageCountRef.current,
    );
    const accepted = files
      .filter(
        (file) =>
          file.size <= Session.PROMPT_IMAGE_MAX_BYTES &&
          /^image\/[a-z0-9][a-z0-9.+-]*$/i.test(file.type),
      )
      .slice(0, available);
    if (accepted.length === 0) return;
    const version = imageReadVersion.current;
    pendingImageCountRef.current += accepted.length;
    props.onImageReadPendingChange(true);
    void Promise.allSettled(accepted.map(readImage))
      .then((results) => {
        // A replace means the user entered/canceled an edit while the picker was
        // reading. Do not attach the old intent's files to the new message.
        if (version !== imageReadVersion.current) return;
        const read = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        if (read.length === 0) return;
        replaceImages([...imagesRef.current, ...read]);
      })
      .finally(() => {
        if (version !== imageReadVersion.current) return;
        pendingImageCountRef.current -= accepted.length;
        props.onImageReadPendingChange(pendingImageCountRef.current > 0);
      });
  };

  React.useEffect(
    () =>
      mergeRegister(
        // Enter is the one key with real branching, and the branching is
        // `composer-store`'s tested rule rather than a second copy of it here.
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            const action = composerKeyActionOf(
              {
                key: "Enter",
                shiftKey: event?.shiftKey === true,
                mod: event?.metaKey === true || event?.ctrlKey === true,
              },
              menuRef.current?.open === true,
            );
            if (action === "newline" || action === "none") return false;
            event?.preventDefault();
            if (action === "menu-accept") menuRef.current?.accept();
            else if (pendingImageCountRef.current === 0) {
              submitRef.current(action === "submit-now");
            }
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_TAB_COMMAND,
          (event) => {
            if (menuRef.current?.open !== true) return false;
            event.preventDefault();
            menuRef.current.accept();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          (event) => {
            if (menuRef.current?.open === true) {
              menuRef.current.dismiss();
              return true;
            }
            if (escapeRef.current === undefined) return false;
            event?.preventDefault();
            escapeRef.current();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ARROW_DOWN_COMMAND,
          (event) => {
            if (menuRef.current?.open !== true) return false;
            event.preventDefault();
            menuRef.current.move(1);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ARROW_UP_COMMAND,
          (event) => {
            if (menuRef.current?.open !== true) return false;
            event.preventDefault();
            menuRef.current.move(-1);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        // Pasted images ride the message natively: core's three prompt verbs
        // all take `images`, so this needs no attachment machinery of its own.
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            if (!(event instanceof ClipboardEvent)) return false;
            const items = event.clipboardData?.items;
            if (items === undefined) return false;
            const files = [...items].flatMap((item) => {
              if (!item.type.startsWith("image/")) return [];
              const file = item.getAsFile();
              return file === null ? [] : [file];
            });
            if (files.length === 0) return false;
            event.preventDefault();
            appendFiles(files);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [editor],
  );

  const autoFocus = props.autoFocus ?? false;
  React.useEffect(() => {
    if (autoFocus) editor.focus();
  }, [editor, autoFocus]);

  // The editor is the combobox and the menu is its listbox: focus never leaves
  // here, so this element is what announces the open list and the active row.
  const menu = props.menu;
  const menuAccessibility: Pick<
    ContentEditableProps,
    "aria-expanded" | "aria-autocomplete" | "aria-haspopup"
  > =
    menu === null
      ? {}
      : {
          "aria-expanded": menu.open,
          "aria-autocomplete": "list",
          "aria-haspopup": "listbox",
        };
  return (
    <div {...stylex.props(styles.shell, props.containerStyle)}>
      <MessageImages
        images={images}
        {...(props.readOnly === true
          ? {}
          : {
              onRemove: (index: number) => {
                replaceImages(imagesRef.current.filter((_image, at) => at !== index));
              },
            })}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={props.readOnly === true}
        tabIndex={-1}
        aria-hidden="true"
        {...stylex.props(styles.fileInput)}
        onChange={(event) => {
          appendFiles([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = "";
        }}
      />
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            aria-label={props.ariaLabel}
            role={menu === null ? "textbox" : "combobox"}
            aria-multiline="true"
            {...menuAccessibility}
            autoFocus={autoFocus}
            {...(menu?.open === true
              ? {
                  "aria-controls": menu.listboxId,
                  ...(menu.activeOptionId === null
                    ? {}
                    : { "aria-activedescendant": menu.activeOptionId }),
                }
              : {})}
            {...stylex.props(styles.editor, props.editorStyle)}
          />
        }
        // Lexical renders the placeholder beside the editable, so it needs the
        // same caller-owned inset and type geometry to occupy the same line.
        placeholder={
          <div {...stylex.props(props.editorStyle, styles.placeholder)}>{props.placeholder}</div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin
        onChange={(state) => {
          state.read(() => {
            const selection = $getSelection();
            const text = $getRoot().getTextContent();
            props.onChange(
              { text, images: imagesRef.current },
              $isRangeSelection(selection) ? $caretOffset() : text.length,
            );
          });
        }}
      />
    </div>
  );
}

async function readImage(file: File): Promise<ComposerImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result === null || result instanceof ArrayBuffer) {
        reject(new Error(`Could not read image ${file.name}`));
      } else resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read image ${file.name}`));
    reader.readAsDataURL(file);
  });
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error(`Could not encode image ${file.name}`);
  return { data: dataUrl.slice(separator + 1), mimeType: file.type };
}

/**
 * The caret as a whole-document offset.
 *
 * The trigger model works on one flat string, so the editor has to speak the
 * same coordinate. Summing `getTextContent()` over the nodes before the
 * selection is what makes a decorator chip count for its serialized length
 * rather than for one character.
 */
function $caretOffset(): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return 0;
  const anchor = selection.anchor;
  let offset = 0;
  for (const node of $getRoot().getAllTextNodes()) {
    if (node.getKey() === anchor.key) return offset + anchor.offset;
    offset += node.getTextContentSize();
  }
  return offset + anchor.offset;
}

function makeHandle(
  editor: LexicalEditor,
  images: React.MutableRefObject<readonly ComposerImage[]>,
  imageReadVersion: React.MutableRefObject<number>,
  pendingImageCount: React.MutableRefObject<number>,
  setImages: React.Dispatch<React.SetStateAction<readonly ComposerImage[]>>,
  fileInput: React.RefObject<HTMLInputElement | null>,
  onImageReadPendingChange: (pending: boolean) => void,
): ComposerEditorHandle {
  const replaceTrigger = (
    trigger: { start: number; end: number },
    build: () => ComposerMentionNode | ComposerResourceNode | TextNode,
  ): void => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const node = selection.anchor.getNode();
      if (!$isTextNode(node)) return;
      const removal = trigger.end - trigger.start;
      const at = selection.anchor.offset;
      const target = at >= removal ? node.spliceText(at - removal, removal, "", true) : node;
      const inserted = build();
      target.insertAfter(inserted);
      inserted.insertAfter($createTextNode(" "));
      inserted.getNextSibling()?.selectEnd();
    });
  };

  const seedMessage = (message: ComposerMessage): void => {
    images.current = message.images;
    setImages(message.images);
    editor.update(() => {
      $getRoot().clear();
      if (message.text.length > 0) $seedComposerText(message.text);
    });
  };
  const replaceIntent = (message: ComposerMessage): void => {
    imageReadVersion.current += 1;
    pendingImageCount.current = 0;
    onImageReadPendingChange(false);
    seedMessage(message);
  };

  return {
    focus: () => editor.focus(),
    insertMention: (trigger, path) => {
      replaceTrigger(trigger, () => $createMentionNode(path));
    },
    insertResource: (trigger, resource, name) => {
      replaceTrigger(trigger, () => $createResourceNode(name, resource));
    },
    insertText: (trigger, text) => {
      replaceTrigger(trigger, () => $createTextNode(text));
    },
    appendText: (text) => {
      editor.update(() => {
        $getRoot().selectEnd();
        $getSelection()?.insertText(text);
      });
    },
    read: () => editor.getEditorState().read(() => $readSubmission(images.current)),
    replace: replaceIntent,
    reconcile: seedMessage,
    chooseImages: () => {
      fileInput.current?.click();
    },
    clear: () => {
      replaceIntent({ text: "", images: [] });
    },
    triggerRect: (start) => {
      const root = editor.getRootElement();
      if (root === null) return null;
      const range = document.createRange();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let current = walker.nextNode();
      while (current !== null) {
        const length = current.textContent?.length ?? 0;
        if (seen + length >= start) {
          range.setStart(current, start - seen);
          range.setEnd(current, start - seen);
          // The first client rect, not the union: a wrapped token's union
          // spans the whole line and would drag the menu away from the caret.
          return range.getClientRects()[0] ?? range.getBoundingClientRect();
        }
        seen += length;
        current = walker.nextNode();
      }
      return null;
    },
  };
}
