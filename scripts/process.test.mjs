import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { run } from "./process.mjs";

test("package checks support script and standalone pnpm launchers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inst-pnpm-"));
  const original = process.env.npm_execpath;
  try {
    const script = path.join(directory, "pnpm.cjs");
    await writeFile(script, 'console.log(process.argv[2]);');
    process.env.npm_execpath = script;
    assert.equal(run("pnpm", ["script launcher"], directory), "script launcher");
    const binary = path.join(directory, process.platform === "win32" ? "pnpm.exe" : "pnpm");
    await copyFile(process.execPath, binary);
    await chmod(binary, 0o755);
    process.env.npm_execpath = binary;
    assert.equal(run("pnpm", ["-e", 'console.log("standalone launcher")'], directory), "standalone launcher");
  } finally {
    if (original === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = original;
    await rm(directory, { recursive: true, force: true });
  }
});
