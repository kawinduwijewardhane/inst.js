import { describe, expect, it } from "vitest";
import { defineRoute } from "@instjs/core";
import { defineUnit, http } from "@instjs/core/units";
import { createApplication } from "./index.js";

describe("createApplication", () => {
  it("dispatches a request to a matching route", async () => {
    const app = await createApplication({ mode: "test" });

    app.route(
      defineRoute({
        path: "/hello/:name",
        handle({ params }) {
          return new Response(`Hello ${params.name}`);
        },
      }),
    );

    const response = await app.fetch(new Request("https://inst.test/hello/Inst"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello Inst");
  });

  it("registers a triggered unit directly", async () => {
    const hello = defineUnit({
      name: "hello",
      trigger: http.get("/hello/:name"),
      execute({ request }) {
        return new Response(`Hello ${request.params.name}`);
      },
    });
    const app = await createApplication({ mode: "test" });
    app.unit(hello);

    const response = await app.fetch(new Request("https://inst.test/hello/Inst"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello Inst");
    expect(app.units()[0]).toMatchObject({ method: "GET", path: "/hello/:name", entry: "hello" });
  });

  it("registers triggered units during application creation", async () => {
    const health = defineUnit({
      name: "health",
      trigger: http.get("/health"),
      execute() {
        return Response.json({ status: "ok" });
      },
    });
    const app = await createApplication({ mode: "test", units: [health] });

    const response = await app.fetch(new Request("https://inst.test/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("rejects direct unit registration without a trigger", async () => {
    const app = await createApplication({ mode: "test" });
    const unit = defineUnit({ name: "manual", execute: () => new Response("ok") });

    expect(() => app.unit(unit)).toThrow("Unit manual has no trigger");
  });

  it("falls back from HEAD to GET and omits the body", async () => {
    const app = await createApplication({ mode: "test" });
    app.route({
      method: "GET",
      path: "/resource",
      handle() {
        return new Response("payload", { headers: { etag: '"resource-1"' } });
      },
    });

    const response = await app.fetch(new Request("https://inst.test/resource", { method: "HEAD" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"resource-1"');
    expect(await response.text()).toBe("");
  });

  it("returns 405 with an Allow header when only the method mismatches", async () => {
    const app = await createApplication({ mode: "test" });
    app.route({ method: "GET", path: "/items", handle: () => new Response("items") });
    app.route({ method: "POST", path: "/items", handle: () => new Response("created") });

    const response = await app.fetch(new Request("https://inst.test/items", { method: "DELETE" }));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
    expect(await response.text()).toBe("Method Not Allowed");
  });

  it("omits the body from HEAD method-not-allowed responses", async () => {
    const app = await createApplication({ mode: "test" });
    app.route({ method: "POST", path: "/items", handle: () => new Response("created") });

    const response = await app.fetch(new Request("https://inst.test/items", { method: "HEAD" }));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.text()).toBe("");
  });

  it("treats malformed encoded route parameters as not found", async () => {
    const app = await createApplication({ mode: "test" });
    app.route({ path: "/items/:id", handle: () => new Response("item") });
    const response = await app.fetch(new Request("https://inst.test/items/%E0%A4%A"));
    expect(response.status).toBe(404);
  });

  it("returns a plain 404 for an unknown route", async () => {
    const app = await createApplication({ mode: "test" });
    const response = await app.fetch(new Request("https://inst.test/missing"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  it("omits the body from HEAD not-found responses", async () => {
    const app = await createApplication({ mode: "test" });
    const response = await app.fetch(new Request("https://inst.test/missing", { method: "HEAD" }));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("lets plugins register routes during setup", async () => {
    const app = await createApplication({
      mode: "test",
      config: {
        plugins: [
          {
            name: "health",
            setup({ addRoute }) {
              addRoute({ path: "/health", handle: () => Response.json({ status: "ok" }) });
            },
          },
        ],
      },
    });

    const response = await app.fetch(new Request("https://inst.test/health"));
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("runs middleware in registration order and shares request state", async () => {
    const calls: string[] = [];
    const app = await createApplication({
      mode: "test",
      config: {
        middleware: [
          async (context, next) => {
            calls.push("before:first");
            context.state.set("requestId", "req-1");
            const response = await next();
            calls.push("after:first");
            return response;
          },
          async (_context, next) => {
            calls.push("before:second");
            const response = await next();
            calls.push("after:second");
            return response;
          },
        ],
      },
    });

    app.route({
      path: "/state",
      handle({ state }) {
        calls.push("handler");
        return new Response(String(state.get("requestId")));
      },
    });

    const response = await app.fetch(new Request("https://inst.test/state"));
    expect(await response.text()).toBe("req-1");
    expect(calls).toEqual(["before:first", "before:second", "handler", "after:second", "after:first"]);
  });

  it("allows middleware to short-circuit a request", async () => {
    const app = await createApplication({ mode: "test" });
    app.middleware(() => new Response("Blocked", { status: 403 }));
    app.route({ path: "/private", handle: () => new Response("secret") });

    const response = await app.fetch(new Request("https://inst.test/private"));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Blocked");
  });

  it("uses a custom error handler when a request fails", async () => {
    const app = await createApplication({
      mode: "test",
      config: {
        onError(error, context) {
          return Response.json(
            {
              message: error instanceof Error ? error.message : "unknown",
              path: new URL(context.request.url).pathname,
            },
            { status: 503 },
          );
        },
      },
    });

    app.route({ path: "/boom", handle: () => { throw new Error("boom"); } });
    const response = await app.fetch(new Request("https://inst.test/boom"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "boom", path: "/boom" });
  });

  it("keeps the final error boundary when a custom error handler fails", async () => {
    const app = await createApplication({
      mode: "production",
      config: {
        onError() {
          throw new Error("error reporter secret");
        },
      },
    });
    app.route({ path: "/boom", handle: () => { throw new Error("database secret"); } });

    const response = await app.fetch(new Request("https://inst.test/boom"));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal Server Error");
  });

  it("does not expose thrown errors in production by default", async () => {
    const app = await createApplication({ mode: "production" });
    app.route({ path: "/boom", handle: () => { throw new Error("database password leaked"); } });

    const response = await app.fetch(new Request("https://inst.test/boom"));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal Server Error");
  });
});