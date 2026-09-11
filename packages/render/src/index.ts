const htmlBrand = Symbol("inst.html");

export interface HtmlContent {
  readonly [htmlBrand]: true;
  readonly value: string;
}

export interface OpenGraphMeta {
  readonly title?: string;
  readonly description?: string;
  readonly type?: string;
  readonly url?: string;
  readonly image?: string;
  readonly siteName?: string;
  readonly locale?: string;
}

export interface TwitterMeta {
  readonly card?: "summary" | "summary_large_image" | "app" | "player";
  readonly title?: string;
  readonly description?: string;
  readonly image?: string;
  readonly site?: string;
  readonly creator?: string;
}

export interface DocumentMeta {
  readonly title?: string;
  readonly description?: string;
  readonly canonical?: string;
  readonly lang?: string;
  readonly charset?: string;
  readonly viewport?: string;
  readonly robots?: string;
  readonly openGraph?: OpenGraphMeta;
  readonly twitter?: TwitterMeta;
}

export interface RenderDocumentOptions {
  readonly body: HtmlContent | string;
  readonly head?: readonly (HtmlContent | string)[];
  readonly meta?: DocumentMeta;
  readonly attributes?: Readonly<Record<string, string | boolean | undefined>>;
}

const attributeNamePattern = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function raw(value: string): HtmlContent {
  return { [htmlBrand]: true, value };
}

export function isHtmlContent(value: unknown): value is HtmlContent {
  return (
    typeof value === "object" &&
    value !== null &&
    htmlBrand in value &&
    (value as Partial<HtmlContent>)[htmlBrand] === true
  );
}

function renderValue(value: unknown): string {
  if (isHtmlContent(value)) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
}

export function html(
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
): HtmlContent {
  let output = strings[0] ?? "";

  for (let index = 0; index < values.length; index += 1) {
    output += renderValue(values[index]);
    output += strings[index + 1] ?? "";
  }

  return raw(output);
}

function assertAttributeName(name: string): void {
  if (!attributeNamePattern.test(name)) {
    throw new Error(`Invalid HTML attribute name: ${name}`);
  }
}

function renderAttributes(
  attributes: Readonly<Record<string, string | boolean | undefined>>,
): string {
  const rendered: string[] = [];

  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    assertAttributeName(name);
    if (value === true) {
      rendered.push(name);
      continue;
    }

    rendered.push(`${name}="${escapeHtml(value)}"`);
  }

  return rendered.length === 0 ? "" : ` ${rendered.join(" ")}`;
}

function metaTag(name: string, content: string | undefined): string {
  if (!content) return "";
  return `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`;
}

function propertyMetaTag(property: string, content: string | undefined): string {
  if (!content) return "";
  return `<meta property="${escapeHtml(property)}" content="${escapeHtml(content)}">`;
}

function openGraphTags(meta: OpenGraphMeta | undefined): string[] {
  if (!meta) return [];
  return [
    propertyMetaTag("og:title", meta.title),
    propertyMetaTag("og:description", meta.description),
    propertyMetaTag("og:type", meta.type),
    propertyMetaTag("og:url", meta.url),
    propertyMetaTag("og:image", meta.image),
    propertyMetaTag("og:site_name", meta.siteName),
    propertyMetaTag("og:locale", meta.locale),
  ];
}

function twitterTags(meta: TwitterMeta | undefined): string[] {
  if (!meta) return [];
  return [
    metaTag("twitter:card", meta.card),
    metaTag("twitter:title", meta.title),
    metaTag("twitter:description", meta.description),
    metaTag("twitter:image", meta.image),
    metaTag("twitter:site", meta.site),
    metaTag("twitter:creator", meta.creator),
  ];
}

export function renderDocument(options: RenderDocumentOptions): string {
  const meta = options.meta ?? {};
  const lang = meta.lang ?? "en";
  const charset = meta.charset ?? "utf-8";
  const viewport = meta.viewport ?? "width=device-width, initial-scale=1";
  const attributes = renderAttributes({
    lang,
    ...(options.attributes ?? {}),
  });

  const head = [
    `<meta charset="${escapeHtml(charset)}">`,
    `<meta name="viewport" content="${escapeHtml(viewport)}">`,
    meta.title ? `<title>${escapeHtml(meta.title)}</title>` : "",
    metaTag("description", meta.description),
    metaTag("robots", meta.robots),
    meta.canonical
      ? `<link rel="canonical" href="${escapeHtml(meta.canonical)}">`
      : "",
    ...openGraphTags(meta.openGraph),
    ...twitterTags(meta.twitter),
    ...(options.head ?? []).map(renderValue),
  ].join("");

  return `<!doctype html><html${attributes}><head>${head}</head><body>${renderValue(options.body)}</body></html>`;
}

export function documentResponse(
  options: RenderDocumentOptions,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }

  return new Response(renderDocument(options), {
    ...init,
    headers,
  });
}

export function streamHtml(
  source: AsyncIterable<HtmlContent | string>,
  init: ResponseInit = {},
): Response {
  const encoder = new TextEncoder();
  const iterator = source[Symbol.asyncIterator]();
  const headers = new Headers(init.headers);

  if (!headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(renderValue(next.value)));
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });

  return new Response(body, {
    ...init,
    headers,
  });
}
