import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyUnitManifest, writeUnitManifest } from "./units.js";
import { buildClient } from "./client.js";

describe("Unit deployment boundaries", () => {
  it("writes deterministic graphs and rejects changes to capability declarations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-unit-"));
    try {
      const graph = [{ path: "/", entry: "home", nodes: [{ name: "home", requires: ["title"], dependencies: [] }] }];
      await writeUnitManifest({ root }, graph);
      await verifyUnitManifest({ root }, graph);
      const target = path.join(root, ".inst/units-manifest.json");
      const original = await readFile(target, "utf8");
      await writeUnitManifest({ root }, graph);
      expect(await readFile(target, "utf8")).toBe(original);
      await writeFile(target, original.replace('"title"', '"secret"'));
      await expect(verifyUnitManifest({ root }, graph)).rejects.toThrow("does not match");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(["@instjs/core/units", "@instjs/runtime"])("rejects %s in browser builds", async (module) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-boundary-"));
    try {
      await writeFile(path.join(root, "client.ts"), `import * as server from ${JSON.stringify(module)}; console.log(server);`);
      await expect(buildClient({ root, entry: "client.ts" })).rejects.toThrow("Server-only Inst module");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
