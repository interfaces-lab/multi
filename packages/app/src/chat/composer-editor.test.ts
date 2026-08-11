// The node model, headless. These are the cases a textarea could not pass and
// the reason the composer is a Lexical editor at all: a mention is an object
// that serializes itself, so what the model receives and what the chip shows
// can never drift, and deleting the chip deletes the reference.

import { $getRoot, $isElementNode, createEditor } from "lexical";
import { describe, expect, it } from "vitest";

import {
  $seedComposerText,
  COMPOSER_EDITOR_NODES,
  ComposerMentionNode,
  ComposerResourceNode,
} from "./composer-editor";

// The same configuration the component builds, minus React.
const editorOf = () => createEditor({ namespace: "test", nodes: COMPOSER_EDITOR_NODES });

const read = (build: () => void): string => {
  const editor = editorOf();
  editor.update(build, { discrete: true });
  return editor.getEditorState().read(() => $getRoot().getTextContent());
};

const $inlineNodes = () =>
  $getRoot()
    .getChildren()
    .flatMap((child) => ($isElementNode(child) ? child.getChildren() : [child]));

const $append = (node: ComposerMentionNode | ComposerResourceNode): void => {
  $getRoot().getLastDescendant()?.insertAfter(node);
};

describe("seeding", () => {
  it("opens the editor on a stored draft", () => {
    expect(read(() => $seedComposerText("ship the goose"))).toBe("ship the goose");
  });

  it("leaves an empty draft empty", () => {
    expect(read(() => $seedComposerText(""))).toBe("");
  });
});

describe("mention nodes", () => {
  it("serializes as the workspace-relative path the model can act on", () => {
    const text = read(() => {
      $seedComposerText("look at ");
      $append(new ComposerMentionNode("src/chat/composer.tsx"));
    });
    expect(text).toBe("look at src/chat/composer.tsx");
  });

  it("takes the whole reference away when the node is removed", () => {
    // The property a substring search cannot give you: no reconciling, no
    // occurrence ids, no way for the payload to outlive the chip.
    const editor = editorOf();
    editor.update(
      () => {
        $seedComposerText("look at ");
        $append(new ComposerMentionNode("src/a.ts"));
      },
      { discrete: true },
    );
    editor.update(
      () => {
        $inlineNodes()
          .find((node) => node instanceof ComposerMentionNode)
          ?.remove();
      },
      { discrete: true },
    );
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("look at ");
  });

  it("survives a serialization round trip with its path intact", () => {
    const editor = editorOf();
    editor.update(
      () => {
        $seedComposerText("");
        $append(new ComposerMentionNode("deep/nested/file.ts"));
      },
      { discrete: true },
    );
    const json = JSON.stringify(editor.getEditorState().toJSON());
    const restored = editorOf();
    restored.setEditorState(restored.parseEditorState(json));
    expect(restored.getEditorState().read(() => $getRoot().getTextContent())).toBe(
      "deep/nested/file.ts",
    );
  });
});

describe("resource nodes", () => {
  it("serializes a skill and a command as the name Pi knows", () => {
    const skill = read(() => {
      $seedComposerText("");
      $append(new ComposerResourceNode("tidy", "skill"));
    });
    expect(skill).toBe("/tidy");

    const command = read(() => {
      $seedComposerText("");
      $append(new ComposerResourceNode("review", "command"));
    });
    expect(command).toBe("/review");
  });

  it("keeps which kind it is across a round trip, so the send picks the right verb", () => {
    const editor = editorOf();
    editor.update(
      () => {
        $seedComposerText("");
        $append(new ComposerResourceNode("review", "command"));
      },
      { discrete: true },
    );
    const json = JSON.stringify(editor.getEditorState().toJSON());
    const restored = editorOf();
    restored.setEditorState(restored.parseEditorState(json));
    const kind = restored
      .getEditorState()
      .read(
        () =>
          $inlineNodes().find((node) => node instanceof ComposerResourceNode)?.__resource ?? null,
      );
    expect(kind).toBe("command");
  });
});
