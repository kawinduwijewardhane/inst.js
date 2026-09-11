import { assertSafeBuildDirectory } from "./paths.js";
export { assertSafeBuildDirectory } from "./paths.js";
export { verifyDeploymentManifest, writeDeploymentManifest } from "./deployment.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { build, type BuildOptions, type Metafile } from "esbuild";

export type ServerBuildMode = "development" | "production";

export interface ServerBuildOptions {
  readonly root?: string;
  readonly entry?: string;
  readonly outDir?: string;
  readonly mode?: ServerBuildMode;
  readonly minify?: boolean;
  readonly sourcemap?: boolean;
  readonly external?: readonly string[];
}

export interface ServerBuildManifest {
  readonly version: 1;
  readonly kind: "inst-server";
  readonly mode: ServerBuildMode;
  readonly entry: string;
  readonly output: string;
  readonly hash: string;
  readonly inputs: readonly string[];
}

export interface ServerBuildResult {
  readonly manifest: ServerBuildManifest;
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly metafile: Metafile;
}

export interface VerifyServerBuildOptions {
  readonly root?: string;
  readonly outDir?: string;
}

export interface StaticFetchApplication {
  fetch(request: Request): Response | Promise<Response>;
}

export interface StaticGenerationOptions {
  readonly root?: string;
  readonly outDir?: string;
  readonly paths: readonly string[];
  readonly origin?: string;
}

export interface StaticBuildEntry {
  readonly path: string;
  readonly output: string;
  readonly hash: string;
}

export interface StaticBuildManifest {
  readonly version: 1;
  readonly kind: "inst-static";
  readonly entries: readonly StaticBuildEntry[];
}

export interface StaticGenerationResult {
  readonly manifest: StaticBuildManifest;
  readonly manifestPath: string;
  readonly outputPaths: readonly string[];
}

export interface VerifyStaticBuildOptions {
  readonly root?: string;
  readonly outDir?: string;
}

async function assertFile(filePath: string): Promise<void> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error();
  } catch {
    throw new Error(`Inst build output not found: ${filePath}`);
  }
}

async function assertEntryFile(filePath: string): Promise<void> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error();
  } catch {
    throw new Error(`Inst entry file not found: ${filePath}`);
  }
}

function sha256Content(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function sha256(filePath: string): Promise<string> {
  return sha256Content(await readFile(filePath));
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

function resolveHttpOrigin(value: string): URL {
  const origin = new URL(value);
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error(`Inst static origin must use HTTP or HTTPS: ${value}`);
  }
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || /[?#]$/.test(value)) {
    throw new Error("Inst static origin must not contain credentials, path, query, or fragment");
  }
  return new URL(origin.origin);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isServerBuildMode(value: unknown): value is ServerBuildMode {
  return value === "development" || value === "production";
}

function isServerBuildManifest(value: unknown): value is ServerBuildManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<ServerBuildManifest>;

  return (
    manifest.version === 1 &&
    manifest.kind === "inst-server" &&
    isServerBuildMode(manifest.mode) &&
    typeof manifest.entry === "string" &&
    typeof manifest.output === "string" &&
    isHash(manifest.hash) &&
    Array.isArray(manifest.inputs) &&
    manifest.inputs.every((input) => typeof input === "string")
  );
}

function isStaticBuildManifest(value: unknown): value is StaticBuildManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<StaticBuildManifest>;

  return (
    manifest.version === 1 &&
    manifest.kind === "inst-static" &&
    Array.isArray(manifest.entries) &&
    manifest.entries.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const candidate = entry as Partial<StaticBuildEntry>;
      return (
        typeof candidate.path === "string" &&
        typeof candidate.output === "string" &&
        isHash(candidate.hash)
      );
    })
  );
}

