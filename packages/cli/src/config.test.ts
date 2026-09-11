import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectConfig } from "./config.js";

describe("loadProjectConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-config-"));
    try {
      await expect(loadProjectConfig(root)).resolves.toEqual({});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads TypeScript config files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-config-"));
    try {
      await writeFile(
        path.join(root, "inst.config.ts"),
        `export default {
  build: {
    entry: "src/server.ts",
    outDir: "dist",
    prerender: ["/", "/about"],
    origin: "https://example.test",
  },
  server: {
    hostname: "127.0.0.1",
    port: 4100,
  },
};\n`,
        "utf8",
      );

      await expect(loadProjectConfig(root)).resolves.toMatchObject({
        build: {
          entry: "src/server.ts",
          outDir: "dist",
          prerender: ["/", "/about"],
          origin: "https://example.test",
        },
        server: { hostname: "127.0.0.1", port: 4100 },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unknown configuration keys", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-config-"));
    try {
      await writeFile(
        path.join(root, "inst.config.mjs"),
        "export default { build: { outputDir: 'dist' } };\n",
        "utf8",
      );
      await expect(loadProjectConfig(root)).rejects.toThrow("unknown option outputDir");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous and invalid configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-config-"));
    try {
      await writeFile(path.join(root, "inst.config.ts"), "export default { server: { port: 70000 } };\n", "utf8");
      await expect(loadProjectConfig(root)).rejects.toThrow("server.port");

      await writeFile(path.join(root, "inst.config.mjs"), "export default {};\n", "utf8");
      await expect(loadProjectConfig(root)).rejects.toThrow("Multiple Inst configuration files");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
