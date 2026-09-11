import { assertSafeBuildDirectory } from "./paths.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { build, type BuildOptions, type Metafile } from "esbuild";

export type ClientBuildMode = "development" | "production";

export interface ClientBuildOptions {
  readonly root?: string;
  readonly entry: string;
  readonly outDir?: string;
  readonly mode?: ClientBuildMode;
  readonly minify?: boolean;
  readonly sourcemap?: boolean;
}

export interface ClientBuildManifest {
  readonly version: 1;
  readonly kind: "inst-client";
  readonly mode: ClientBuildMode;
  readonly entry: string;
  readonly output: string;
  readonly hash: string;
  readonly inputs: readonly string[];
}

export interface ClientAssetEntry {
  readonly output: string;
  readonly hash: string;
  readonly bytes: number;
}

export interface ClientAssetManifest {
  readonly version: 1;
  readonly kind: "inst-assets";
  readonly entries: readonly ClientAssetEntry[];
}

export interface ClientBuildResult {
  readonly manifest: ClientBuildManifest;
  readonly manifestPath: string;
  readonly assetManifest: ClientAssetManifest;
  readonly assetManifestPath: string;
  readonly outputPath: string;
  readonly metafile: Metafile;
}

export interface VerifyClientBuildOptions {
  readonly root?: string;
  readonly outDir?: string;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function resolveProjectPath(root: string, value: string, label: string): string {
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay within the project root: ${value}`);
  }
  return resolved;
}

function resolveBuildDirectory(root: string, value: string): string {
  const resolved = resolveProjectPath(root, value, "Inst build directory");
  if (resolved === root) {
    throw new Error(`Inst build directory must be a child of the project root: ${value}`);
  }
  return resolved;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isClientBuildMode(value: unknown): value is ClientBuildMode {
  return value === "development" || value === "production";
}

async function assertFile(filePath: string, label: string): Promise<void> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error();
  } catch {
    throw new Error(`${label}: ${filePath}`);
  }
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function isClientBuildManifest(value: unknown): value is ClientBuildManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<ClientBuildManifest>;
  return (
    manifest.version === 1 &&
    manifest.kind === "inst-client" &&
    isClientBuildMode(manifest.mode) &&
    typeof manifest.entry === "string" &&
    typeof manifest.output === "string" &&
    isHash(manifest.hash) &&
    Array.isArray(manifest.inputs) &&
    manifest.inputs.every((input) => typeof input === "string")
  );
}

function isClientAssetManifest(value: unknown): value is ClientAssetManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<ClientAssetManifest>;
  return (
    manifest.version === 1 &&
    manifest.kind === "inst-assets" &&
    Array.isArray(manifest.entries) &&
    manifest.entries.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const candidate = entry as Partial<ClientAssetEntry>;
      return (
        typeof candidate.output === "string" &&
        isHash(candidate.hash) &&
        typeof candidate.bytes === "number" &&
        Number.isSafeInteger(candidate.bytes) &&
        candidate.bytes >= 0
      );
    })
  );
}

function resolveClientOutput(root: string, outDir: string, output: string): string {
  const clientDir = path.join(outDir, "client");
  const outputPath = path.resolve(root, output);
  const relative = path.relative(clientDir, outputPath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Inst client manifest references output outside the client directory: ${output}`);
  }
  return outputPath;
}

async function buildAssetManifest(
  root: string,
  outDir: string,
  metafile: Metafile,
): Promise<ClientAssetManifest> {
  const entries: ClientAssetEntry[] = [];

  for (const output of Object.keys(metafile.outputs).sort()) {
    const outputPath = resolveClientOutput(root, outDir, normalizePath(output));
    await assertFile(outputPath, "Inst client asset not found");
    const info = await stat(outputPath);
    entries.push({
      output: normalizePath(path.relative(root, outputPath)),
      hash: await sha256(outputPath),
      bytes: info.size,
    });
  }

  return { version: 1, kind: "inst-assets", entries };
}

