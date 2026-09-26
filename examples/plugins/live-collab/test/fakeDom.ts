// A tiny stand-in for the browser's DOM: just what the Share window (src/panel.ts) uses, so its buttons can be pressed in a Node test.
type Handler = (event: { key?: string }) => void;

export class El {
  attrs: Record<string, string> = {};
  children: (El | string)[] = [];
  listeners: Record<string, Handler[]> = {};
  style = { cssText: "" };
  className = "";
  value = "";
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  get id() {
    return this.attrs.id ?? "";
  }
  get readOnly() {
    return "readonly" in this.attrs;
  }
  get disabled() {
    return "disabled" in this.attrs;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  addEventListener(name: string, fn: Handler) {
    (this.listeners[name] ??= []).push(fn);
  }
  append(...nodes: (El | string)[]) {
    this.children.push(...nodes);
  }
  set textContent(_: string) {
    this.children = [];
  }
  set innerHTML(_: string) {}
  get textContent(): string {
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  all(): El[] {
    return this.children.flatMap((c) => (typeof c === "string" ? [] : [c, ...c.all()]));
  }
  querySelectorAll(tag: string) {
    return this.all().filter((e) => e.tag === tag);
  }
  querySelector<T = El>(selector: string): T | null {
    const id = /^#(.+)$/.exec(selector)?.[1];
    const tagAttr = /^([a-z]+)\[([a-z-]+)\]$/.exec(selector);
    return (this.all().find((e) => (id ? e.id === id : tagAttr ? e.tag === tagAttr[1] && tagAttr[2]! in e.attrs : e.tag === selector)) ?? null) as T | null;
  }
  getBoundingClientRect() {
    return { height: 300 };
  }
  focus() {}
  select() {}
  setSelectionRange() {}
  remove() {}
  /** Press a button (or fire any event) as the browser would. */
  fire(name: string, event: { key?: string } = {}) {
    for (const fn of this.listeners[name] ?? []) fn(event);
  }
}

export function fakeDocument() {
  const head = new El("head");
  return {
    head,
    activeElement: null,
    createElement: (tag: string) => new El(tag),
    querySelector: () => null,
  };
}

/** The button whose text is exactly `text`. */
export function button(root: El, text: string): El {
  const found = root.querySelectorAll("button").find((b) => b.textContent === text);
  if (!found) throw new Error(`no button "${text}" in: ${root.textContent}`);
  return found;
}

export const hasButton = (root: El, text: string) => root.querySelectorAll("button").some((b) => b.textContent === text);
export const input = (root: El, id: string): El => root.querySelector(`#${id}`)!;
