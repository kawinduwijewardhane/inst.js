import { describe, expect, it } from "vitest";
import { Router } from "./index.js";

describe("Router", () => {
  it("prefers static routes over parameters", () => {
    const router = new Router<string>()
      .add({ path: "/posts/:slug", value: "dynamic" })
      .add({ path: "/posts/new", value: "static" });

    expect(router.match("/posts/new")?.route.value).toBe("static");
  });

  it("decodes route parameters", () => {
    const router = new Router<string>().add({
      path: "/users/:name",
      value: "user",
    });

    expect(router.match("/users/Kawindu%20W")?.params).toEqual({
      name: "Kawindu W",
    });
  });

  it("rejects malformed encoded parameters without throwing", () => {
    const router = new Router<string>().add({ path: "/users/:name", value: "user" });
    expect(router.match("/users/%E0%A4%A")).toBeNull();
  });

  it("honors method-specific routes", () => {
    const router = new Router<string>()
      .add({ method: "GET", path: "/health", value: "read" })
      .add({ method: "POST", path: "/health", value: "write" });

    expect(router.match("/health", "POST")?.route.value).toBe("write");
  });

  it("normalizes registered and requested methods", () => {
    const router = new Router<string>().add({ method: "get", path: "/health", value: "read" });
    expect(router.match("/health", "get")?.route.method).toBe("GET");
  });

  it("exposes normalized registered routes in matching order", () => {
    const router = new Router<string>()
      .add({ method: "get", path: "posts/:slug/", value: "dynamic" })
      .add({ path: "/posts/new", value: "static" });

    expect(router.routes()).toEqual([
      { path: "/posts/new", value: "static" },
      { method: "GET", path: "/posts/:slug", value: "dynamic" },
    ]);
  });

  it("prefers method-specific routes over method-agnostic routes", () => {
    const router = new Router<string>()
      .add({ path: "/items", value: "fallback" })
      .add({ method: "POST", path: "/items", value: "write" });

    expect(router.match("/items", "POST")?.route.value).toBe("write");
    expect(router.match("/items", "PATCH")?.route.value).toBe("fallback");
  });

  it("uses GET routes for HEAD requests", () => {
    const router = new Router<string>().add({ method: "GET", path: "/health", value: "read" });
    expect(router.match("/health", "HEAD")?.route.value).toBe("read");
  });

  it("prefers an explicit HEAD route over the GET fallback", () => {
    const router = new Router<string>()
      .add({ method: "GET", path: "/health", value: "read" })
      .add({ method: "HEAD", path: "/health", value: "head" });

    expect(router.match("/health", "HEAD")?.route.value).toBe("head");
  });

  it("reports allowed methods and includes HEAD for GET routes", () => {
    const router = new Router<string>()
      .add({ method: "POST", path: "/items/:id", value: "write" })
      .add({ method: "GET", path: "/items/:id", value: "read" });

    expect(router.methods("/items/42")).toEqual(["GET", "HEAD", "POST"]);
    expect(router.methods("/missing")).toEqual([]);
  });

  it("reports methods only for the most specific matching route shape", () => {
    const router = new Router<string>()
      .add({ method: "POST", path: "/items/:id", value: "dynamic-write" })
      .add({ method: "GET", path: "/items/new", value: "static-read" });

    expect(router.methods("/items/new")).toEqual(["GET", "HEAD"]);
  });

  it("rejects duplicate route parameter names", () => {
    expect(() =>
      new Router<string>().add({ path: "/teams/:id/users/:id", value: "bad" }),
    ).toThrow("Duplicate route parameter :id");
  });

  it("rejects invalid route parameter names", () => {
    expect(() => new Router().add({ path: "/users/:user-id", value: null })).toThrow(
      "Invalid route parameter :user-id",
    );
    expect(() => new Router().add({ path: "/users/:__proto__", value: null })).toThrow(
      "Invalid route parameter :__proto__",
    );
    expect(() => new Router().add({ path: "/users/:constructor", value: null })).toThrow(
      "Invalid route parameter :constructor",
    );
    expect(() => new Router().add({ path: "/users/:9id", value: null })).toThrow(
      "Invalid route parameter :9id",
    );
  });

  it("rejects duplicate and structurally ambiguous route patterns", () => {
    const router = new Router<string>().add({ method: "GET", path: "/users/:id", value: "first" });
    expect(() => router.add({ method: "get", path: "/users/:name", value: "second" })).toThrow(
      "Duplicate route pattern",
    );

    const fallback = new Router<string>().add({ path: "/users/:id", value: "first" });
    expect(() => fallback.add({ path: "/users/:name", value: "second" })).toThrow(
      "Duplicate route pattern",
    );
  });

  it("rejects route definitions containing queries or fragments", () => {
    expect(() => new Router().add({ path: "/items?draft=1", value: null })).toThrow(
      "pathname without query or fragment",
    );
    expect(() => new Router().add({ path: "/items#details", value: null })).toThrow(
      "pathname without query or fragment",
    );
    expect(() => new Router().add({ path: "", value: null })).toThrow(
      "pathname without query or fragment",
    );
  });

  it("rejects invalid HTTP methods", () => {
    expect(() => new Router<string>().add({ method: "", path: "/", value: "bad" })).toThrow(
      "Invalid HTTP method",
    );
    expect(() => new Router<string>().add({ method: "GET POST", path: "/", value: "bad" })).toThrow(
      "Invalid HTTP method",
    );
  });

  it("returns null when nothing matches", () => {
    const router = new Router<string>().add({ path: "/", value: "home" });
    expect(router.match("/missing")).toBeNull();
  });
});
