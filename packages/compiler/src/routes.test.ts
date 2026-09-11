import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRouteManifest, verifyRouteManifest, writeRouteManifest } from "./routes.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "inst-routes-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("route manifests", () => {
  it("writes deterministic normalized route metadata", async () => {
    const root = await tempRoot();
    const written = await writeRouteManifest({
      root,
      routes: [
        { method: "post", path: "/items" },
        { path: "/" },
        { method: "GET", path: "/items" },
      ],
    });

    expect(written.manifest.routes).toEqual([
      { path: "/" },
      { method: "GET", path: "/items" },
      { method: "POST", path: "/items" },
    ]);
    await expect(readRouteManifest({ root })).resolves.toEqual(written.manifest);
    await expect(
      verifyRouteManifest(
        { root },
        [
          { method: "POST", path: "/items" },
          { path: "/" },
          { method: "get", path: "/items" },
        ],
      ),
    ).resolves.toEqual(written.manifest);
  });

  it("rejects route manifests that do not match runtime routes", async () => {
    const root = await tempRoot();
    await writeRouteManifest({ root, routes: [{ path: "/" }] });
    await expect(
      verifyRouteManifest({ root }, [{ path: "/" }, { method: "GET", path: "/health" }]),
    ).rejects.toThrow("does not match the built application routes");
  });

  it("rejects duplicate route entries", async () => {
    const root = await tempRoot();
    await expect(
      writeRouteManifest({
        root,
        routes: [
          { method: "GET", path: "/items" },
          { method: "get", path: "/items" },
        ],
      }),
    ).rejects.toThrow("Duplicate Inst route manifest entry");
  });

  it("rejects project-root route output", async () => {
    const root = await tempRoot();
    await expect(writeRouteManifest({ root, outDir: ".", routes: [{ path: "/" }] })).rejects.toThrow(
      "build directory must be a child of the project root",
    );
  });

  it("rejects malformed persisted manifests", async () => {
    const root = await tempRoot();
    const outDir = path.join(root, ".inst");
    await writeRouteManifest({ root, routes: [{ path: "/" }] });
    await writeFile(
      path.join(outDir, "routes-manifest.json"),
      JSON.stringify({ version: 1, kind: "inst-routes", routes: [{ method: "get", path: "/" }] }),
      "utf8",
    );

    await expect(readRouteManifest({ root })).rejects.toThrow("unsupported shape");
  });
});
