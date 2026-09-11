import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { writeDeploymentManifest } from "@instjs/compiler";

describe("production route integrity", () => {
  it("rejects a valid route manifest that does not match the built application", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-route-integrity-"));

    try {
      await writeFile(
        path.join(root, "app.ts"),
        `export default {
  fetch() {
    return new Response("ok");
  },
  routes() {
    return [{ path: "/" }];
  },
};\n`,
        "utf8",
      );

      await runCli(["build", root, "--entry", "app.ts", "--out-dir", "dist"]);
      const manifestPath = path.join(root, "dist/routes-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        routes: Array<{ method?: string; path: string }>;
      };
      manifest.routes = [{ path: "/health" }];
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await writeDeploymentManifest(root, path.join(root, "dist"));

      await expect(
        runCli(["start", root, "--out-dir", "dist", "--port", "0"]),
      ).rejects.toThrow("route manifest does not match the built application routes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