function resolveBuildOutput(root: string, outDir: string, output: string): string {
  const outputPath = path.resolve(root, output);
  const relative = path.relative(outDir, outputPath);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Inst build manifest references output outside its build directory: ${output}`);
  }
  return outputPath;
}

function normalizeStaticPath(value: string): string {
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) {
    throw new Error(`Invalid static path: ${value}`);
  }

  const url = new URL(value, "https://inst.invalid");
  const normalized = url.pathname.replace(/\/{2,}/g, "/");
  if (normalized !== value && `${normalized}/` !== value) {
    throw new Error(`Static path must be normalized: ${value}`);
  }

  return normalized === "/" ? "/" : normalized.replace(/\/$/, "");
}

function staticOutputPath(staticDir: string, pathname: string): string {
  if (pathname === "/") return path.join(staticDir, "index.html");
  const relative = pathname.slice(1).split("/").join(path.sep);
  return path.join(staticDir, relative, "index.html");
}

export async function buildServer(
  options: ServerBuildOptions = {},
): Promise<ServerBuildResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const entryPath = resolveProjectPath(root, options.entry ?? "src/app.ts", "Inst entry");
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const serverDir = path.join(outDir, "server");
  const outputPath = path.join(serverDir, "app.mjs");
  const manifestPath = path.join(outDir, "manifest.json");
  const mode = options.mode ?? "production";

  await assertEntryFile(entryPath);
  await assertSafeBuildDirectory(root, outDir, [entryPath]);
  await rm(serverDir, { recursive: true, force: true });
  await rm(manifestPath, { force: true });
  await mkdir(serverDir, { recursive: true });

  const buildOptions: BuildOptions = {
    absWorkingDir: root,
    entryPoints: [entryPath],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    jsx: "automatic",
    jsxImportSource: "@instjs/render",
    sourcemap: options.sourcemap === false ? false : "linked",
    minify: options.minify ?? false,
    metafile: true,
    logLevel: "silent",
    legalComments: "none",
    charset: "utf8",
    external: [...(options.external ?? [])],
    define: {
      "process.env.NODE_ENV": JSON.stringify(mode),
    },
  };

  const result = await build(buildOptions);
  if (!result.metafile) {
    throw new Error("Inst compiler did not receive build metadata");
  }

  const manifest: ServerBuildManifest = {
    version: 1,
    kind: "inst-server",
    mode,
    entry: normalizePath(path.relative(root, entryPath)),
    output: normalizePath(path.relative(root, outputPath)),
    hash: await sha256(outputPath),
    inputs: Object.keys(result.metafile.inputs).map(normalizePath).sort(),
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    manifest,
    manifestPath,
    outputPath,
    metafile: result.metafile,
  };
}

export async function generateStatic(
  app: StaticFetchApplication,
  options: StaticGenerationOptions,
): Promise<StaticGenerationResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const staticDir = path.join(outDir, "static");
  const manifestPath = path.join(outDir, "static-manifest.json");
  const origin = resolveHttpOrigin(options.origin ?? "http://localhost");
  const paths = [...new Set(options.paths.map(normalizeStaticPath))].sort();

  await rm(staticDir, { recursive: true, force: true });
  await rm(manifestPath, { force: true });

  const entries: StaticBuildEntry[] = [];
  const outputPaths: string[] = [];

  for (const pathname of paths) {
    const response = await app.fetch(
      new Request(new URL(pathname, origin), { method: "GET" }),
    );
    if (!response.ok) {
      throw new Error(`Static generation failed for ${pathname}: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("text/html")) {
      throw new Error(`Static generation requires an HTML response for ${pathname}`);
    }

    const content = await response.text();
    const outputPath = staticOutputPath(staticDir, pathname);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf8");

    entries.push({
      path: pathname,
      output: normalizePath(path.relative(root, outputPath)),
      hash: sha256Content(content),
    });
    outputPaths.push(outputPath);
  }

  const manifest: StaticBuildManifest = {
    version: 1,
    kind: "inst-static",
    entries,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { manifest, manifestPath, outputPaths };
}

export async function readServerBuildManifest(
  options: VerifyServerBuildOptions = {},
): Promise<ServerBuildManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const manifestPath = path.join(outDir, "manifest.json");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(`Inst build manifest not found or invalid: ${manifestPath}`);
  }

  if (!isServerBuildManifest(parsed)) {
    throw new Error(`Inst build manifest has an unsupported shape: ${manifestPath}`);
  }

  return parsed;
}

export async function readStaticBuildManifest(
  options: VerifyStaticBuildOptions = {},
): Promise<StaticBuildManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const manifestPath = path.join(outDir, "static-manifest.json");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(`Inst static manifest not found or invalid: ${manifestPath}`);
  }

  if (!isStaticBuildManifest(parsed)) {
    throw new Error(`Inst static manifest has an unsupported shape: ${manifestPath}`);
  }

  return parsed;
}

export async function verifyServerBuild(
  options: VerifyServerBuildOptions = {},
): Promise<{ manifest: ServerBuildManifest; outputPath: string }> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const manifest = await readServerBuildManifest(options);
  const outputPath = resolveBuildOutput(root, outDir, manifest.output);

  await assertFile(outputPath);
  const actualHash = await sha256(outputPath);
  if (actualHash !== manifest.hash) {
    throw new Error(`Inst server output failed integrity verification: ${outputPath}`);
  }

  return { manifest, outputPath };
}

export async function verifyStaticBuild(
  options: VerifyStaticBuildOptions = {},
): Promise<{ manifest: StaticBuildManifest; outputPaths: readonly string[] }> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const manifest = await readStaticBuildManifest(options);
  const outputPaths: string[] = [];

  for (const entry of manifest.entries) {
    normalizeStaticPath(entry.path);
    const outputPath = resolveBuildOutput(root, outDir, entry.output);
    const expectedPath = staticOutputPath(path.join(outDir, "static"), entry.path);
    if (outputPath !== expectedPath) {
      throw new Error(`Inst static manifest output does not match route ${entry.path}: ${entry.output}`);
    }

    await assertFile(outputPath);
    if ((await sha256(outputPath)) !== entry.hash) {
      throw new Error(`Inst static output failed integrity verification: ${outputPath}`);
    }
    outputPaths.push(outputPath);
  }

  return { manifest, outputPaths };
}
