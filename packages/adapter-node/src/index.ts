import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

interface NodeRequestInit extends RequestInit {
  duplex?: "half";
}

export interface InstFetchApplication {
  fetch(request: Request): Response | Promise<Response>;
}

export interface NodeProbeOptions {
  readonly healthPath?: string;
  readonly readinessPath?: string;
  readonly health?: () => boolean | Promise<boolean>;
  readonly ready?: () => boolean | Promise<boolean>;
}

export interface NodeHandlerOptions {
  readonly origin?: string;
  readonly probes?: NodeProbeOptions;
}

export interface ServeOptions extends NodeHandlerOptions {
  readonly port?: number;
  readonly hostname?: string;
}

export interface InstNodeServer {
  readonly server: Server;
  readonly url: URL;
  close(): Promise<void>;
}

class BadRequestError extends Error {}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
      continue;
    }

    headers.set(name, value);
  }

  return headers;
}

function configuredOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Inst Node origin must use HTTP or HTTPS: ${value}`);
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    value.endsWith("?") ||
    value.endsWith("#")
  ) {
    throw new Error(`Inst Node origin must be an origin without credentials, path, query, or fragment: ${value}`);
  }
  return url;
}

function requestOrigin(host: string): URL {
  try {
    if (!host || /[\s\\/?#@]/.test(host)) throw new Error("Invalid authority");
    return configuredOrigin(`http://${host}`);
  } catch {
    throw new BadRequestError("Invalid Host header");
  }
}

function normalizeRequestTarget(target: string, base: URL): URL {
  try {
    const incoming = target.startsWith("/") ? new URL(`${base.origin}${target}`) : new URL(target);
    if (incoming.protocol !== "http:" && incoming.protocol !== "https:") throw new Error("Invalid scheme");
    return new URL(`${base.origin}${incoming.pathname}${incoming.search}`);
  } catch {
    throw new BadRequestError("Invalid request target");
  }
}

function requestUrl(request: IncomingMessage, origin?: string): URL {
  const target = request.url ?? "/";

  if (origin) {
    return normalizeRequestTarget(target, configuredOrigin(origin));
  }

  const host = request.headers.host ?? "localhost";
  return normalizeRequestTarget(target, requestOrigin(host));
}

function toWebRequest(
  request: IncomingMessage,
  options: NodeHandlerOptions,
  signal: AbortSignal,
): Request {
  const method = request.method ?? "GET";
  const headers = requestHeaders(request);
  const url = requestUrl(request, options.origin);
  const init: NodeRequestInit = { method, headers, signal };

  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }

  return new Request(url, init);
}

function setResponseHeaders(response: Response, target: ServerResponse): void {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === "set-cookie") continue;
    target.setHeader(name, value);
  }

  const cookies = headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) {
    target.setHeader("set-cookie", cookies);
  } else {
    const cookie = response.headers.get("set-cookie");
    if (cookie) target.setHeader("set-cookie", cookie);
  }
}

async function writeWebResponse(
  response: Response,
  target: ServerResponse,
  sendBody = true,
): Promise<void> {
  target.statusCode = response.status;
  if (response.statusText) target.statusMessage = response.statusText;
  setResponseHeaders(response, target);

  if (!sendBody || !response.body) {
    if (!sendBody) await response.body?.cancel().catch(() => undefined);
    target.end();
    return;
  }

  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), target);
}

function probeJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function validateProbePath(value: string, name: string): void {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("?") || value.includes("#")) {
    throw new Error(`Inst Node ${name} must be an absolute pathname: ${value}`);
  }

  const normalized = new URL(value, "http://inst.local").pathname;
  if (normalized !== value) {
    throw new Error(`Inst Node ${name} must be a normalized pathname: ${value}`);
  }
}

function validateProbes(probes: NodeProbeOptions | undefined): void {
  if (!probes) return;
  const healthPath = probes.healthPath ?? "/.inst/health";
  const readinessPath = probes.readinessPath ?? "/.inst/ready";
  validateProbePath(healthPath, "healthPath");
  validateProbePath(readinessPath, "readinessPath");

  if (healthPath === readinessPath) {
    throw new Error("Inst Node healthPath and readinessPath must be different");
  }
}

async function probeResponse(
  request: Request,
  probes: NodeProbeOptions | undefined,
): Promise<Response | undefined> {
  if (!probes) return undefined;
  const pathname = new URL(request.url).pathname;
  const healthPath = probes.healthPath ?? "/.inst/health";
  const readinessPath = probes.readinessPath ?? "/.inst/ready";
  const isProbe = pathname === healthPath || pathname === readinessPath;

  if (!isProbe) return undefined;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "cache-control": "no-store",
      },
    });
  }

  if (pathname === healthPath) {
    const healthy = (await probes.health?.()) ?? true;
    return probeJson({ status: healthy ? "ok" : "unhealthy" }, healthy ? 200 : 503);
  }

  const ready = (await probes.ready?.()) ?? true;
  return probeJson({ status: ready ? "ready" : "not-ready" }, ready ? 200 : 503);
}

export function createNodeHandler(
  app: InstFetchApplication,
  options: NodeHandlerOptions = {},
): (request: IncomingMessage, response: ServerResponse) => void {
  if (options.origin) configuredOrigin(options.origin);
  validateProbes(options.probes);

  return (request, response) => {
    void (async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const abortOnEarlyClose = () => {
        if (!response.writableEnded) abort();
      };

      request.once("aborted", abort);
      response.once("close", abortOnEarlyClose);

      try {
        const webRequest = toWebRequest(request, options, controller.signal);
        const result =
          (await probeResponse(webRequest, options.probes)) ??
          (await app.fetch(webRequest));
        await writeWebResponse(result, response, webRequest.method !== "HEAD");
      } catch (error) {
        if (response.headersSent) {
          response.destroy();
          return;
        }

        if (error instanceof BadRequestError) {
          response.statusCode = 400;
          response.setHeader("cache-control", "no-store");
          response.setHeader("content-type", "text/plain; charset=utf-8");
          response.end("Bad Request");
          return;
        }

        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end("Internal Server Error");
      } finally {
        request.off("aborted", abort);
        response.off("close", abortOnEarlyClose);
      }
    })();
  };
}

export async function serve(
  app: InstFetchApplication,
  options: ServeOptions = {},
): Promise<InstNodeServer> {
  const hostname = options.hostname ?? "0.0.0.0";
  const port = options.port ?? 3000;
  const server = createServer(createNodeHandler(app, options));

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, hostname);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Inst could not resolve the Node.js server address");
  }

  const displayHost = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
  const authority = displayHost.includes(":") && !displayHost.startsWith("[")
    ? `[${displayHost}]`
    : displayHost;
  const url = new URL(`http://${authority}:${address.port}/`);

  return {
    server,
    url,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
