import { describe, expect, it } from "vitest";
import { createApplication } from "@instjs/runtime";
import { serve } from "./index.js";

describe("response cookies", () => {
  it("preserves separate Set-Cookie fields through middleware and HEAD handling", async () => {
    const cookies = [
      "session=one; HttpOnly; Path=/; SameSite=Lax",
      "theme=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/",
    ];
    const app = await createApplication();
    app.middleware(async (_context, next) => {
      const response = await next();
      const headers = new Headers(response.headers);
      headers.set("x-middleware", "checked");
      return new Response(response.body, { headers, status: response.status });
    });
    app.route({ method: "GET", path: "/", handle() {
      const headers = new Headers();
      for (const cookie of cookies) headers.append("set-cookie", cookie);
      return new Response("cookies", { headers });
    } });
    const server = await serve(app, { hostname: "127.0.0.1", port: 0 });
    try {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(server.url, { method });
        expect(response.status).toBe(200);
        expect(response.headers.getSetCookie()).toEqual(cookies);
        expect(response.headers.get("x-middleware")).toBe("checked");
        expect(await response.text()).toBe(method === "HEAD" ? "" : "cookies");
      }
    } finally { await server.close(); }
  });
});
