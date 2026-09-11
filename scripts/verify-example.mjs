import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = path.join(root, "examples/basic");
const htmlPath = path.join(exampleRoot, ".inst/static/index.html");
const manifestPath = path.join(exampleRoot, ".inst/static-manifest.json");
const routesManifestPath = path.join(exampleRoot, ".inst/routes-manifest.json");

const [html, manifestText, routesManifestText] = await Promise.all([
  readFile(htmlPath, "utf8"),
  readFile(manifestPath, "utf8"),
  readFile(routesManifestPath, "utf8"),
]);
const manifest = JSON.parse(manifestText);
const routesManifest = JSON.parse(routesManifestText);

if (!html.includes("<h1>Inst.js</h1>") || !html.includes("Inst.js starter")) {
  throw new Error("Basic example did not produce the expected server-rendered document");
}
if (
  manifest.kind !== "inst-static" ||
  !Array.isArray(manifest.entries) ||
  manifest.entries.length !== 1 ||
  manifest.entries[0]?.path !== "/"
) {
  throw new Error("Basic example static manifest is invalid");
}
if (
  routesManifest.kind !== "inst-routes" ||
  !Array.isArray(routesManifest.routes) ||
  JSON.stringify(routesManifest.routes) !== JSON.stringify([{ method: "GET", path: "/" }, { path: "/api/health" }])
) {
  throw new Error("Basic example route manifest is invalid");
}

console.log("Verified basic example build, route manifest, and prerender output");
