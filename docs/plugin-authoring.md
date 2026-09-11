# Plugin authoring

Plugins register routes and middleware during application setup without depending on adapter internals. Capability bindings and Unit graphs are configured through the application API described in [Capability Units](units.md).

## Basic plugin

A plugin has a stable name and an optional `setup()` function.

```ts
import type { InstPlugin } from "@instjs/core";

export const healthPlugin: InstPlugin = {
  name: "health",
  setup({ addRoute }) {
    addRoute({
      method: "GET",
      path: "/health",
      handle() {
        return Response.json({ status: "ok" });
      },
    });
  },
};
```

Register plugins through application configuration.

```ts
import { createApplication } from "@instjs/runtime";
import { healthPlugin } from "./health-plugin.js";

const app = await createApplication({
  config: {
    plugins: [healthPlugin],
  },
});
```

Plugin setup runs before `createApplication()` resolves, so routes and middleware are ready before the application begins serving requests.

## Middleware

Plugins can register middleware with `addMiddleware()`.

```ts
import type { InstPlugin } from "@instjs/core";

export const timingPlugin: InstPlugin = {
  name: "timing",
  setup({ addMiddleware }) {
    addMiddleware(async (_context, next) => {
      const started = performance.now();
      const response = await next();
      const headers = new Headers(response.headers);
      headers.set("server-timing", `app;dur=${performance.now() - started}`);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  },
};
```

Middleware executes in registration order. Code before `next()` runs from outermost to innermost; code after `next()` runs in reverse order. A middleware can return a response without calling `next()` to short-circuit the request.

## Request state

Each request receives its own `context.state` map. Middleware and route handlers can use it to share request-scoped values without global mutable state.

```ts
addMiddleware(async (context, next) => {
  context.state.set("requestId", crypto.randomUUID());
  return next();
});
```

Use names that are unlikely to collide with other plugins. A future public extension may introduce typed keys; v1 intentionally keeps the contract small.

## Error handling

Plugins should allow request errors to propagate unless they can handle them completely. The application-level `onError` boundary is responsible for the final error response.

Do not expose secrets, database errors, stack traces, or provider responses in production error bodies. The default Inst production boundary returns a generic `Internal Server Error` response.

## Portability rules

Plugin request-path logic should prefer Web APIs such as `Request`, `Response`, `Headers`, `URL`, `AbortSignal`, `ReadableStream`, and `crypto` where available. Adapter-specific behavior belongs in an adapter package rather than a general runtime plugin.

A plugin that requires Node.js should state that requirement clearly and isolate Node imports from portable runtime code.

## Plugin lifecycle

The v1 plugin lifecycle contains setup only. Avoid relying on process-wide startup or shutdown side effects in a portable plugin. Deployment-specific lifecycle behavior should be owned by the selected adapter until a broader lifecycle contract is defined.
