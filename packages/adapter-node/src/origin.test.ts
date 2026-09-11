import { describe, expect, it } from "vitest";
import { createNodeHandler } from "./index.js";

describe("Node adapter origin validation", () => {
  const app = { fetch: () => new Response("ok") };

  it("accepts plain HTTP and HTTPS origins", () => {
    expect(() => createNodeHandler(app, { origin: "http://localhost:3000" })).not.toThrow();
    expect(() => createNodeHandler(app, { origin: "https://example.com" })).not.toThrow();
  });

  it.each([
    "https://example.com/base",
    "https://example.com?source=proxy",
    "https://example.com#fragment",
    "https://user@example.com",
    "https://user:secret@example.com",
  ])("rejects non-origin configuration: %s", (origin) => {
    expect(() => createNodeHandler(app, { origin })).toThrow(
      "origin must be an origin without credentials, path, query, or fragment",
    );
  });
});
