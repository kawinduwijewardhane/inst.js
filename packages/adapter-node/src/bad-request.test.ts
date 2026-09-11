import { request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import { serve } from "./index.js";

describe("Node adapter bad requests", () => {
  it.each(["user@example.com", "example.com/", "example.com\\", "example.com?", "example.com#"])("rejects malformed Host authority %s without invoking the application", async (host) => {
    let applicationCalls = 0;
    const app = {
      fetch() {
        applicationCalls += 1;
        return new Response("application");
      },
    };
    const server = await serve(app, { hostname: "127.0.0.1", port: 0 });

    try {
      const result = await new Promise<{ status: number | undefined; cacheControl: string | undefined; body: string }>(
        (resolve, reject) => {
          const request = httpRequest(
            {
              hostname: "127.0.0.1",
              port: server.url.port,
              path: "/account",
              headers: { host },
              method: "GET",
            },
            (response) => {
              response.setEncoding("utf8");
              let body = "";
              response.on("data", (chunk: string) => {
                body += chunk;
              });
              response.on("end", () =>
                resolve({
                  status: response.statusCode,
                  cacheControl: response.headers["cache-control"],
                  body,
                }),
              );
            },
          );
          request.once("error", reject);
          request.end();
        },
      );

      expect(result.status).toBe(400);
      expect(result.cacheControl).toBe("no-store");
      expect(result.body).toBe("Bad Request");
      expect(applicationCalls).toBe(0);
    } finally {
      await server.close();
    }
  });
});
