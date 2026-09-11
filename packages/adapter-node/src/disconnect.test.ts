import { get, request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import { serve } from "./index.js";

describe("response lifecycle", () => {
  it("preserves repeated leading slashes in origin-form request paths", async () => {
    const server = await serve({ fetch: (request) => new Response(request.url) }, { hostname: "127.0.0.1", port: 0, origin: "https://public.example" });
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const request = httpRequest({ hostname: "127.0.0.1", port: server.url.port, path: "//account/settings?tab=profile" }, (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => { text += chunk; });
          response.once("end", () => resolve(text));
        });
        request.once("error", reject);
        request.end();
      });
      expect(body).toBe("https://public.example//account/settings?tab=profile");
    } finally { await server.close(); }
  });

  it("cancels a pending response stream when the client disconnects", async () => {
    let cancelled = false;
    let signal: AbortSignal | undefined;
    const server = await serve({
      fetch(request) {
        signal = request.signal;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode("first")); },
          cancel() { cancelled = true; },
        }));
      },
    }, { hostname: "127.0.0.1", port: 0 });
    try {
      await new Promise<void>((resolve, reject) => {
        get(server.url, (response) => {
          response.once("data", () => { response.destroy(); resolve(); });
          response.once("error", reject);
        }).once("error", reject);
      });
      await expect.poll(() => cancelled).toBe(true);
      expect(signal?.aborted).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("reports a usable URL when listening on IPv6 loopback", async () => {
    const server = await serve({ fetch: () => new Response("ipv6") }, { hostname: "::1", port: 0 });
    try {
      expect(server.url.hostname).toBe("[::1]");
      expect(await (await fetch(server.url)).text()).toBe("ipv6");
    } finally {
      await server.close();
    }
  });
});
