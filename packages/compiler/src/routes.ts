import { assertSafeBuildDirectory } from "./paths.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RouteManifestEntry {
  readonly method?: string;
  readonly path: string;
}

export interface RouteBuildManifest {
  readonly version: 1;
  readonly kind: "inst-routes";
  readonly routes: readonly RouteManifestEntry[];
}

export interface RouteManifestOptions {
  readonly root?: string;
  readonly outDir?: string;
}

export interface WriteRouteManifestOptions extends RouteManifestOptions {
  readonly routes: readonly RouteManifestEntry[];
}

const httpToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

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

function isRouteManifestEntry(value: unknown): value is RouteManifestEntry {
  if (typeof value !== "object" || value === null) return false;
  const route = value as Partial<RouteManifestEntry>;
  return (
    typeof route.path === "string" &&
    route.path.startsWith("/") &&
    !route.path.includes("?") &&
    !route.path.includes("#") &&
    !route.path.includes("//") &&
    (route.path === "/" || !route.path.endsWith("/")) &&
    (route.method === undefined ||
      (typeof route.method === "string" &&
        httpToken.test(route.method) &&
        route.method === route.method.toUpperCase()))
  );
}

function isRouteBuildManifest(value: unknown): value is RouteBuildManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<RouteBuildManifest>;
  return (
    manifest.version === 1 &&
    manifest.kind === "inst-routes" &&
    Array.isArray(manifest.routes) &&
    manifest.routes.every(isRouteManifestEntry)
  );
}

function routeKey(route: RouteManifestEntry): string {
  return `${route.method ?? "*"}\u0000${route.path}`;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeRoutes(routes: readonly RouteManifestEntry[]): readonly RouteManifestEntry[] {
  const normalized = routes.map((route) => ({
    ...(route.method === undefined ? {} : { method: route.method.toUpperCase() }),
    path: route.path,
  }));

  for (const route of normalized) {
    if (!isRouteManifestEntry(route)) {
      throw new Error(`Invalid Inst route manifest entry: ${JSON.stringify(route)}`);
    }
  }

  const seen = new Set<string>();
  for (const route of normalized) {
    const key = routeKey(route);
    if (seen.has(key)) {
      throw new Error(`Duplicate Inst route manifest entry: ${route.method ?? "*"} ${route.path}`);
    }
    seen.add(key);
  }

  return normalized.sort((a, b) => {
    const pathOrder = compareText(a.path, b.path);
    if (pathOrder !== 0) return pathOrder;
    return compareText(a.method ?? "*", b.method ?? "*");
  });
}

export async function writeRouteManifest(
  options: WriteRouteManifestOptions,
): Promise<{ manifest: RouteBuildManifest; manifestPath: string }> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const manifestPath = path.join(outDir, "routes-manifest.json");
  const manifest: RouteBuildManifest = {
    version: 1,
    kind: "inst-routes",
    routes: normalizeRoutes(options.routes),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, manifestPath };
}

export async function readRouteManifest(
  options: RouteManifestOptions = {},
): Promise<RouteBuildManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = resolveBuildDirectory(root, options.outDir ?? ".inst");
  await assertSafeBuildDirectory(root, outDir);
  const manifestPath = path.join(outDir, "routes-manifest.json");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(`Inst route manifest not found or invalid: ${manifestPath}`);
  }

  if (!isRouteBuildManifest(parsed)) {
    throw new Error(`Inst route manifest has an unsupported shape: ${manifestPath}`);
  }

  const normalized = normalizeRoutes(parsed.routes);
  if (JSON.stringify(normalized) !== JSON.stringify(parsed.routes)) {
    throw new Error(`Inst route manifest is not normalized: ${manifestPath}`);
  }

  return parsed;
}

export async function verifyRouteManifest(
  options: RouteManifestOptions,
  routes: readonly RouteManifestEntry[],
): Promise<RouteBuildManifest> {
  const manifest = await readRouteManifest(options);
  const currentRoutes = normalizeRoutes(routes);
  if (JSON.stringify(currentRoutes) !== JSON.stringify(manifest.routes)) {
    throw new Error("Inst route manifest does not match the built application routes");
  }
  return manifest;
}
