import type { DocumentMeta, HtmlContent } from "./index.js";
import { documentResponse } from "./index.js";

export interface PageRequestContext {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly env: {
    readonly mode: "development" | "production" | "test";
    readonly values: Readonly<Record<string, string | undefined>>;
  };
  readonly signal: AbortSignal;
  readonly state: Map<string, unknown>;
}

export interface PageRenderContext<TData = undefined> extends PageRequestContext {
  readonly data: TData;
}

export type PageViewResult = HtmlContent | string;

export interface PageLayoutContext<TData = undefined> extends PageRenderContext<TData> {
  readonly children: PageViewResult;
}

export type PageLayout<TData = undefined> = (
  context: PageLayoutContext<TData>,
) => PageViewResult | Promise<PageViewResult>;

export interface PageDefinition<TData = undefined> {
  readonly name: string;
  readonly trigger: {
    readonly kind: "http";
    readonly method?: string;
    readonly path: string;
  };
  readonly data?: (context: PageRequestContext) => TData | Promise<TData>;
  readonly meta?: DocumentMeta | ((context: PageRenderContext<TData>) => DocumentMeta);
  readonly head?:
    | readonly (HtmlContent | string)[]
    | ((context: PageRenderContext<TData>) => readonly (HtmlContent | string)[]);
  readonly attributes?: Readonly<Record<string, string | boolean | undefined>>;
  readonly layout?: PageLayout<TData> | readonly PageLayout<TData>[];
  readonly view: (context: PageRenderContext<TData>) => PageViewResult | Promise<PageViewResult>;
}

export interface InstPageUnit<TResult extends Response | Promise<Response> = Response> {
  readonly name: string;
  readonly trigger: PageDefinition["trigger"];
  readonly requires: readonly [];
  readonly dependencies: readonly [];
  execute(context: { readonly request: PageRequestContext }): TResult;
}

type SyncPageDefinition = PageDefinition<undefined> & {
  readonly data?: undefined;
  readonly layout?: undefined;
  readonly view: (context: PageRenderContext<undefined>) => PageViewResult;
};

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === "function";
}

function applyLayouts<TData>(
  layout: PageDefinition<TData>["layout"],
  context: PageRenderContext<TData>,
  body: PageViewResult,
): PageViewResult | Promise<PageViewResult> {
  const layouts = layout ? (Array.isArray(layout) ? layout : [layout]) : [];
  let rendered: PageViewResult | Promise<PageViewResult> = body;

  for (let index = layouts.length - 1; index >= 0; index -= 1) {
    const current = layouts[index];
    if (!current) continue;

    rendered = isPromiseLike(rendered)
      ? Promise.resolve(rendered).then((children) => current({ ...context, children }))
      : current({ ...context, children: rendered });
  }

  return rendered;
}

function renderPage<TData>(
  page: PageDefinition<TData>,
  context: PageRenderContext<TData>,
): Response | Promise<Response> {
  const meta = typeof page.meta === "function" ? page.meta(context) : page.meta;
  const head = typeof page.head === "function" ? page.head(context) : page.head;
  const view = page.view(context);

  const respond = (body: PageViewResult): Response | Promise<Response> => {
    const laidOut = applyLayouts(page.layout, context, body);
    const createResponse = (content: PageViewResult): Response =>
      documentResponse({
        ...(meta ? { meta } : {}),
        ...(head ? { head } : {}),
        ...(page.attributes ? { attributes: page.attributes } : {}),
        body: content,
      });

    return isPromiseLike(laidOut)
      ? Promise.resolve(laidOut).then(createResponse)
      : createResponse(laidOut);
  };

  return isPromiseLike(view) ? Promise.resolve(view).then(respond) : respond(view);
}

export function definePage(page: SyncPageDefinition): InstPageUnit<Response>;
export function definePage<TData>(page: PageDefinition<TData>): InstPageUnit<Response | Promise<Response>>;
export function definePage<TData>(page: PageDefinition<TData>): InstPageUnit<Response | Promise<Response>> {
  return Object.freeze({
    name: page.name,
    trigger: Object.freeze({ ...page.trigger }),
    requires: Object.freeze([]) as readonly [],
    dependencies: Object.freeze([]) as readonly [],
    execute(context: { readonly request: PageRequestContext }) {
      const request = context.request;
      if (!page.data) {
        return renderPage(page, { ...request, data: undefined as TData });
      }

      const loaded = page.data(request);
      if (isPromiseLike(loaded)) {
        return Promise.resolve(loaded).then((data) => renderPage(page, { ...request, data }));
      }

      return renderPage(page, { ...request, data: loaded });
    },
  });
}
