#!/usr/bin/env node

import { watch, type FSWatcher } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve, type InstNodeServer } from "@instjs/adapter-node";
import { withNodeAssets } from "@instjs/adapter-node/assets";
import { assertSafeBuildDirectory, buildServer, generateStatic, verifyDeploymentManifest, verifyServerBuild, verifyStaticBuild, writeDeploymentManifest } from "@instjs/compiler";
import { buildClient, verifyClientBuild } from "@instjs/compiler/client";
import { verifyRouteManifest, writeRouteManifest } from "@instjs/compiler/routes";
import { verifyUnitManifest, writeUnitManifest } from "@instjs/compiler/units";
import type { InstConfig } from "@instjs/core";
import type { InstApplication } from "@instjs/runtime";
import { loadProjectConfig } from "./config.js";
import { createDevStatusResponse, DEV_STATUS_PATH, formatDevError, injectDevOverlay, type DevErrorInfo } from "./dev-overlay.js";
import { loadProjectEnv } from "./env.js";
import { scaffoldProject } from "./scaffold.js";

export type InstCommand = "build" | "create" | "dev" | "start" | "help";

export interface CliOptions {
  readonly command: InstCommand;
  readonly root: string;
  readonly entry?: string;
  readonly clientEntry?: string;
  readonly origin?: string;
  readonly outDir: string;
  readonly hostname: string;
  readonly port: number;
  readonly prerenderPaths: readonly string[];
}

const helpText = `Inst.js

Usage:
  inst create <directory>
  inst dev [root] [options]
  inst build [root] [options]
  inst start [root] [options]

Options:
  --entry <path>        Application entry. Default: src/app.ts
  --client-entry <path> Explicit browser entry for build and dev
  --out-dir <path>      Build directory. Default: .inst
  --prerender <path>    Generate static HTML for a path. Repeatable
  --origin <url>        Origin used for static generation requests
  --host <hostname>     Server host. Default: 0.0.0.0
  --port <number>       Server port. Default: 3000
  -h, --help            Show this help
`;

