import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateReleaseTag } from "./release-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];

if (!tag) throw new Error("Release tag is required");

const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = rootManifest.version;
validateReleaseTag(tag, version, []);

const packagesRoot = path.join(root, "packages");
const packageDirectories = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const directory of packageDirectories) {
  const manifest = JSON.parse(
    await readFile(path.join(packagesRoot, directory, "package.json"), "utf8"),
  );
  validateReleaseTag(tag, version, [manifest]);
}

console.log(`Verified release ${tag} across ${packageDirectories.length} packages`);
