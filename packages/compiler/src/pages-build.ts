import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildServer as buildServerBase,
  type ServerBuildManifest,
  type ServerBuildOptions,
  type ServerBuildResult,
} from "./index.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

type DiscoveryMode = "all" | "marked";

interface DiscoveryRoot {
  readonly directory: string;
  readonly mode: DiscoveryMode;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function isDiscoverableFile(name: string, mode: DiscoveryMode): boolean {
  const extension = path.extname(name);
  if (!SOURCE_EXTENSIONS.has(extension) || name.endsWith(".d.ts")) return false;
  const stem = name.slice(0, -extension.length);
  if (stem === "index" || /\.(?:test|spec)$/.test(stem)) return false;
  if (mode === "marked" && !stem.endsWith(".unit")) return false;
  return true;
}

async function discoverFiles(directory: string, mode: DiscoveryMode): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await discoverFiles(absolute, mode));
      continue;
    }
    if (entry.isFile() && isDiscoverableFile(entry.name, mode)) files.push(absolute);
  }
  return files;
}

async function discoverUnitFiles(root: string): Promise<string[]> {
  const roots: readonly DiscoveryRoot[] = [
    { directory: path.join(root, "src", "pages"), mode: "all" },
    { directory: path.join(root, "src", "units"), mode: "all" },
    { directory: path.join(root, "src", "features"), mode: "marked" },
  ];
  const discovered = (await Promise.all(roots.map((entry) => discoverFiles(entry.directory, entry.mode)))).flat();
  return [...new Set(discovered)].sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
}

function importSpecifier(root: string, file: string): string {
  const relative = normalizePath(path.relative(root, file));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function generatedEntry(root: string, appEntry: string, units: readonly string[]): string {
  const imports = [
    `import app from ${JSON.stringify(importSpecifier(root, appEntry))};`,
    ...units.map((unit, index) => `import unit${index} from ${JSON.stringify(importSpecifier(root, unit))};`),
  ];
  const registrations = units.map((unit, index) => {
    const source = normalizePath(path.relative(root, unit));
    return `if (!unit${index} || typeof unit${index} !== "object") throw new Error(${JSON.stringify(`Inst discovered module ${source} must default-export a Unit`)});\napp.unit(unit${index});`;
  });
  return `${imports.join("\n")}\n\n${registrations.join("\n")}\n\nexport default app;\n`;
}

export async function buildServer(options: ServerBuildOptions = {}): Promise<ServerBuildResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const entry = options.entry ?? "src/app.ts";
  const appEntry = path.resolve(root, entry);
  const units = await discoverUnitFiles(root);
  if (units.length === 0) return buildServerBase(options);

  const generatedPath = path.join(root, ".inst-units-entry.ts");
  await writeFile(generatedPath, generatedEntry(root, appEntry, units), "utf8");

  try {
    const result = await buildServerBase({
      ...options,
      entry: path.relative(root, generatedPath),
    });
    const manifest: ServerBuildManifest = {
      ...result.manifest,
      entry: normalizePath(path.relative(root, appEntry)),
    };
    await writeFile(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { ...result, manifest };
  } finally {
    await rm(generatedPath, { force: true });
  }
}