function readOption(
  args: readonly string[],
  index: number,
  name: string,
): { value: string; nextIndex: number } {
  const current = args[index];
  const prefix = `${name}=`;

  if (current?.startsWith(prefix)) {
    const value = current.slice(prefix.length);
    if (!value) throw new Error(`Missing value for ${name}`);
    return { value, nextIndex: index };
  }

  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}`);
  }

  return { value, nextIndex: index + 1 };
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function hasOption(args: readonly string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function applyProjectConfig(
  options: CliOptions,
  args: readonly string[],
  config: InstConfig,
): CliOptions {
  const build = config.build;
  const server = config.server;
  const entry = hasOption(args, "--entry") ? options.entry : (build?.entry ?? options.entry);
  const clientEntry =
    options.command === "build" || options.command === "dev"
      ? hasOption(args, "--client-entry")
        ? options.clientEntry
        : (build?.clientEntry ?? options.clientEntry)
      : options.clientEntry;
  const origin =
    options.command === "build"
      ? hasOption(args, "--origin")
        ? options.origin
        : (build?.origin ?? options.origin)
      : options.origin;
  const prerenderPaths =
    options.command === "build" && !hasOption(args, "--prerender") && build?.prerender
      ? [...build.prerender]
      : options.prerenderPaths;

  return {
    ...options,
    outDir: hasOption(args, "--out-dir") ? options.outDir : (build?.outDir ?? options.outDir),
    hostname: hasOption(args, "--host") ? options.hostname : (server?.hostname ?? options.hostname),
    port: hasOption(args, "--port") ? options.port : (server?.port ?? options.port),
    prerenderPaths,
    ...(entry ? { entry } : {}),
    ...(clientEntry ? { clientEntry } : {}),
    ...(origin ? { origin } : {}),
  };
}

export function parseCliArgs(
  args: readonly string[],
  cwd = process.cwd(),
): CliOptions {
  const first = args[0];
  if (!first || first === "-h" || first === "--help" || first === "help") {
    return {
      command: "help",
      root: path.resolve(cwd),
      outDir: ".inst",
      hostname: "0.0.0.0",
      port: 3000,
      prerenderPaths: [],
    };
  }

  if (first !== "build" && first !== "create" && first !== "dev" && first !== "start") {
    throw new Error(`Unknown Inst command: ${first}`);
  }

  if (first === "create") {
    const target = args[1];
    if (!target || target.startsWith("-")) {
      throw new Error("inst create requires a target directory");
    }
    if (args.length > 2) {
      throw new Error(`Unexpected argument: ${args[2]}`);
    }

    return {
      command: "create",
      root: path.resolve(cwd, target),
      outDir: ".inst",
      hostname: "0.0.0.0",
      port: 3000,
      prerenderPaths: [],
    };
  }

  let root = cwd;
  let entry: string | undefined;
  let clientEntry: string | undefined;
  let origin: string | undefined;
  let outDir = ".inst";
  let hostname = "0.0.0.0";
  let port = 3000;
  const prerenderPaths: string[] = [];

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (!arg.startsWith("-")) {
      if (root !== cwd) throw new Error(`Unexpected argument: ${arg}`);
      root = path.resolve(cwd, arg);
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      return {
        command: "help",
        root: path.resolve(root),
        outDir,
        hostname,
        port,
        prerenderPaths,
        ...(entry ? { entry } : {}),
        ...(clientEntry ? { clientEntry } : {}),
        ...(origin ? { origin } : {}),
      };
    }

    if (arg === "--entry" || arg.startsWith("--entry=")) {
      const option = readOption(args, index, "--entry");
      entry = option.value;
      index = option.nextIndex;
      continue;
    }

    if (arg === "--client-entry" || arg.startsWith("--client-entry=")) {
      const option = readOption(args, index, "--client-entry");
      clientEntry = option.value;
      index = option.nextIndex;
      continue;
    }

    if (arg === "--out-dir" || arg.startsWith("--out-dir=")) {
      const option = readOption(args, index, "--out-dir");
      outDir = option.value;
      index = option.nextIndex;
      continue;
    }

    if (arg === "--prerender" || arg.startsWith("--prerender=")) {
      const option = readOption(args, index, "--prerender");
      prerenderPaths.push(option.value);
      index = option.nextIndex;
      continue;
    }

    if (arg === "--origin" || arg.startsWith("--origin=")) {
      const option = readOption(args, index, "--origin");
      origin = option.value;
      index = option.nextIndex;
      continue;
    }

    if (arg === "--host" || arg.startsWith("--host=")) {
      const option = readOption(args, index, "--host");
      hostname = option.value;
      index = option.nextIndex;
      continue;
    }

    if (arg === "--port" || arg.startsWith("--port=")) {
      const option = readOption(args, index, "--port");
      port = parsePort(option.value);
      index = option.nextIndex;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (clientEntry && first !== "build" && first !== "dev") {
    throw new Error("--client-entry is only supported by inst build and inst dev");
  }
  if (origin && first !== "build") {
    throw new Error("--origin is only supported by inst build");
  }

  return {
    command: first,
    root: path.resolve(root),
    outDir,
    hostname,
    port,
    prerenderPaths,
    ...(entry ? { entry } : {}),
    ...(clientEntry ? { clientEntry } : {}),
    ...(origin ? { origin } : {}),
  };
}

function isInstApplication(value: unknown): value is InstApplication {
  return (
    typeof value === "object" &&
    value !== null &&
    "fetch" in value &&
    typeof (value as { fetch?: unknown }).fetch === "function" &&
    "routes" in value &&
    typeof (value as { routes?: unknown }).routes === "function"
  );
}

async function loadApplication(
  outputPath: string,
  cacheKey?: string,
): Promise<InstApplication> {
  const url = pathToFileURL(outputPath);
  if (cacheKey) url.searchParams.set("v", cacheKey);

  const module = (await import(url.href)) as { default?: unknown };
  const resolved = await module.default;
  if (!isInstApplication(resolved)) {
    throw new Error(
      "Inst application entry must default-export an application created by createApplication()",
    );
  }

  return resolved;
}

function resolveBuildDirectory(options: CliOptions): string {
  const output = path.resolve(options.root, options.outDir);
  const relative = path.relative(options.root, output);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Inst build directory must be a child of the project root: ${options.outDir}`);
  }
  return output;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function clientAssetDefinitions(
  root: string,
  outputPath: string,
  entries: readonly { readonly output: string }[],
) {
  const clientDirectory = path.dirname(outputPath);

  return entries.map((entry) => {
    const filePath = path.resolve(root, entry.output);
    const relative = path.relative(clientDirectory, filePath);
    return {
      pathname: `/.inst/client/${relative.split(path.sep).join("/")}`,
      filePath,
    };
  });
}

