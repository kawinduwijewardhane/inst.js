import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectEnv, parseEnv } from "./env.js";

describe("project environment", () => {
  it("parses comments, exports, and quoted values", () => {
    expect(
      parseEnv(`\n# comment\nPORT=3000\nexport NAME="Inst app"\nMULTILINE="first\\nsecond"\n`),
    ).toEqual({
      PORT: "3000",
      NAME: "Inst app",
      MULTILINE: "first\nsecond",
    });
    expect(() => parseEnv("BAD-NAME=value")).toThrow("Invalid environment variable name");
  });

  it("loads mode files with local precedence without replacing process values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-env-"));

    try {
      await writeFile(path.join(root, ".env"), "SHARED=base\nBASE_ONLY=yes\n", "utf8");
      await writeFile(path.join(root, ".env.local"), "SHARED=local\n", "utf8");
      await writeFile(path.join(root, ".env.production"), "SHARED=production\nMODE_ONLY=yes\n", "utf8");
      await writeFile(path.join(root, ".env.production.local"), "SHARED=production-local\n", "utf8");

      const target: NodeJS.ProcessEnv = { EXISTING: "host", SHARED: "host-shared" };
      const loaded = await loadProjectEnv(root, "production", target);

      expect(target).toEqual({
        EXISTING: "host",
        SHARED: "host-shared",
        BASE_ONLY: "yes",
        MODE_ONLY: "yes",
      });
      expect(loaded).toEqual({ BASE_ONLY: "yes", MODE_ONLY: "yes" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows later project files to override earlier project files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-env-precedence-"));

    try {
      await writeFile(path.join(root, ".env"), "VALUE=base\n", "utf8");
      await writeFile(path.join(root, ".env.development"), "VALUE=development\n", "utf8");
      const target: NodeJS.ProcessEnv = {};

      await loadProjectEnv(root, "development", target);
      expect(target.VALUE).toBe("development");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
