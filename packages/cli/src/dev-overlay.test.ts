import { describe, expect, it } from "vitest";
import {
  createDevStatusResponse,
  formatDevError,
  injectDevOverlay,
} from "./dev-overlay.js";

describe("development error overlay", () => {
  it("serializes development errors without caching", async () => {
    const error = new Error("createApplication is not defined");
    const info = formatDevError(error);
    const response = createDevStatusResponse(info, 4);

    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({
      ok: false,
      revision: 4,
      error: { message: "createApplication is not defined" },
    });
  });

  it("returns a healthy development status with its rebuild revision", async () => {
    const response = createDevStatusResponse(undefined, 7);
    expect(await response.json()).toEqual({ ok: true, error: null, revision: 7 });
  });

  it("injects the browser overlay and live reload client into HTML responses", async () => {
    const htmlResponse = new Response("<!doctype html><html><body><h1>ready</h1></body></html>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": "58",
      },
    });
    const injected = await injectDevOverlay(htmlResponse);
    const body = await injected.text();

    expect(body).toContain("data-inst-dev-overlay");
    expect(body).toContain("Inst build failed");
    expect(body).toContain("previousRevision !== revision");
    expect(body.indexOf("data-inst-dev-overlay")).toBeLessThan(body.indexOf("</body>"));
    expect(injected.headers.get("content-length")).toBeNull();
    expect(injected.headers.get("cache-control")).toBe("no-store");
  });

  it("turns development request failures into a readable browser error page", async () => {
    const response = new Response("Database connection failed", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
    const injected = await injectDevOverlay(response);
    const body = await injected.text();

    expect(injected.status).toBe(500);
    expect(injected.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(body).toContain("data-inst-dev-overlay");
    expect(body).toContain("Database connection failed");
    expect(body).toContain("Request failed");
  });

  it("does not modify non-HTML successful responses", async () => {
    const jsonResponse = Response.json({ ok: true });
    expect(await injectDevOverlay(jsonResponse)).toBe(jsonResponse);
  });

  it("keeps non-Error failures readable", () => {
    expect(formatDevError("build exploded")).toEqual({ message: "build exploded" });
  });
});
