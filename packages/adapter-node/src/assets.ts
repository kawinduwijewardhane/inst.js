import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { InstFetchApplication } from "./index.js";

export interface NodeAssetDefinition {
  readonly pathname: string;
  readonly filePath: string;
  readonly contentType?: string;
  readonly cacheControl?: string;
}

export interface NodeAssetOptions {
  readonly assets: readonly NodeAssetDefinition[];
}

interface ResolvedAsset {
  readonly filePath: string;
  readonly contentType: string;
  readonly cacheControl: string;
}

function assertAssetPathname(value: string): void {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("?") || value.includes("#")) {
    throw new Error(`Inst asset pathname must be an absolute URL path: ${value}`);
  }

  const normalized = new URL(value, "http://inst.local").pathname;
  if (normalized !== value) {
    throw new Error(`Inst asset pathname must be normalized: ${value}`);
  }
}

function inferContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

function resolveAssets(definitions: readonly NodeAssetDefinition[]): ReadonlyMap<string, ResolvedAsset> {
  const assets = new Map<string, ResolvedAsset>();

  for (const definition of definitions) {
    assertAssetPathname(definition.pathname);
    if (assets.has(definition.pathname)) {
      throw new Error(`Duplicate Inst asset pathname: ${definition.pathname}`);
    }

    const filePath = path.resolve(definition.filePath);
    assets.set(definition.pathname, {
      filePath,
      contentType: definition.contentType ?? inferContentType(filePath),
      cacheControl: definition.cacheControl ?? "no-cache",
    });
  }

  return assets;
}

function isMissingFileError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

function notFoundResponse(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function withNodeAssets(
  app: InstFetchApplication,
  options: NodeAssetOptions,
): InstFetchApplication {
  const assets = resolveAssets(options.assets);

  return {
    async fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return app.fetch(request);
      }

      const asset = assets.get(new URL(request.url).pathname);
      if (!asset) return app.fetch(request);

      try {
        if (request.method === "HEAD") {
          const metadata = await stat(asset.filePath);
          if (!metadata.isFile()) {
            throw new Error(`Inst asset is not a regular file: ${asset.filePath}`);
          }

          return new Response(null, {
            status: 200,
            headers: {
              "cache-control": asset.cacheControl,
              "content-length": String(metadata.size),
              "content-type": asset.contentType,
            },
          });
        }

        const body = await readFile(asset.filePath);
        const headers = new Headers({
          "cache-control": asset.cacheControl,
          "content-length": String(body.byteLength),
          "content-type": asset.contentType,
        });
        const payload = body.buffer.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength,
        ) as ArrayBuffer;

        return new Response(payload, {
          status: 200,
          headers,
        });
      } catch (error) {
        if (isMissingFileError(error)) return notFoundResponse();
        throw error;
      }
    },
  };
}
