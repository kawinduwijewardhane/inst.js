# Routing

Routes expose request handlers or [capability Unit graphs](units.md) through a path and optional HTTP method. A low-level route handler receives request-scoped context.

```ts
import { createApplication } from "@instjs/runtime";

const app = await createApplication();

app.route({
  method: "GET",
  path: "/posts/:slug",
  handle({ params }) {
    return new Response(`Post: ${params.slug}`);
  },
});

export default app;
```

## Paths

Static segments are preferred over parameterized segments when both match the same request. Parameter values are percent-decoded before they are exposed through `context.params`. Malformed encoded parameters do not reach route handlers.

Parameter names use identifier-style names: they must begin with a letter or underscore and may then contain letters, numbers, or underscores. The names `__proto__`, `prototype`, and `constructor` are reserved and cannot be used as route parameters.

Trailing slashes are normalized, so `/posts` and `/posts/` resolve to the same route. Query strings are not part of route matching and remain available through `context.request.url`.

## Methods

Omitting `method` makes a route method-agnostic. Method-specific routes use case-insensitive HTTP method matching.

A `HEAD` request falls back to a matching `GET` route when no explicit `HEAD` route exists. Inst preserves the response status and headers while omitting the response body, including framework-generated `404` and `405` responses.

When a path exists only for other explicit methods, Inst returns `405 Method Not Allowed` with an `Allow` header. Unknown paths return `404 Not Found`.

## Request context

Handlers receive a `InstRequestContext` containing:

- `request`: the Web Platform `Request`
- `params`: decoded route parameters
- `env`: runtime mode and environment values
- `signal`: the request abort signal
- `state`: a request-local `Map` shared with middleware

Middleware runs in registration order and can modify request-local state, short-circuit the request, or wrap downstream execution.

```ts
app.middleware(async (context, next) => {
  context.state.set("requestId", crypto.randomUUID());
  return next();
});
```

Route handlers and middleware should return standard Web Platform `Response` objects. This keeps application code portable across runtime adapters.
