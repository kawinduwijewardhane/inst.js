import { describe, expect, it } from "vitest";
import { html } from "./index.js";
import { definePage } from "./page.js";

const requestContext = (path = "/about") => ({
  request: new Request(`https://example.test${path}`),
  params: path === "/users/42" ? { id: "42" } : {},
  env: { mode: "development" as const, values: { APP_NAME: "Inst" } },
  signal: new AbortController().signal,
  state: new Map<string, unknown>(),
});

describe("definePage", () => {
  it("renders a view as a complete HTML document", async () => {
    const page = definePage({
      name: "about",
      trigger: { kind: "http", method: "GET", path: "/about" },
      meta: { title: "About" },
      view({ env }) {
        return html`<h1>${env.values.APP_NAME}</h1>`;
      },
    });

    const response = page.execute({ request: requestContext() });
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("<title>About</title>");
    expect(body).toContain("<h1>Inst</h1>");
  });

  it("loads typed async data before metadata and view rendering", async () => {
    const page = definePage({
      name: "profile",
      trigger: { kind: "http", method: "GET", path: "/users/:id" },
      async data({ params, env }) {
        await Promise.resolve();
        return { id: params.id, appName: env.values.APP_NAME ?? "App" };
      },
      meta({ data }) {
        return { title: `${data.appName} user ${data.id}` };
      },
      view({ data }) {
        return html`<h1>User ${data.id}</h1>`;
      },
    });

    const response = await page.execute({ request: requestContext("/users/42") });
    const body = await response.text();

    expect(body).toContain("<title>Inst user 42</title>");
    expect(body).toContain("<h1>User 42</h1>");
  });

  it("supports async views after synchronous data loading", async () => {
    const page = definePage({
      name: "status",
      trigger: { kind: "http", method: "GET", path: "/status" },
      data() {
        return { status: "ready" } as const;
      },
      async view({ data }) {
        await Promise.resolve();
        return html`<p>${data.status}</p>`;
      },
    });

    const response = await page.execute({ request: requestContext("/status") });
    expect(await response.text()).toContain("<p>ready</p>");
  });

  it("composes layouts around a page from outermost to innermost", async () => {
    const page = definePage({
      name: "dashboard",
      trigger: { kind: "http", method: "GET", path: "/dashboard" },
      data() {
        return { section: "Account" };
      },
      layout: [
        ({ children, data }) => html`<main data-section=${data.section}>${children}</main>`,
        ({ children }) => html`<section class="panel">${children}</section>`,
      ],
      view({ data }) {
        return html`<h1>${data.section}</h1>`;
      },
    });

    const response = await page.execute({ request: requestContext("/dashboard") });
    const body = await response.text();

    expect(body).toContain(
      '<main data-section=Account><section class="panel"><h1>Account</h1></section></main>',
    );
  });

  it("supports async layouts without changing page data", async () => {
    const page = definePage({
      name: "settings",
      trigger: { kind: "http", method: "GET", path: "/settings" },
      data() {
        return { label: "Settings" };
      },
      async layout({ children, data }) {
        await Promise.resolve();
        return html`<div aria-label=${data.label}>${children}</div>`;
      },
      view({ data }) {
        return html`<h1>${data.label}</h1>`;
      },
    });

    const response = await page.execute({ request: requestContext("/settings") });
    expect(await response.text()).toContain(
      "<div aria-label=Settings><h1>Settings</h1></div>",
    );
  });
});