export async function buildClient(options: ClientBuildOptions): Promise<ClientBuildResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const entryPath = resolveProjectPath(root, options.entry, "Inst client entry");
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const clientDir = path.join(outDir, "client");
  const outputPath = path.join(clientDir, "app.js");
  const manifestPath = path.join(outDir, "client-manifest.json");
  const assetManifestPath = path.join(outDir, "assets-manifest.json");
  const mode = options.mode ?? "production";

  await assertFile(entryPath, "Inst client entry file not found");
  await assertSafeBuildDirectory(root, outDir, [entryPath]);
  await rm(clientDir, { recursive: true, force: true });
  await rm(manifestPath, { force: true });
  await rm(assetManifestPath, { force: true });
  await mkdir(clientDir, { recursive: true });

  const buildOptions: BuildOptions = {
    absWorkingDir: root,
    entryPoints: [entryPath],
    outfile: outputPath,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    sourcemap: options.sourcemap === false ? false : "linked",
    minify: options.minify ?? false,
    metafile: true,
    logLevel: "silent",
    legalComments: "none",
    charset: "utf8",
    plugins: [{
      name: "inst-server-boundary",
      setup(context) {
        context.onResolve({ filter: /^@instjs\/(?:runtime|adapter-node|compiler|cli)(?:\/|$)|^@instjs\/core\/units$/ }, (args) => ({
          errors: [{ text: `Server-only Inst module cannot enter the browser graph: ${args.path}` }],
        }));
      },
    }],
    define: {
      "process.env.NODE_ENV": JSON.stringify(mode),
    },
  };

  const result = await build(buildOptions);
  if (!result.metafile) {
    throw new Error("Inst compiler did not receive client build metadata");
  }

  const manifest: ClientBuildManifest = {
    version: 1,
    kind: "inst-client",
    mode,
    entry: normalizePath(path.relative(root, entryPath)),
    output: normalizePath(path.relative(root, outputPath)),
    hash: await sha256(outputPath),
    inputs: Object.keys(result.metafile.inputs).map(normalizePath).sort(),
  };
  const assetManifest = await buildAssetManifest(root, outDir, result.metafile);

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(assetManifestPath, `${JSON.stringify(assetManifest, null, 2)}\n`, "utf8");
  return {
    manifest,
    manifestPath,
    assetManifest,
    assetManifestPath,
    outputPath,
    metafile: result.metafile,
  };
}

export async function readClientBuildManifest(
  options: VerifyClientBuildOptions = {},
): Promise<ClientBuildManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const manifestPath = path.join(outDir, "client-manifest.json");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(`Inst client manifest not found or invalid: ${manifestPath}`);
  }

  if (!isClientBuildManifest(parsed)) {
    throw new Error(`Inst client manifest has an unsupported shape: ${manifestPath}`);
  }
  return parsed;
}

export async function readClientAssetManifest(
  options: VerifyClientBuildOptions = {},
): Promise<ClientAssetManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const manifestPath = path.join(outDir, "assets-manifest.json");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(`Inst asset manifest not found or invalid: ${manifestPath}`);
  }

  if (!isClientAssetManifest(parsed)) {
    throw new Error(`Inst asset manifest has an unsupported shape: ${manifestPath}`);
  }
  return parsed;
}

export async function verifyClientBuild(
  options: VerifyClientBuildOptions = {},
): Promise<{
  manifest: ClientBuildManifest;
  assetManifest: ClientAssetManifest;
  outputPath: string;
  assetPaths: readonly string[];
}> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const manifest = await readClientBuildManifest(options);
  const assetManifest = await readClientAssetManifest(options);
  const outputPath = resolveClientOutput(root, outDir, manifest.output);

  await assertFile(outputPath, "Inst client build output not found");
  if ((await sha256(outputPath)) !== manifest.hash) {
    throw new Error(`Inst client output failed integrity verification: ${outputPath}`);
  }

  const assetPaths: string[] = [];
  for (const entry of assetManifest.entries) {
    const assetPath = resolveClientOutput(root, outDir, entry.output);
    await assertFile(assetPath, "Inst client asset not found");
    const info = await stat(assetPath);
    if (info.size !== entry.bytes || (await sha256(assetPath)) !== entry.hash) {
      throw new Error(`Inst client asset failed integrity verification: ${assetPath}`);
    }
    assetPaths.push(assetPath);
  }

  if (!assetPaths.includes(outputPath)) {
    throw new Error(`Inst asset manifest does not include client entry output: ${outputPath}`);
  }

  return { manifest, assetManifest, outputPath, assetPaths };
}