async function clearOptionalBuildArtifacts(options: CliOptions): Promise<void> {
  const output = resolveBuildDirectory(options);
  await assertSafeBuildDirectory(options.root, output, [options.entry ?? "src/app.ts", ...(options.clientEntry ? [options.clientEntry] : [])]);
  await rm(path.join(output, "deployment-manifest.json"), { force: true });
  await Promise.all([
    rm(path.join(output, "client"), { recursive: true, force: true }),
    rm(path.join(output, "client-manifest.json"), { force: true }),
    rm(path.join(output, "assets-manifest.json"), { force: true }),
    rm(path.join(output, "static"), { recursive: true, force: true }),
    rm(path.join(output, "static-manifest.json"), { force: true }),
  ]);
}

async function runBuild(options: CliOptions): Promise<void> {
  await loadProjectEnv(options.root, "production");
  await clearOptionalBuildArtifacts(options);
  const result = await buildServer({
    root: options.root,
    outDir: options.outDir,
    minify: true,
    ...(options.entry ? { entry: options.entry } : {}),
  });

  console.log(`Built ${result.manifest.output}`);

  if (options.clientEntry) {
    const client = await buildClient({
      root: options.root,
      entry: options.clientEntry,
      outDir: options.outDir,
      minify: true,
    });
    console.log(`Built ${client.manifest.output}`);
  }

  const app = await loadApplication(result.outputPath, result.manifest.hash);
  await writeUnitManifest({ root: options.root, outDir: options.outDir }, app.units?.() ?? []);
  const routes = await writeRouteManifest({
    root: options.root,
    outDir: options.outDir,
    routes: app.routes(),
  });
  console.log(`Recorded ${routes.manifest.routes.length} route(s)`);

  if (options.prerenderPaths.length > 0) {
    const generated = await generateStatic(app, {
      root: options.root,
      outDir: options.outDir,
      paths: options.prerenderPaths,
      ...(options.origin ? { origin: options.origin } : {}),
    });
    console.log(`Generated ${generated.manifest.entries.length} static page(s)`);
  }
  await writeDeploymentManifest(options.root, resolveBuildDirectory(options));
}

