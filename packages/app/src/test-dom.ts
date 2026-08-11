// Tiny React mount host for Node-only component tests. It implements only the
// DOM surface React and the app panels touch; no browser emulator dependency.

import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

interface TestRootContainer {
  readonly nodeType: number;
}

declare module "react-dom/client" {
  function createRoot(container: TestRootContainer): Root;
}

const dom = vi.hoisted(() => {
  class StubStyle {
    [property: string]: unknown;
    [property: symbol]: unknown;
  }

  class StubNode {
    [property: string]: unknown;
    readonly nodeType: number;
    readonly nodeName: string;
    readonly tagName: string | undefined;
    readonly childNodes: StubNode[] = [];
    parentNode: StubNode | null = null;
    readonly attributes = new Map<string, string>();
    readonly style = new Proxy(new StubStyle(), {
      get: (_target, prop) =>
        prop === "setProperty" || prop === "removeProperty"
          ? () => undefined
          : prop === "getPropertyValue"
            ? () => ""
            : "",
      set: () => true,
    });
    textContent = "";
    nodeValue: string | null = null;
    readonly namespaceURI = "http://www.w3.org/1999/xhtml";

    constructor(nodeType: number, nodeName: string) {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.tagName = nodeType === 1 ? nodeName : undefined;
    }

    get ownerDocument(): StubNode {
      return documentStub;
    }
    get firstChild(): StubNode | null {
      return this.childNodes[0] ?? null;
    }
    get lastChild(): StubNode | null {
      return this.childNodes[this.childNodes.length - 1] ?? null;
    }
    get nextSibling(): StubNode | null {
      if (this.parentNode === null) return null;
      const index = this.parentNode.childNodes.indexOf(this);
      return this.parentNode.childNodes[index + 1] ?? null;
    }
    appendChild(child: StubNode): StubNode {
      if (child.parentNode !== null) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(child: StubNode, before: StubNode | null): StubNode {
      if (child.parentNode !== null) child.parentNode.removeChild(child);
      child.parentNode = this;
      const index = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
      this.childNodes.splice(index, 0, child);
      return child;
    }
    removeChild(child: StubNode): StubNode {
      const index = this.childNodes.indexOf(child);
      if (index >= 0) this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    }
    setAttribute(name: string, value: unknown): void {
      this.attributes.set(name, String(value));
    }
    removeAttribute(name: string): void {
      this.attributes.delete(name);
    }
    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }
    toggleAttribute(name: string, force?: boolean): boolean {
      const next = force ?? !this.attributes.has(name);
      if (next) this.attributes.set(name, "");
      else this.attributes.delete(name);
      return next;
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    focus(): void {}
    contains(): boolean {
      return true;
    }
    closest(selector: string): StubNode | null {
      const attribute = /^\[([^\]]+)\]$/.exec(selector)?.[1];
      if (attribute === undefined) return null;
      if (this.attributes.has(attribute)) return this;
      return this.parentNode?.closest(selector) ?? null;
    }
    matches(): boolean {
      return false;
    }
    querySelector(): StubNode | null {
      return null;
    }
    querySelectorAll(): readonly StubNode[] {
      return [];
    }
  }

  class StubText extends StubNode {
    constructor(data: string) {
      super(3, "#text");
      this.nodeValue = data;
      this.textContent = data;
    }
  }

  class StubDocument extends StubNode {
    documentElement!: StubNode;
    head!: StubNode;
    body!: StubNode;
    activeElement!: StubNode;
    readonly defaultView = globalThis;

    constructor() {
      super(9, "#document");
    }
    createElement(tag: string): StubNode {
      return new StubNode(1, tag.toUpperCase());
    }
    createElementNS(_namespace: string, tag: string): StubNode {
      return new StubNode(1, tag.toUpperCase());
    }
    createTextNode(data: string): StubText {
      return new StubText(data);
    }
    getElementsByTagName(tag: string): readonly StubNode[] {
      return tag === "head" ? [this.head] : [];
    }
  }

  const documentStub = new StubDocument();
  documentStub.documentElement = new StubNode(1, "HTML");
  documentStub.head = documentStub.createElement("head");
  documentStub.body = documentStub.createElement("body");
  documentStub.activeElement = documentStub.body;

  Object.defineProperties(globalThis, {
    document: { configurable: true, writable: true, value: documentStub },
    window: { configurable: true, writable: true, value: globalThis },
    addEventListener: {
      configurable: true,
      writable: true,
      value: Reflect.get(globalThis, "addEventListener") ?? (() => undefined),
    },
    removeEventListener: {
      configurable: true,
      writable: true,
      value: Reflect.get(globalThis, "removeEventListener") ?? (() => undefined),
    },
    HTMLIFrameElement: {
      configurable: true,
      writable: true,
      value: class HTMLIFrameElement {},
    },
    Element: { configurable: true, writable: true, value: StubNode },
    HTMLElement: { configurable: true, writable: true, value: StubNode },
    customElements: {
      configurable: true,
      writable: true,
      value: { define: () => undefined, get: () => undefined },
    },
    navigator: {
      configurable: true,
      writable: true,
      value: Reflect.get(globalThis, "navigator") ?? { userAgent: "node" },
    },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
  });

  const textOf = (node: StubNode): string => {
    if (node.nodeType === 3) return node.nodeValue ?? "";
    if (node.childNodes.length === 0) return node.textContent;
    return node.childNodes.map(textOf).join("");
  };
  const labelsOf = (node: StubNode): readonly string[] => [
    ...(node.attributes.has("aria-label") ? [node.attributes.get("aria-label") ?? ""] : []),
    ...node.childNodes.flatMap(labelsOf),
  ];
  const find = (node: StubNode, tagName: string): StubNode | undefined => {
    if (node.tagName === tagName.toUpperCase()) return node;
    for (const child of node.childNodes) {
      const found = find(child, tagName);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const findByLabel = (node: StubNode, label: string): StubNode | undefined => {
    if (node.attributes.get("aria-label") === label) return node;
    for (const child of node.childNodes) {
      const found = findByLabel(child, label);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const propsOf = (node: StubNode): Readonly<Record<string, unknown>> => {
    const key = Object.keys(node).find((candidate) => candidate.startsWith("__reactProps$"));
    if (key === undefined) return {};
    const props = Reflect.get(node, key);
    return props instanceof Object ? Object.fromEntries(Object.entries(props)) : {};
  };

  return { document: documentStub, textOf, labelsOf, find, findByLabel, propsOf };
});

export interface MountedTestElement {
  readonly text: () => string;
  readonly labels: () => readonly string[];
  readonly propsOf: (tagName: string) => Readonly<Record<string, unknown>>;
  readonly invoke: (tagName: string, propName: string, ...args: unknown[]) => unknown;
  readonly invokeLabel: (label: string, propName: string, ...args: unknown[]) => unknown;
  readonly unmount: () => Promise<void>;
}

export async function mountTestElement(element: ReactElement): Promise<MountedTestElement> {
  const container = dom.document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    text: () => dom.textOf(container),
    labels: () => dom.labelsOf(container),
    propsOf: (tagName) => {
      const node = dom.find(container, tagName);
      if (node === undefined) throw new Error(`Expected mounted ${tagName}`);
      return dom.propsOf(node);
    },
    invoke: (tagName, propName, ...args) => {
      const node = dom.find(container, tagName);
      if (node === undefined) throw new Error(`Expected mounted ${tagName}`);
      const handler = dom.propsOf(node)[propName];
      if (!(handler instanceof Function)) {
        throw new Error(`Expected mounted ${tagName} to provide ${propName}`);
      }
      return Reflect.apply(handler, undefined, args);
    },
    invokeLabel: (label, propName, ...args) => {
      const node = dom.findByLabel(container, label);
      if (node === undefined) throw new Error(`Expected mounted element labelled ${label}`);
      const handler = dom.propsOf(node)[propName];
      if (!(handler instanceof Function)) {
        throw new Error(`Expected mounted element labelled ${label} to provide ${propName}`);
      }
      return Reflect.apply(handler, undefined, args);
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}
