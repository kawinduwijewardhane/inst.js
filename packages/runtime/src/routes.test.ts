import { describe, expect, it } from "vitest";
import { createApplication } from "./index.js";

describe("InstApplication routes", () => {
  it("reports normalized application and plugin routes", async () => {
    const app = await createApplication({
      mode: "test",
      config: {
        plugins: [
          {
            name: "health",
            setup({ addRoute }) {
              addRoute({ method: "get", path: "health/", handle: () => new Response("ok") });
            },
          },
        ],
      },
    });

    app.route({ path: "/posts/:slug/", handle: () => new Response("post") });

    expect(app.routes()).toEqual([
      { path: "/posts/:slug" },
      { method: "GET", path: "/health" },
    ]);
  });

  it("returns route metadata without exposing handlers", async () => {
    const app = await createApplication({ mode: "test" });
    app.route({ method: "POST", path: "/items", handle: () => new Response("created") });

    expect(app.routes()).toEqual([{ method: "POST", path: "/items" }]);
  });
});
