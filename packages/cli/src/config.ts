import { stat } from "node:fs/promises";
import path from "node:path";
import type { InstConfig } from "@instjs/core";
import { build } from "esbuild";

const CONFIG_FILES = [
  "inst.config.ts",
  "inst.config.mts",
  "inst.config.js",
  "inst.config.mjs",
] as const;
const TOP_LEVEL_KEYS = new Set(["build", "server"]);
const BUILD_KEYS = new Set(["entry", "clientEntry", "outDir", "prerender", "origin"]);
const SERVER_KEYS = new Set(["hostname", "port"]);

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function assertKnownKeys(value: object, allowed: ReadonlySet<string>, name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${name}: unknown option ${key}`);
  }
}

function assertOptionalString(value: unknown, name: string): void {
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function validateConfig(value: unknown, source: string): InstConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${source} must default-export an Inst configuration object`);
  }

  assertKnownKeys(value, TOP_LEVEL_KEYS, source);
  const config = value as InstConfig;
  if (config.build !== undefined) {
    if (typeof config.build !== "object" || config.build === null || Array.isArray(config.build)) {
      throw new Error(`${source}: build must be an object`);
    }
    assertKnownKeys(config.build, BUILD_KEYS, `${source}: build`);
    assertOptionalString(config.build.entry, `${source}: build.entry`);
    assertOptionalString(config.build.clientEntry, `${source}: build.clientEntry`);
    assertOptionalString(config.build.outDir, `${source}: build.outDir`);
    assertOptionalString(config.build.origin, `${source}: build.origin`);
    if (
      config.build.prerender !== undefined &&
      (!Array.isArray(config.build.prerender) ||
        config.build.prerender.some((entry) => typeof entry !== "string" || entry.length === 0))
    ) {
      throw new Error(`${source}: build.prerender must be an array of non-empty strings`);
    }
  }

  if (config.server !== undefined) {
    if (typeof config.server !== "object" || config.server === null || Array.isArray(config.server)) {
      throw new Error(`${source}: server must be an object`);
    }
    assertKnownKeys(config.server, SERVER_KEYS, `${source}: server`);
    assertOptionalString(config.server.hostname, `${source}: server.hostname`);
    if (
      config.server.port !== undefined &&
      (!Number.isInteger(config.server.port) || config.server.port < 0 || config.server.port > 65_535)
    ) {
      throw new Error(`${source}: server.port must be an integer between 0 and 65535`);
    }
  }

  return config;
}

export async function loadProjectConfig(root: string): Promise<InstConfig> {
  const matches: string[] = [];
  for (const name of CONFIG_FILES) {
    const filePath = path.join(root, name);
    if (await isFile(filePath)) matches.push(filePath);
  }

  if (matches.length === 0) return {};
  if (matches.length > 1) {
    throw new Error(
      `Multiple Inst configuration files found: ${matches.map((file) => path.basename(file)).join(", ")}`,
    );
  }

  const configPath = matches[0];
  if (!configPath) return {};
  const result = await build({
    absWorkingDir: root,
    entryPoints: [configPath],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    write: false,
    logLevel: "silent",
    legalComments: "none",
    charset: "utf8",
  });
  const output = result.outputFiles?.[0];
  if (!output) throw new Error(`Unable to compile ${path.basename(configPath)}`);

  const encoded = Buffer.from(output.text).toString("base64");
  const module = (await import(`data:text/javascript;base64,${encoded}`)) as { default?: unknown };
  return validateConfig(module.default, path.basename(configPath));
}
