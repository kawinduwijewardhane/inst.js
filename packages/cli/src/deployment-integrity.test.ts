import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";

describe("complete production builds", () => {
  it("rejects deletion of optional manifests and output after a failed rebuild", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-complete-"));
    try {
      await writeFile(path.join(root, "app.ts"), 'export default { fetch: () => new Response("ok"), routes: () => [{ path: "/" }] };');
      await writeFile(path.join(root, "client.ts"), 'console.log("browser");');
      await runCli(["build", root, "--entry", "app.ts", "--client-entry", "client.ts"]);
      await rm(path.join(root, ".inst/client-manifest.json"));
      await expect(runCli(["start", root, "--port", "0"])).rejects.toThrow("missing client-manifest.json");
      await expect(runCli(["build", root, "--entry", "app.ts", "--prerender", "/"])).rejects.toThrow("HTML response");
      await expect(runCli(["start", root, "--port", "0"])).rejects.toThrow("build is incomplete");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
