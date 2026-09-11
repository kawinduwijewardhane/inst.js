import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildServer, generateStatic, verifyServerBuild, verifyStaticBuild } from "./index.js";

describe("buildServer", () => {
  it("builds a deterministic server entry and manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-compiler-"));

    try {
      await writeFile(path.join(root, "app.ts"), "export const answer: number = 42;\n", "utf8");
      const first = await buildServer({ root, entry: "app.ts", outDir: "dist", sourcemap: false });
      const second = await buildServer({ root, entry: "app.ts", outDir: "dist", sourcemap: false });

      expect(first.manifest.kind).toBe("inst-server");
      expect(first.manifest.entry).toBe("app.ts");
      expect(first.manifest.output).toBe("dist/server/app.mjs");
      expect(first.manifest.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(second.manifest.hash).toBe(first.manifest.hash);
      expect(await readFile(first.outputPath, "utf8")).toContain("answer");

      const verified = await verifyServerBuild({ root, outDir: "dist" });
      expect(verified.outputPath).toBe(first.outputPath);
      expect(verified.manifest.hash).toBe(first.manifest.hash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes stale server output before rebuilding", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-compiler-"));
    try {
      await writeFile(path.join(root, "app.ts"), "export default 1;\n", "utf8");
      await buildServer({ root, entry: "app.ts", outDir: "dist", sourcemap: false });
      const stalePath = path.join(root, "dist", "server", "stale.mjs");
      await writeFile(stalePath, "stale\n", "utf8");
      await buildServer({ root, entry: "app.ts", outDir: "dist", sourcemap: false });
      await expect(stat(stalePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects server output that no longer matches its manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-compiler-"));
    try {
      await writeFile(path.join(root, "app.ts"), "export default 1;\n", "utf8");
      const result = await buildServer({ root, entry: "app.ts", outDir: "dist", sourcemap: false });
      await writeFile(result.outputPath, "tampered\n", "utf8");
      await expect(verifyServerBuild({ root, outDir: "dist" })).rejects.toThrow("integrity verification");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects manifest outputs outside the configured build directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-compiler-"));
    try {
      await writeFile(path.join(root, "app.ts"), "export default 1;\n", "utf8");
      const result = await buildServer({ root, entry: "app.ts", outDir: "dist", sourcemap: false });
      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as Record<string, unknown>;
      manifest.output = "app.ts";
      await writeFile(result.manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
      await expect(verifyServerBuild({ root, outDir: "dist" })).rejects.toThrow("outside its build directory");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps entries and build output inside the project root", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "inst-compiler-boundary-"));
    const root = path.join(parent, "app");
    await mkdir(root);
    try {
      await writeFile(path.join(parent, "outside.ts"), "export default 1;\n", "utf8");
      await writeFile(path.join(root, "app.ts"), "export default 1;\n", "utf8");

      await expect(buildServer({ root, entry: "../outside.ts" })).rejects.toThrow("must stay within the project root");
      await expect(buildServer({ root, entry: "app.ts", outDir: "../dist" })).rejects.toThrow("must stay within the project root");
      await expect(buildServer({ root, entry: "app.ts", outDir: "." })).rejects.toThrow(
        "build directory must be a child of the project root",
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("fails clearly when the application entry is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-compiler-"));
    try {
      await expect(buildServer({ root })).rejects.toThrow("Inst entry file not found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("generateStatic", () => {
  it("writes deterministic HTML files and verifies the static manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-static-"));
    const app = {
      fetch(request: Request) {
        const pathname = new URL(request.url).pathname;
        return new Response(`<h1>${pathname}</h1>`, { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    };

    try {
      const result = await generateStatic(app, { root, outDir: "dist", paths: ["/about", "/", "/about"], origin: "https://example.test" });
      expect(result.manifest.entries.map((entry) => entry.path)).toEqual(["/", "/about"]);
      expect(result.manifest.entries[0]?.output).toBe("dist/static/index.html");
      expect(result.manifest.entries[1]?.output).toBe("dist/static/about/index.html");
      expect(await readFile(path.join(root, "dist/static/index.html"), "utf8")).toBe("<h1>/</h1>");
      expect(await readFile(path.join(root, "dist/static/about/index.html"), "utf8")).toBe("<h1>/about</h1>");

      const verified = await verifyStaticBuild({ root, outDir: "dist" });
      expect(verified.outputPaths).toHaveLength(2);
      expect(verified.manifest.entries[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects non-HTML and unsuccessful static responses", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-static-"));
    try {
      await expect(generateStatic({ fetch: () => Response.json({ ok: true }) }, { root, paths: ["/"] })).rejects.toThrow("requires an HTML response");
      await expect(generateStatic({ fetch: () => new Response("missing", { status: 404 }) }, { root, paths: ["/missing"] })).rejects.toThrow("HTTP 404");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe static origins and output directories", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "inst-static-boundary-"));
    const root = path.join(parent, "app");
    await mkdir(root);
    const app = { fetch: () => new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }) };
    try {
      await expect(generateStatic(app, { root, outDir: "../dist", paths: ["/"] })).rejects.toThrow("must stay within the project root");
      await expect(generateStatic(app, { root, outDir: ".", paths: ["/"] })).rejects.toThrow(
        "build directory must be a child of the project root",
      );
      await expect(generateStatic(app, { root, paths: ["/"], origin: "file:///tmp/site" })).rejects.toThrow("must use HTTP or HTTPS");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects unsafe or ambiguous static paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-static-"));
    const app = { fetch: () => new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }) };
    try {
      await expect(generateStatic(app, { root, paths: ["about"] })).rejects.toThrow("Invalid static path");
      await expect(generateStatic(app, { root, paths: ["/about?draft=1"] })).rejects.toThrow("Invalid static path");
      await expect(generateStatic(app, { root, paths: ["/a/../b"] })).rejects.toThrow("must be normalized");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects tampered static output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-static-"));
    const app = { fetch: () => new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }) };
    try {
      const result = await generateStatic(app, { root, outDir: "dist", paths: ["/"] });
      await writeFile(result.outputPaths[0]!, "tampered", "utf8");
      await expect(verifyStaticBuild({ root, outDir: "dist" })).rejects.toThrow("integrity verification");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
