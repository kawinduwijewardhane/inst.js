import type {
  RouteDefinition,
  InstApplicationConfig,
  InstEnv,
  InstMiddleware,
  InstMode,
  InstPlugin,
  InstRequestContext,
} from "@instjs/core";
import { Router } from "@instjs/router";
import type { CapabilityBinding, InstUnit } from "@instjs/core/units";
import { compileUnit, type UnitGraphNode } from "./units.js";

export interface InstUnitRoute extends InstRouteInfo {
  readonly unit: InstUnit<Response>;
}

export interface InstUnitGraph extends InstRouteInfo {
  readonly entry: string;
  readonly nodes: readonly UnitGraphNode[];
}

export interface InstRouteInfo {
  readonly method?: string;
  readonly path: string;
}

export interface InstApplication {
  fetch(request: Request): Promise<Response>;
  route(route: RouteDefinition): InstApplication;
  unit(unit: InstUnit<Response> | InstUnitRoute): InstApplication;
  units(): readonly InstUnitGraph[];
  middleware(middleware: InstMiddleware): InstApplication;
  use(plugin: InstPlugin): Promise<InstApplication>;
  routes(): readonly InstRouteInfo[];
}

export interface CreateApplicationOptions {
  readonly mode?: InstMode;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly config?: InstApplicationConfig;
  readonly capabilities?: readonly CapabilityBinding[];
  readonly units?: readonly InstUnit<Response>[];
}

function runMiddleware(
  stack: readonly InstMiddleware[],
  context: InstRequestContext,
  handler: () => Promise<Response>,
): Promise<Response> {
  let cursor = -1;

  const dispatch = async (index: number): Promise<Response> => {
    if (index <= cursor) {
      throw new Error("next() may only be called once per middleware");
    }

    cursor = index;
    const middleware = stack[index];
    if (!middleware) return handler();

    return middleware(context, () => dispatch(index + 1));
  };

  return dispatch(0);
}

function defaultErrorResponse(mode: InstMode, error: unknown): Response {
  const message =
    mode === "production"
      ? "Internal Server Error"
      : error instanceof Error
        ? error.message
        : "Internal Server Error";

  return new Response(message, {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function finalizeResponse(method: string, response: Response): Promise<Response> {
  if (method.toUpperCase() !== "HEAD") return response;

  await response.body?.cancel().catch(() => undefined);
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function handleRequestError(
  config: InstApplicationConfig | undefined,
  mode: InstMode,
  error: unknown,
  context: InstRequestContext,
): Promise<Response> {
  if (!config?.onError) return defaultErrorResponse(mode, error);

  try {
    return await config.onError(error, context);
  } catch (handlerError) {
    return defaultErrorResponse(mode, handlerError);
  }
}

function routeFromUnit(unit: InstUnit<Response>): InstUnitRoute {
  const trigger = unit.trigger;
  if (!trigger) {
    throw new Error(`Unit ${unit.name} has no trigger. Pass an explicit route or add an HTTP trigger.`);
  }

  if (trigger.kind !== "http") {
    throw new Error(`Unsupported trigger kind for unit ${unit.name}: ${String((trigger as { kind?: unknown }).kind)}`);
  }

  return {
    ...(trigger.method === undefined ? {} : { method: trigger.method }),
    path: trigger.path,
    unit,
  };
}

function normalizeUnitRoute(entry: InstUnit<Response> | InstUnitRoute): InstUnitRoute {
  return "unit" in entry ? entry : routeFromUnit(entry);
}

export async function createApplication(
  options: CreateApplicationOptions = {},
): Promise<InstApplication> {
  const router = new Router<RouteDefinition>();
  const unitGraphs: InstUnitGraph[] = [];
  const middleware: InstMiddleware[] = [...(options.config?.middleware ?? [])];
  const mode = options.mode ?? "development";
  const env: InstEnv = {
    mode,
    values: options.env ?? {},
  };

  const application: InstApplication = {
    unit(entry) {
      const route = normalizeUnitRoute(entry);
      const compiled = compileUnit(route.unit, options.capabilities ?? []);
      application.route({
        ...(route.method === undefined ? {} : { method: route.method }),
        path: route.path,
        handle: compiled.execute,
      });
      const registered = router.routes().find((record) => record.value.handle === compiled.execute)!;
      unitGraphs.push({
        ...(registered.method === undefined ? {} : { method: registered.method }),
        path: registered.path,
        entry: route.unit.name,
        nodes: compiled.nodes,
      });
      return application;
    },

    units() {
      return structuredClone(unitGraphs);
    },

    route(route) {
      router.add({
        ...(route.method === undefined ? {} : { method: route.method }),
        path: route.path,
        value: route,
      });
      return application;
    },

    middleware(entry) {
      middleware.push(entry);
      return application;
    },

    async use(plugin) {
      await plugin.setup?.({
        addRoute(route) {
          application.route(route);
        },
        addMiddleware(entry) {
          application.middleware(entry);
        },
      });
      return application;
    },

    routes() {
      return router.routes().map((route) => ({
        ...(route.method === undefined ? {} : { method: route.method }),
        path: route.path,
      }));
    },

    async fetch(request) {
      const url = new URL(request.url);
      const requestMethod = request.method.toUpperCase();
      const match = router.match(url.pathname, requestMethod);

      if (!match) {
        const methods = router.methods(url.pathname);
        if (methods.length > 0) {
          return finalizeResponse(
            requestMethod,
            new Response("Method Not Allowed", {
              status: 405,
              headers: {
                allow: methods.join(", "),
                "content-type": "text/plain; charset=utf-8",
              },
            }),
          );
        }

        return finalizeResponse(
          requestMethod,
          new Response("Not Found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
        );
      }

      const context: InstRequestContext = {
        request,
        params: match.params,
        env,
        signal: request.signal,
        state: new Map(),
      };

      try {
        const response = await runMiddleware(middleware, context, async () =>
          match.route.value.handle(context),
        );
        return finalizeResponse(requestMethod, response);
      } catch (error) {
        return finalizeResponse(
          requestMethod,
          await handleRequestError(options.config, mode, error, context),
        );
      }
    },
  };

  for (const plugin of options.config?.plugins ?? []) {
    await application.use(plugin);
  }

  for (const unit of options.units ?? []) {
    application.unit(unit);
  }

  return application;
}
