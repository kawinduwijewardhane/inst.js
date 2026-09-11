import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withNodeAssets } from "./assets.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixtureFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inst-assets-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, name);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("withNodeAssets", () => {
  it("serves an explicitly mapped asset and preserves the fallback app", async () => {
    const filePath = await fixtureFile("app.js", "export const ready = true;\n");
    const app = withNodeAssets(
      {
        fetch(request) {
          return new Response(`fallback:${new URL(request.url).pathname}`);
        },
      },
      {
        assets: [{ pathname: "/.inst/client/app.js", filePath }],
      },
    );

    const asset = await app.fetch(new Request("http://localhost/.inst/client/app.js"));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(asset.headers.get("cache-control")).toBe("no-cache");
    expect(await asset.text()).toBe("export const ready = true;\n");

    const fallback = await app.fetch(new Request("http://localhost/hello"));
    expect(await fallback.text()).toBe("fallback:/hello");
  });

  it("serves HEAD without a response body", async () => {
    const filePath = await fixtureFile("app.js", "123456");
    const app = withNodeAssets(
      { fetch: () => new Response("fallback") },
      { assets: [{ pathname: "/asset.js", filePath }] },
    );

    const response = await app.fetch(
      new Request("http://localhost/asset.js", { method: "HEAD" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("6");
    expect(await response.text()).toBe("");
  });

  it("does not intercept non-GET asset requests", async () => {
    const filePath = await fixtureFile("app.js", "asset");
    const app = withNodeAssets(
      { fetch: () => new Response("fallback", { status: 202 }) },
      { assets: [{ pathname: "/asset.js", filePath }] },
    );

    const response = await app.fetch(
      new Request("http://localhost/asset.js", { method: "POST" }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("fallback");
  });

  it("fails closed for invalid and duplicate asset pathnames", async () => {
    const filePath = await fixtureFile("app.js", "asset");
    const fallback = { fetch: () => new Response("fallback") };

    expect(() =>
      withNodeAssets(fallback, {
        assets: [{ pathname: "asset.js", filePath }],
      }),
    ).toThrow("absolute URL path");

    expect(() =>
      withNodeAssets(fallback, {
        assets: [{ pathname: "//cdn.example/asset.js", filePath }],
      }),
    ).toThrow("absolute URL path");

    expect(() =>
      withNodeAssets(fallback, {
        assets: [{ pathname: "/assets/../asset.js", filePath }],
      }),
    ).toThrow("must be normalized");

    expect(() =>
      withNodeAssets(fallback, {
        assets: [
          { pathname: "/asset.js", filePath },
          { pathname: "/asset.js", filePath },
        ],
      }),
    ).toThrow("Duplicate Inst asset pathname");
  });

  it("returns non-cacheable 404 responses when a mapped file disappears", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "inst-assets-missing-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "missing.js");
    const app = withNodeAssets(
      { fetch: () => new Response("fallback") },
      { assets: [{ pathname: "/asset.js", filePath }] },
    );

    const response = await app.fetch(new Request("http://localhost/asset.js"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("Not Found");

    const head = await app.fetch(
      new Request("http://localhost/asset.js", { method: "HEAD" }),
    );
    expect(head.status).toBe(404);
    expect(head.headers.get("cache-control")).toBe("no-store");
  });

  it("surfaces mapped asset filesystem failures instead of disguising them as 404s", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "inst-assets-directory-"));
    temporaryDirectories.push(directory);
    const app = withNodeAssets(
      { fetch: () => new Response("fallback") },
      { assets: [{ pathname: "/asset.js", filePath: directory }] },
    );

    await expect(
      app.fetch(new Request("http://localhost/asset.js", { method: "HEAD" })),
    ).rejects.toThrow("not a regular file");
  });
});
