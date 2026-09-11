import { get, request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import { createApplication } from "@instjs/runtime";
import { createNodeHandler, serve } from "./index.js";

describe("Node adapter", () => {
  it("serves Inst responses over Node HTTP", async () => {
    const app = await createApplication({ mode: "test" });
    app.route({
      path: "/hello/:name",
      handle({ params }) {
        return new Response(`Hello ${params.name}`);
      },
    });

    const server = await serve(app, { hostname: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(new URL("/hello/Inst", server.url));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Hello Inst");
    } finally {
      await server.close();
    }
  });

  it("does not write response bodies for HEAD requests", async () => {
    const app = {
      async fetch() {
        return new Response("payload", {
          headers: { "content-type": "text/plain", etag: '"head-test"' },
        });
      },
      route() {
        return this;
      },
      middleware() {
        return this;
      },
      async use() {
        return this;
      },
    };
    const server = await serve(app, { hostname: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(new URL("/resource", server.url), { method: "HEAD" });
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe('"head-test"');
      expect(await response.text()).toBe("");
    } finally {
      await server.close();
    }
  });

  it("forwards request bodies", async () => {
    const app = await createApplication({ mode: "test" });
    app.route({
      method: "POST",
      path: "/echo",
      async handle({ request }) {
        return new Response(await request.text());
      },
    });

    const server = await serve(app, { hostname: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(new URL("/echo", server.url), { method: "POST", body: "payload" });
      expect(await response.text()).toBe("payload");
    } finally {
      await server.close();
    }
  });

  it("uses the configured public origin for absolute-form request targets", async () => {
    const app = {
      fetch(request: Request) {
        return new Response(request.url);
      },
    };
    const server = await serve(app, {
      hostname: "127.0.0.1",
      port: 0,
      origin: "https://public.example",
    });

    try {
      const body = await new Promise<string>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port: server.url.port,
            path: "http://untrusted.example/account?tab=security",
            method: "GET",
          },
          (response) => {
            response.setEncoding("utf8");
            let content = "";
            response.on("data", (chunk: string) => {
              content += chunk;
            });
            response.on("end", () => resolve(content));
          },
        );
        request.once("error", reject);
        request.end();
      });

      expect(body).toBe("https://public.example/account?tab=security");
    } finally {
      await server.close();
    }
  });

  it("keeps absolute-form request targets on the Host origin by default", async () => {
    const app = {
      fetch(request: Request) {
        return new Response(request.url);
      },
    };
    const server = await serve(app, { hostname: "127.0.0.1", port: 0 });

    try {
      const body = await new Promise<string>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port: server.url.port,
            path: "http://untrusted.example/account?tab=security",
            headers: { host: "app.example:8080" },
            method: "GET",
          },
          (response) => {
            response.setEncoding("utf8");
            let content = "";
            response.on("data", (chunk: string) => {
              content += chunk;
            });
            response.on("end", () => resolve(content));
          },
        );
        request.once("error", reject);
        request.end();
      });

      expect(body).toBe("http://app.example:8080/account?tab=security");
    } finally {
      await server.close();
    }
  });

  it("rejects non-HTTP configured origins before serving", () => {
    expect(() =>
      createNodeHandler({ fetch: () => new Response("ok") }, { origin: "file:///tmp/app" }),
    ).toThrow("must use HTTP or HTTPS");
  });

  it("rejects ambiguous or non-path probe configuration before serving", () => {
    const app = { fetch: () => new Response("ok") };

    expect(() =>
      createNodeHandler(app, {
        probes: { healthPath: "health" },
      }),
    ).toThrow("healthPath must be an absolute pathname");
    expect(() =>
      createNodeHandler(app, {
        probes: { readinessPath: "/ready?deep=1" },
      }),
    ).toThrow("readinessPath must be an absolute pathname");
    expect(() =>
      createNodeHandler(app, {
        probes: { healthPath: "/probe", readinessPath: "/probe" },
      }),
    ).toThrow("healthPath and readinessPath must be different");
  });

  it("aborts the Web request when the client disconnects", async () => {
    let signal: AbortSignal | undefined;
    let resolveFetch: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const app = {
      fetch(request: Request) {
        signal = request.signal;
        resolveFetch?.();
        return new Promise<Response>((resolve) => {
          request.signal.addEventListener("abort", () => resolve(new Response("aborted")), { once: true });
        });
      },
    };
    const server = await serve(app, { hostname: "127.0.0.1", port: 0 });

    try {
      const client = get(new URL("/slow", server.url));
      client.on("error", () => undefined);
      await fetchStarted;
      client.destroy();

      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          if (signal?.aborted) {
            resolve();
            return;
          }
          if (Date.now() - started > 1000) {
            reject(new Error("request signal was not aborted"));
            return;
          }
          setTimeout(check, 10);
        };
        check();
      });

      expect(signal?.aborted).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("exposes configurable health and readiness probes", async () => {
    const app = await createApplication({ mode: "test" });
    const server = await serve(app, {
      hostname: "127.0.0.1",
      port: 0,
      probes: { health: () => true, ready: () => false },
    });

    try {
      const health = await fetch(new URL("/.inst/health", server.url));
      const ready = await fetch(new URL("/.inst/ready", server.url));
      const head = await fetch(new URL("/.inst/health", server.url), { method: "HEAD" });

      expect(health.status).toBe(200);
      expect(health.headers.get("cache-control")).toBe("no-store");
      expect(await health.json()).toEqual({ status: "ok" });
      expect(ready.status).toBe(503);
      expect(ready.headers.get("cache-control")).toBe("no-store");
      expect(await ready.json()).toEqual({ status: "not-ready" });
      expect(head.status).toBe(200);
      expect(head.headers.get("cache-control")).toBe("no-store");
      expect(await head.text()).toBe("");
    } finally {
      await server.close();
    }
  });

  it("rejects unsafe methods on probe endpoints without invoking the application", async () => {
    let applicationCalls = 0;
    const app = {
      fetch() {
        applicationCalls += 1;
        return new Response("application");
      },
    };
    const server = await serve(app, {
      hostname: "127.0.0.1",
      port: 0,
      probes: { health: () => true, ready: () => true },
    });

    try {
      const response = await fetch(new URL("/.inst/ready", server.url), {
        method: "POST",
        body: "ignored",
      });

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
      expect(applicationCalls).toBe(0);
    } finally {
      await server.close();
    }
  });
});
