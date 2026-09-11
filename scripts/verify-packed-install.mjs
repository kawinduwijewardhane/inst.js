import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "./process.mjs";
import { verifyPackedLifecycle } from "./packed-lifecycle.mjs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(root, "packages");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inst-packed-install-"));
const packRoot = path.join(tempRoot, "packs");
const consumerRoot = path.join(tempRoot, "consumer");


try {
  await Promise.all([
    import("node:fs/promises").then(({ mkdir }) => mkdir(packRoot, { recursive: true })),
    import("node:fs/promises").then(({ mkdir }) => mkdir(consumerRoot, { recursive: true })),
  ]);

  const packageDirectories = (await readdir(packagesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const dependencies = {};
  const overrides = {};
  const exportSpecifiers = [];

  for (const directory of packageDirectories) {
    const packageRoot = path.join(packagesRoot, directory);
    const manifest = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    );

    const before = new Set(await readdir(packRoot));
    run("pnpm", ["pack", "--pack-destination", packRoot], packageRoot);
    const archive = (await readdir(packRoot)).find(
      (entry) => !before.has(entry) && entry.endsWith(".tgz"),
    );

    if (!archive) {
      throw new Error(`${manifest.name}: pnpm pack did not create an archive`);
    }

    const archiveSpec = `file:${path.join(packRoot, archive)}`;
    dependencies[manifest.name] = archiveSpec;
    overrides[manifest.name] = archiveSpec;
    for (const subpath of Object.keys(manifest.exports)) {
      exportSpecifiers.push(subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`);
    }
  }

  await writeFile(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "inst-packed-consumer",
        version: "0.0.0",
        private: true,
        type: "module",
        dependencies,
        pnpm: { overrides },
      },
      null,
      2,
    )}\n`,
  );

  run("pnpm", ["install", "--ignore-workspace", "--frozen-lockfile=false"], consumerRoot);

  const smokeSource = `
for (const specifier of ${JSON.stringify(exportSpecifiers)}) await import(specifier);
import { defineRoute } from "@instjs/core";
import { createApplication } from "@instjs/runtime";
import { html, renderDocument } from "@instjs/render";
import { createNodeHandler } from "@instjs/adapter-node";
import { Router } from "@instjs/router";
import { buildServer } from "@instjs/compiler";

const route = defineRoute({ path: "/", handle: () => new Response("ok") });
const app = await createApplication();
app.route(route);
const response = await app.fetch(new Request("http://localhost/"));
if (await response.text() !== "ok") throw new Error("packed runtime dispatch failed");
if (!renderDocument({ body: html\`<main>packed</main>\` }).includes("packed")) {
  throw new Error("packed renderer failed");
}
if (typeof createNodeHandler !== "function") throw new Error("packed node adapter export failed");
if (typeof Router !== "function") throw new Error("packed router export failed");
if (typeof buildServer !== "function") throw new Error("packed compiler export failed");
`;

  await writeFile(path.join(consumerRoot, "smoke.mjs"), smokeSource);
  run(process.execPath, ["smoke.mjs"], consumerRoot);

  const help = run("pnpm", ["exec", "inst", "--help"], consumerRoot);
  if (!help.includes("inst") || !help.includes("build") || !help.includes("start")) {
    throw new Error("packed CLI help output is incomplete");
  }
  if (process.platform !== "win32") {
    const installedCli = JSON.parse(await readFile(path.join(consumerRoot, "node_modules/@instjs/cli/package.json"), "utf8"));
    const directHelp = run(path.join(consumerRoot, "node_modules/@instjs/cli", installedCli.bin.inst), ["--help"], consumerRoot);
    if (!directHelp.includes("inst build")) throw new Error("Packed CLI is not directly executable");
  }

  await verifyPackedLifecycle(consumerRoot, dependencies, overrides);
  console.log("Verified installation and runtime use of packed Inst.js packages");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
