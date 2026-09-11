export type InstMode = "development" | "production" | "test";

export interface InstEnv {
  readonly mode: InstMode;
  readonly values: Readonly<Record<string, string | undefined>>;
}

export interface InstRequestContext {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly env: InstEnv;
  readonly signal: AbortSignal;
  readonly state: Map<string, unknown>;
}

export type InstHandler = (
  context: InstRequestContext,
) => Response | Promise<Response>;

export type InstNext = () => Promise<Response>;

export type InstMiddleware = (
  context: InstRequestContext,
  next: InstNext,
) => Response | Promise<Response>;

export type InstErrorHandler = (
  error: unknown,
  context: InstRequestContext,
) => Response | Promise<Response>;

export interface RouteDefinition {
  readonly method?: string;
  readonly path: string;
  readonly handle: InstHandler;
}

export interface InstPlugin {
  readonly name: string;
  setup?(context: PluginSetupContext): void | Promise<void>;
}

export interface PluginSetupContext {
  addRoute(route: RouteDefinition): void;
  addMiddleware(middleware: InstMiddleware): void;
}

export interface InstApplicationConfig {
  readonly plugins?: readonly InstPlugin[];
  readonly middleware?: readonly InstMiddleware[];
  readonly onError?: InstErrorHandler;
}

export interface InstBuildConfig {
  readonly entry?: string;
  readonly clientEntry?: string;
  readonly outDir?: string;
  readonly prerender?: readonly string[];
  readonly origin?: string;
}

export interface InstServerConfig {
  readonly hostname?: string;
  readonly port?: number;
}

export interface InstConfig {
  readonly build?: InstBuildConfig;
  readonly server?: InstServerConfig;
}

export function defineConfig(config: InstConfig): InstConfig {
  return config;
}

export function defineApplicationConfig(config: InstApplicationConfig): InstApplicationConfig {
  return config;
}

export function defineRoute(route: RouteDefinition): RouteDefinition {
  return route;
}

export function defineMiddleware(middleware: InstMiddleware): InstMiddleware {
  return middleware;
}

export function text(
  body: string,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }

  return new Response(body, { ...init, headers });
}

export function json<T>(
  body: T,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(JSON.stringify(body), { ...init, headers });
}

export function redirect(
  location: string,
  status: 301 | 302 | 303 | 307 | 308 = 302,
): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}
