import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { writeDeploymentManifest } from "@instjs/compiler";

describe("production graph validation", () => {
  it("rejects missing or changed Unit manifests and development output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-unit-start-"));
    try {
      await writeFile(path.join(root, "app.ts"), 'export default { fetch: () => new Response("ok"), routes: () => [{ path: "/" }] };');
      await runCli(["build", root, "--entry", "app.ts"]);
      const unitPath = path.join(root, ".inst/units-manifest.json");
      const original = await readFile(unitPath, "utf8");
      await writeFile(unitPath, original.replace('"server"', '"browser"'));
      await writeDeploymentManifest(root, path.join(root, ".inst"));
      await expect(runCli(["start", root, "--port", "0"])).rejects.toThrow("Unit manifest does not match");
      await rm(unitPath);
      await expect(runCli(["start", root, "--port", "0"])).rejects.toThrow();
      await writeFile(unitPath, original);
      const serverPath = path.join(root, ".inst/manifest.json");
      const server = await readFile(serverPath, "utf8");
      await writeFile(serverPath, server.replace('"production"', '"development"'));
      await expect(runCli(["start", root, "--port", "0"])).rejects.toThrow("requires a production build");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
