import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeBuildDirectory, buildServer, generateStatic } from "./index.js";
import { buildClient } from "./client.js";

describe("build filesystem safety", () => {
  it("rejects equivalent spellings of the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-safe-"));
    try {
      await expect(assertSafeBuildDirectory(root, `${root}${path.sep}.`)).rejects.toThrow("child of the project root");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(["server", "client", "static"])("rejects linked output ancestors before %s cleanup", async (kind) => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "inst-safe-"));
    const root = path.join(parent, "project");
    const outside = path.join(parent, "outside");
    try {
      await mkdir(root);
      await mkdir(path.join(outside, kind), { recursive: true });
      await writeFile(path.join(outside, kind, "keep.txt"), "preserve");
      await writeFile(path.join(root, "app.ts"), "export default 1;");
      await symlink(outside, path.join(root, "output"), "junction");
      const operation = kind === "server"
        ? buildServer({ root, entry: "app.ts", outDir: "output" })
        : kind === "client" ? buildClient({ root, entry: "app.ts", outDir: "output" })
        : generateStatic({ fetch: () => new Response("ok") }, { root, outDir: "output", paths: [] });
      await expect(operation).rejects.toThrow("symbolic links");
      expect(await readFile(path.join(outside, kind, "keep.txt"), "utf8")).toBe("preserve");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects output directories containing the entry before deleting it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-safe-"));
    try {
      await mkdir(path.join(root, "output/server"), { recursive: true });
      const entry = path.join(root, "output/server/app.ts");
      await writeFile(entry, "export default 1;");
      await expect(buildServer({ root, entry, outDir: "output" })).rejects.toThrow("contains a source entry");
      expect(await readFile(entry, "utf8")).toBe("export default 1;");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(["https://user:secret@example.com", "https://example.com/path", "https://example.com?", "https://example.com#"])("rejects an ambiguous static origin %s", async (origin) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-origin-"));
    try {
      await expect(generateStatic({ fetch: () => new Response("ok") }, { root, paths: [], origin }))
        .rejects.toThrow("must not contain credentials");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