async function waitForShutdown(
  server: InstNodeServer,
  watcher?: FSWatcher,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let closing = false;

    const close = () => {
      if (closing) return;
      closing = true;
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
      watcher?.close();
      void server.close().finally(resolve);
    };

    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

async function runStart(options: CliOptions): Promise<void> {
  await loadProjectEnv(options.root, "production");
  const verified = await verifyServerBuild({
    root: options.root,
    outDir: options.outDir,
  });
  if (verified.manifest.mode !== "production") throw new Error("Inst start requires a production build");

  const output = resolveBuildDirectory(options);
  await verifyDeploymentManifest(options.root, output);
  const client = (await fileExists(path.join(output, "client-manifest.json")))
    ? await verifyClientBuild({ root: options.root, outDir: options.outDir })
    : undefined;
  if (client && client.manifest.mode !== "production") throw new Error("Inst start requires a production browser build");
  if (await fileExists(path.join(output, "static-manifest.json"))) {
    await verifyStaticBuild({ root: options.root, outDir: options.outDir });
  }

  const app = await loadApplication(verified.outputPath);
  await verifyUnitManifest({ root: options.root, outDir: options.outDir }, app.units?.() ?? []);
  await verifyRouteManifest(
    { root: options.root, outDir: options.outDir },
    app.routes(),
  );
  const deployedApp = client
    ? withNodeAssets(app, {
        assets: clientAssetDefinitions(
          options.root,
          client.outputPath,
          client.assetManifest.entries,
        ),
      })
    : app;
  const server = await serve(deployedApp, {
    hostname: options.hostname,
    port: options.port,
  });

  console.log(`Inst listening on ${server.url.href}`);
  await waitForShutdown(server);
}

async function runDev(options: CliOptions): Promise<void> {
  await loadProjectEnv(options.root, "development");
  const devOutDir = path.join(options.outDir, "dev");
  let app: InstApplication | undefined;
  let client: Awaited<ReturnType<typeof buildClient>> | undefined;
  let devError: DevErrorInfo | undefined;
  let devRevision = 0;
  let initialOutput: string | undefined;

  try {
    const initialBuild = await buildServer({
      root: options.root,
      outDir: devOutDir,
      mode: "development",
      minify: false,
      ...(options.entry ? { entry: options.entry } : {}),
    });
    client = options.clientEntry
      ? await buildClient({
          root: options.root,
          entry: options.clientEntry,
          outDir: devOutDir,
          mode: "development",
          minify: false,
        })
      : undefined;
    app = await loadApplication(initialBuild.outputPath, String(Date.now()));
    initialOutput = initialBuild.manifest.output;
  } catch (error) {
    devError = formatDevError(error);
    console.error(`Inst initial build failed: ${devError.message}`);
  }

  const liveApplication = {
    fetch(request: Request) {
      if (app) return app.fetch(request);
      return new Response(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Inst development error</title></head><body></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" }, status: 500 },
      );
    },
  };
  let servedApplication = client
    ? withNodeAssets(liveApplication, {
        assets: clientAssetDefinitions(
          options.root,
          client.outputPath,
          client.assetManifest.entries,
        ),
      })
    : liveApplication;
  const server = await serve({
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === DEV_STATUS_PATH) return createDevStatusResponse(devError, devRevision);
      return injectDevOverlay(await servedApplication.fetch(request));
    },
  }, {
    hostname: options.hostname,
    port: options.port,
  });

  console.log(`Inst dev server on ${server.url.href}`);
  if (initialOutput) console.log(`Built ${initialOutput}`);

  const sourceDir = path.join(options.root, "src");
  let timer: NodeJS.Timeout | undefined;
  let rebuilding = false;
  let rebuildQueued = false;

  const rebuild = async (): Promise<void> => {
    if (rebuilding) {
      rebuildQueued = true;
      return;
    }

    rebuilding = true;
    try {
      do {
        rebuildQueued = false;
        try {
          const nextBuild = await buildServer({
            root: options.root,
            outDir: devOutDir,
            mode: "development",
            minify: false,
            ...(options.entry ? { entry: options.entry } : {}),
          });
          const nextClient = options.clientEntry
            ? await buildClient({
                root: options.root,
                entry: options.clientEntry,
                outDir: devOutDir,
                mode: "development",
                minify: false,
              })
            : undefined;
          const nextApp = await loadApplication(
            nextBuild.outputPath,
            `${Date.now()}-${nextBuild.manifest.hash}`,
          );

          app = nextApp;
          client = nextClient;
          servedApplication = client
            ? withNodeAssets(liveApplication, { assets: clientAssetDefinitions(options.root, client.outputPath, client.assetManifest.entries) })
            : liveApplication;
          devError = undefined;
          devRevision += 1;
          console.log(`Rebuilt ${nextBuild.manifest.output}`);
        } catch (error) {
          devError = formatDevError(error);
          console.error(`Inst rebuild failed: ${devError.message}`);
        }
      } while (rebuildQueued);
    } finally {
      rebuilding = false;
    }
  };

  const watcher = watch(sourceDir, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void rebuild();
    }, 75);
  });

  await waitForShutdown(server, watcher);
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  let options = parseCliArgs(args);

  if (options.command === "help") {
    process.stdout.write(helpText);
    return;
  }

  if (options.command === "create") {
    const result = await scaffoldProject(options.root);
    console.log(`Created Inst.js project in ${result.root}`);
    return;
  }

  await loadProjectEnv(options.root, options.command === "dev" ? "development" : "production");
  options = applyProjectConfig(options, args, await loadProjectConfig(options.root));

  if (options.command === "build") {
    await runBuild(options);
    return;
  }

  if (options.command === "start") {
    await runStart(options);
    return;
  }

  await runDev(options);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Inst: ${message}`);
    process.exitCode = 1;
  });
}
