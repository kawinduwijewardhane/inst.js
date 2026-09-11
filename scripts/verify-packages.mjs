import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "./process.mjs";
import { isVersion } from "./release-version.mjs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(root, "packages");
const repositoryUrl = "git+https://github.com/kawinduwijewardhane/inst.js.git";
const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const releaseVersion = rootManifest.version;
const packageDirectories = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (!isVersion(releaseVersion)) {
  throw new Error("Root package version must be a valid semantic version");
}


function hasWorkspaceProtocol(manifest) {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const value of Object.values(manifest[field] ?? {})) {
      if (typeof value === "string" && value.startsWith("workspace:")) return true;
    }
  }
  return false;
}

function collectPackageTargets(value, targets = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("./") && !value.includes("*")) targets.add(value.slice(2));
    return targets;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPackageTargets(item, targets);
    return targets;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectPackageTargets(item, targets);
  }
  return targets;
}

function collectBinTargets(bin) {
  if (typeof bin === "string") return new Set([bin.replace(/^\.\//, "")]);
  if (typeof bin !== "object" || bin === null) return new Set();
  return new Set(
    Object.values(bin)
      .filter((value) => typeof value === "string")
      .map((value) => value.replace(/^\.\//, "")),
  );
}

const packRoot = await mkdtemp(path.join(os.tmpdir(), "inst-release-check-"));

try {
  for (const directory of packageDirectories) {
    const packageRoot = path.join(packagesRoot, directory);
    const packagePath = path.join(packageRoot, "package.json");
    const manifest = JSON.parse(await readFile(packagePath, "utf8"));

    if (typeof manifest.name !== "string" || !manifest.name.startsWith("@instjs/")) {
      throw new Error(`${directory}: invalid package name`);
    }
    if (manifest.version !== releaseVersion) {
      throw new Error(`${manifest.name}: version ${manifest.version ?? "missing"} must match ${releaseVersion}`);
    }
    if (manifest.private === true) {
      throw new Error(`${manifest.name}: publishable framework packages must not be private`);
    }
    if (manifest.license !== "MIT") {
      throw new Error(`${manifest.name}: license must be MIT`);
    }
    if (
      manifest.repository?.type !== "git" ||
      manifest.repository?.url !== repositoryUrl ||
      manifest.repository?.directory !== `packages/${directory}`
    ) {
      throw new Error(`${manifest.name}: repository metadata is incomplete`);
    }
    if (manifest.publishConfig?.access !== "public") {
      throw new Error(`${manifest.name}: publishConfig.access must be public`);
    }
    if (manifest.engines?.node !== ">=22.0.0") {
      throw new Error(`${manifest.name}: Node.js engine must be >=22.0.0`);
    }
    if (!Array.isArray(manifest.files) || !manifest.files.includes("dist")) {
      throw new Error(`${manifest.name}: package files must include dist`);
    }
    if (typeof manifest.exports !== "object" || manifest.exports === null) {
      throw new Error(`${manifest.name}: package exports are required`);
    }

    const distPath = path.join(packageRoot, "dist");
    try {
      if (!(await stat(distPath)).isDirectory()) throw new Error();
    } catch {
      throw new Error(`${manifest.name}: dist is missing; build packages before release verification`);
    }

    const before = new Set(await readdir(packRoot));
    run("pnpm", ["pack", "--pack-destination", packRoot], packageRoot);
    const archive = (await readdir(packRoot)).find((entry) => !before.has(entry) && entry.endsWith(".tgz"));
    if (!archive) throw new Error(`${manifest.name}: pnpm pack did not create an archive`);

    const archivePath = path.join(packRoot, archive);
    const entries = run("tar", ["-tzf", archivePath], root).split(/\r?\n/).filter(Boolean);
    const entrySet = new Set(entries);
    if (!entrySet.has("package/package.json") || !entries.some((entry) => entry.startsWith("package/dist/"))) {
      throw new Error(`${manifest.name}: packed output must contain package.json and dist files`);
    }
    if (entries.some((entry) => entry.startsWith("package/src/"))) {
      throw new Error(`${manifest.name}: source files leaked into the published package`);
    }
    if (entries.some((entry) => /\.test\.[cm]?[jt]s(?:\.map)?$|\.test\.d\.ts(?:\.map)?$/.test(entry))) {
      throw new Error(`${manifest.name}: tests leaked into the release archive`);
    }

    const packedManifest = JSON.parse(run("tar", ["-xOzf", archivePath, "package/package.json"], root));
    if (packedManifest.name !== manifest.name || packedManifest.version !== releaseVersion) {
      throw new Error(`${manifest.name}: packed package identity changed unexpectedly`);
    }
    if (hasWorkspaceProtocol(packedManifest)) {
      throw new Error(`${manifest.name}: workspace protocol leaked into the release archive`);
    }

    for (const target of collectPackageTargets(packedManifest.exports)) {
      if (!entrySet.has(`package/${target}`)) {
        throw new Error(`${manifest.name}: export target is missing from the archive: ${target}`);
      }
    }

    for (const target of collectBinTargets(packedManifest.bin)) {
      const archiveTarget = `package/${target}`;
      if (!entrySet.has(archiveTarget)) {
        throw new Error(`${manifest.name}: executable target is missing from the archive: ${target}`);
      }
      const executable = run("tar", ["-xOzf", archivePath, archiveTarget], root);
      if (!executable.startsWith("#!/usr/bin/env node")) {
        throw new Error(`${manifest.name}: executable target must start with a Node.js shebang: ${target}`);
      }
    }

    console.log(`Verified ${manifest.name}@${releaseVersion} (${entries.length} archive entries)`);
  }
} finally {
  await rm(packRoot, { recursive: true, force: true });
}
