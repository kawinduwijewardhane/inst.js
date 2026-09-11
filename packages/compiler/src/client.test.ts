import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClient, verifyClientBuild } from "./client.js";

describe("buildClient", () => {
  it("builds an explicit browser entry and manifests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-client-"));
    try {
      await writeFile(
        path.join(root, "client.ts"),
        "document.documentElement.dataset.ready = 'true';\n",
        "utf8",
      );
      const first = await buildClient({
        root,
        entry: "client.ts",
        outDir: "dist",
        sourcemap: false,
      });
      const second = await buildClient({
        root,
        entry: "client.ts",
        outDir: "dist",
        sourcemap: false,
      });

      expect(first.manifest.kind).toBe("inst-client");
      expect(first.manifest.mode).toBe("production");
      expect(first.manifest.entry).toBe("client.ts");
      expect(first.manifest.output).toBe("dist/client/app.js");
      expect(first.manifest.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(first.assetManifest.kind).toBe("inst-assets");
      expect(first.assetManifest.entries).toEqual([
        expect.objectContaining({
          output: "dist/client/app.js",
          hash: first.manifest.hash,
        }),
      ]);
      expect(second.manifest.hash).toBe(first.manifest.hash);
      expect(second.assetManifest).toEqual(first.assetManifest);
      expect(await readFile(first.outputPath, "utf8")).toContain("document.documentElement");

      const verified = await verifyClientBuild({ root, outDir: "dist" });
      expect(verified.outputPath).toBe(first.outputPath);
      expect(verified.assetPaths).toEqual([first.outputPath]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tracks source maps as verified client assets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-client-assets-"));
    try {
      await writeFile(path.join(root, "client.ts"), "console.log('ready');\n", "utf8");
      const result = await buildClient({ root, entry: "client.ts", outDir: "dist" });

      expect(result.assetManifest.entries.map((entry) => entry.output)).toEqual([
        "dist/client/app.js",
        "dist/client/app.js.map",
      ]);

      const verified = await verifyClientBuild({ root, outDir: "dist" });
      expect(verified.assetPaths).toHaveLength(2);

      await writeFile(path.join(root, "dist/client/app.js.map"), "tampered\n", "utf8");
      await expect(verifyClientBuild({ root, outDir: "dist" })).rejects.toThrow(
        "client asset failed integrity verification",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the requested mode in browser replacements and metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-client-mode-"));
    try {
      await writeFile(
        path.join(root, "client.ts"),
        "document.body.dataset.mode = process.env.NODE_ENV;\n",
        "utf8",
      );
      const result = await buildClient({
        root,
        entry: "client.ts",
        outDir: "dist",
        mode: "development",
        sourcemap: false,
      });

      expect(result.manifest.mode).toBe("development");
      expect(await readFile(result.outputPath, "utf8")).toContain('"development"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects tampered browser output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-client-"));
    try {
      await writeFile(path.join(root, "client.ts"), "console.log('ready');\n", "utf8");
      const result = await buildClient({ root, entry: "client.ts", outDir: "dist", sourcemap: false });
      await writeFile(result.outputPath, "tampered\n", "utf8");
      await expect(verifyClientBuild({ root, outDir: "dist" })).rejects.toThrow("integrity verification");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps browser entries and output inside the project root", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "inst-client-boundary-"));
    const root = path.join(parent, "app");
    await mkdir(root);
    try {
      await writeFile(path.join(parent, "outside.ts"), "console.log('outside');\n", "utf8");
      await writeFile(path.join(root, "client.ts"), "console.log('inside');\n", "utf8");

      await expect(buildClient({ root, entry: "../outside.ts" })).rejects.toThrow("must stay within the project root");
      await expect(buildClient({ root, entry: "client.ts", outDir: "../dist" })).rejects.toThrow("must stay within the project root");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects the project root as client output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-client-root-output-"));
    try {
      await writeFile(path.join(root, "client.ts"), "console.log('inside');\n", "utf8");
      await expect(buildClient({ root, entry: "client.ts", outDir: "." })).rejects.toThrow(
        "build directory must be a child of the project root",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails clearly when the client entry is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-client-"));
    try {
      await expect(buildClient({ root, entry: "missing.ts" })).rejects.toThrow("client entry file not found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
