import { escapeHtml, isHtmlContent, raw, type HtmlContent } from "./index.js";

export type InstChild = HtmlContent | string | number | bigint | boolean | null | undefined | readonly InstChild[];
export type InstComponent = (props: any) => InstChild;

export const Fragment = Symbol.for("inst.fragment");

const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const tagNamePattern = /^[A-Za-z][A-Za-z0-9:-]*$/;
const attributeNamePattern = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;

function renderChild(value: InstChild): string {
  if (isHtmlContent(value)) return value.value;
  if (Array.isArray(value)) return value.map((child) => renderChild(child)).join("");
  if (value === null || value === undefined || value === false || value === true) return "";
  return escapeHtml(value);
}

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function renderStyle(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const declarations: string[] = [];
  for (const [name, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined || entry === false) continue;
    declarations.push(`${kebabCase(name)}:${String(entry)}`);
  }
  return declarations.join(";");
}

function renderAttributes(props: Readonly<Record<string, unknown>>): string {
  const attributes: string[] = [];

  for (const [originalName, rawValue] of Object.entries(props)) {
    if (originalName === "children" || originalName === "key" || rawValue === undefined || rawValue === null || rawValue === false) continue;
    if (/^on[A-Z]/.test(originalName) || /^on[a-z]/.test(originalName)) {
      if (typeof rawValue === "function") {
        throw new Error(`Inst server JSX cannot serialize event handler ${originalName}. Use a client behavior for interactive code.`);
      }
    }

    const name = originalName === "className" ? "class" : originalName === "htmlFor" ? "for" : originalName;
    if (!attributeNamePattern.test(name)) throw new Error(`Invalid JSX attribute name: ${name}`);

    let value: unknown = rawValue;
    if (name === "style") value = renderStyle(rawValue);
    if (value === undefined || value === "") {
      if (rawValue === true) attributes.push(name);
      continue;
    }
    if (value === true) {
      attributes.push(name);
      continue;
    }

    attributes.push(`${name}="${escapeHtml(value)}"`);
  }

  return attributes.length === 0 ? "" : ` ${attributes.join(" ")}`;
}

function renderIntrinsic(tag: string, props: Readonly<Record<string, unknown>>): HtmlContent {
  if (!tagNamePattern.test(tag)) throw new Error(`Invalid JSX tag name: ${tag}`);
  const attributes = renderAttributes(props);
  if (voidElements.has(tag.toLowerCase())) return raw(`<${tag}${attributes}>`);
  return raw(`<${tag}${attributes}>${renderChild(props.children as InstChild)}</${tag}>`);
}

export function jsx(
  type: string | typeof Fragment | InstComponent,
  props: Record<string, unknown> | null,
): HtmlContent {
  const resolvedProps = props ?? {};
  if (type === Fragment) return raw(renderChild(resolvedProps.children as InstChild));
  if (typeof type === "function") return raw(renderChild(type(resolvedProps)));
  return renderIntrinsic(type, resolvedProps);
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export namespace JSX {
  export type Element = HtmlContent;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export interface IntrinsicAttributes {
    key?: string | number;
  }
  export interface IntrinsicElements {
    [elementName: string]: Record<string, unknown> & { children?: InstChild };
  }
}
