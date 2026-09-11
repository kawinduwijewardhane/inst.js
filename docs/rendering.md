# Rendering

Inst renders on the server by default. Route handlers return standard `Response` objects, while `@instjs/render` provides small helpers for producing safe HTML documents and streamed HTML without requiring browser JavaScript.

## HTML templates

Interpolated values in `html` templates are escaped automatically.

```ts
import { html } from "@instjs/render";

const name = "<Admin>";
const content = html`<h1>Hello ${name}</h1>`;
```

The result contains `Hello &lt;Admin&gt;`. Arrays of values are rendered recursively, and `null`, `undefined`, and `false` render as empty strings.

Use `raw()` only for HTML that is already trusted. Never pass request parameters, form values, database content, or other untrusted strings to `raw()` without an appropriate sanitizer.

## Complete documents and SEO

`documentResponse()` creates a standard HTML `Response` with a UTF-8 content type. Metadata is escaped before it is inserted into the document. Inst supports canonical, robots, Open Graph, and Twitter metadata without requiring raw head markup.

```ts
import { documentResponse, html } from "@instjs/render";

return documentResponse({
  meta: {
    title: "Account settings",
    description: "Manage your Inst account.",
    canonical: "https://example.com/settings",
    robots: "index,follow",
    openGraph: {
      title: "Account settings",
      description: "Manage your Inst account.",
      type: "website",
      url: "https://example.com/settings",
      image: "https://example.com/social/settings.png",
    },
    twitter: {
      card: "summary_large_image",
      title: "Account settings",
      image: "https://example.com/social/settings.png",
    },
  },
  body: html`<main><h1>Account settings</h1></main>`,
});
```

The renderer supplies `lang="en"`, UTF-8, and a responsive viewport by default. `meta.lang`, `meta.charset`, and `meta.viewport` can override those defaults.

Extra trusted head fragments can be added through `head`. Plain strings are escaped; use `raw()` when a fragment intentionally contains markup.

## Page layouts

Capability-first pages can wrap their view in one or more layouts without coupling layout behavior to folder names. A layout receives the same request context and typed page data as the view, plus `children` containing the rendered inner content.

```tsx
import { http } from "@instjs/core/units";
import { definePage } from "@instjs/render/page";

export default definePage({
  name: "account",
  trigger: http.get("/account"),
  data() {
    return { section: "Account" };
  },
  layout: ({ children, data }) => (
    <main aria-label={data.section}>
      <nav>Account navigation</nav>
      {children}
    </main>
  ),
  view({ data }) {
    return <h1>{data.section}</h1>;
  },
});
```

For composition, pass an array. Layouts are declared outermost first, so `[appShell, accountShell]` renders `appShell(accountShell(view))`. Layouts may be synchronous or asynchronous and do not add browser JavaScript by themselves.

## Response control

The second argument to `documentResponse()` is a normal `ResponseInit`. Existing headers are preserved.

```ts
return documentResponse(
  { body: html`<main>Cached</main>` },
  {
    status: 200,
    headers: { "cache-control": "public, max-age=60" },
  },
);
```

## Static generation

Production builds can render selected routes to deterministic HTML files. Repeat `--prerender` for each route that should be emitted as static output.

```bash
inst build --prerender / --prerender /about
```

Generated pages are written beneath `.inst/static/`, with `/` becoming `.inst/static/index.html` and `/about` becoming `.inst/static/about/index.html`. A `static-manifest.json` records each route, output path, and content hash. Static generation fails instead of silently writing an error page when a selected route returns a non-success status or a non-HTML response.

Only normalized pathnames are accepted. Query strings and fragments are intentionally excluded from the v1 static path contract.

## Streaming HTML

`streamHtml()` accepts an async iterable and exposes it as a Web `ReadableStream`. Trusted `HtmlContent` fragments pass through, while plain string chunks are escaped.

```ts
import { html, streamHtml } from "@instjs/render";

async function* content() {
  yield html`<h1>Report</h1>`;
  yield html`<p>${await loadSummary()}</p>`;
}

return streamHtml(content());
```

Streaming is useful when the first part of a response can be sent before slower work finishes. The helper uses Web Platform primitives, so application code does not depend on Node.js streams.

## Browser boundaries

Inst does not inject browser JavaScript into a server-rendered document. Scripts, modules, hydration, or other browser behavior must be added explicitly by the application or by a capability that owns that browser boundary. This keeps server-only code out of the browser graph and makes the default rendering path usable without JavaScript.
