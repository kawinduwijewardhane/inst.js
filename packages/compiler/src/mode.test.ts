import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildServer } from "./index.js";

describe("server build mode", () => {
  it("defaults production builds to production mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-mode-"));
    try {
      await writeFile(path.join(root, "app.ts"), "export default process.env.NODE_ENV;\n", "utf8");
      const result = await buildServer({ root, entry: "app.ts", outDir: "dist", sourcemap: false });
      expect(result.manifest.mode).toBe("production");
      expect(await readFile(result.outputPath, "utf8")).toContain('"production"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("compiles development mode explicitly", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-mode-"));
    try {
      await writeFile(path.join(root, "app.ts"), "export default process.env.NODE_ENV;\n", "utf8");
      const result = await buildServer({
        root,
        entry: "app.ts",
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
});
