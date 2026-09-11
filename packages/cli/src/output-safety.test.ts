import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";

describe("build output safety", () => {
  it("rejects the project root before removing optional artifact directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-output-safety-"));

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
      await mkdir(path.join(root, "client"));
      await mkdir(path.join(root, "static"));
      await writeFile(path.join(root, "client/keep.txt"), "client", "utf8");
      await writeFile(path.join(root, "static/keep.txt"), "static", "utf8");

      await expect(
        runCli(["build", root, "--entry", "app.ts", "--out-dir", "."]),
      ).rejects.toThrow("build directory must be a child of the project root");

      expect(await readFile(path.join(root, "client/keep.txt"), "utf8")).toBe("client");
      expect(await readFile(path.join(root, "static/keep.txt"), "utf8")).toBe("static");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
