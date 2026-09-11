import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeBuildDirectory } from "./paths.js";

export interface UnitGraph {
  readonly method?: string;
  readonly path: string;
  readonly entry: string;
  readonly nodes: readonly {
    readonly name: string;
    readonly requires: readonly string[];
    readonly dependencies: readonly string[];
  }[];
}

interface UnitManifestOptions {
  readonly root?: string;
  readonly outDir?: string;
}

function manifest(graphs: readonly UnitGraph[]) {
  return {
    version: 1,
    kind: "inst-units",
    target: "server",
    graphs: [...graphs].sort((a, b) => {
      const left = `${a.path}\0${a.method ?? "*"}`;
      const right = `${b.path}\0${b.method ?? "*"}`;
      return left < right ? -1 : left > right ? 1 : 0;
    }).map((graph) => ({
      ...(graph.method === undefined ? {} : { method: graph.method }),
      path: graph.path,
      entry: graph.entry,
      nodes: graph.nodes.map((node) => ({
        name: node.name,
        requires: [...node.requires].sort(),
        dependencies: [...node.dependencies],
      })),
    })),
  };
}

async function manifestPath(options: UnitManifestOptions): Promise<string> {
  const root = path.resolve(options.root ?? process.cwd());
  const output = path.resolve(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, output);
  return path.join(output, "units-manifest.json");
}

export async function writeUnitManifest(options: UnitManifestOptions, graphs: readonly UnitGraph[]): Promise<void> {
  const target = await manifestPath(options);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest(graphs), null, 2)}\n`);
}

export async function verifyUnitManifest(options: UnitManifestOptions, graphs: readonly UnitGraph[]): Promise<void> {
  const target = await manifestPath(options);
  const actual: unknown = JSON.parse(await readFile(target, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(manifest(graphs))) {
    throw new Error("Inst Unit manifest does not match the built application graph");
  }
}
