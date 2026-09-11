# Capability Units

A Unit is a named server operation with declared capabilities, dependencies, and optionally a trigger. HTTP is one trigger type, not the organizing principle of the application. This keeps business and rendering work attached to the capability graph instead of coupling architecture to a filesystem route tree.

For normal HTTP features, put the trigger on the Unit and register the Unit directly:

```tsx
import { defineCapability, defineUnit, http, provide } from "@instjs/core/units";
import { createApplication } from "@instjs/runtime";
import { documentResponse } from "@instjs/render";

const title = defineCapability<string>("site.title");

const heading = defineUnit({
  name: "heading",
  requires: [title],
  execute: ({ get }) => get(title),
});

const home = defineUnit({
  name: "home",
  trigger: http.get("/"),
  dependencies: [heading],
  async execute({ use }) {
    const text = await use(heading);
    return documentResponse({
      meta: { title: text },
      body: <main><h1>{text}</h1></main>,
    });
  },
});

export default await createApplication({
  capabilities: [provide(title, "Hello")],
  units: [home],
});
```

The built-in HTTP trigger helpers are `http.get()`, `http.post()`, `http.put()`, `http.patch()`, `http.delete()`, and `http.any()`. Route parameters stay explicit in the trigger and are available through `request.params` inside `execute()`.

```ts
const profile = defineUnit({
  name: "profile",
  trigger: http.get("/users/:id"),
  execute({ request }) {
    return Response.json({ id: request.params.id });
  },
});
```

`app.unit(unit)` is available when registering Units after application creation. The older explicit form, `app.unit({ method, path, unit })`, remains supported for compatibility and for code that intentionally keeps routing separate from the Unit. Low-level `app.route()` and middleware are still escape hatches, but they are not the preferred shape for normal feature code.

A triggered Unit passed directly to `app.unit()` must have a supported trigger. A Unit with no trigger can still be used as a dependency or registered through the explicit route form. This distinction lets internal graph operations stay transport-agnostic.

Capability tokens have identity. Export and reuse the same token when declaring and providing a capability. `provide()` checks the value's type. Values can be configuration or services; bindings live for the application's lifetime and must be safe to share between requests.

Registration rejects missing capabilities, duplicate names within a graph, and dependency cycles. Dependencies execute in declaration order before their consumer. Shared dependencies run once per request; results are never cached across requests. `use()` returns the typed result of a declared dependency. `get()` only exposes capabilities listed in that Unit's `requires` array. Both reject undeclared access.

`execute()` receives `request`, the normal request context with params, environment, state, and abort signal. Cancellation is checked between Units; asynchronous services should also observe `request.signal`. Errors flow through the application's error boundary, and normal middleware and HEAD handling apply to Unit routes.

The compiler writes graph names, dependencies, capability names, route metadata, and a server target to `units-manifest.json`. Capability values and dependency results are not serialized. Production startup compares this manifest with the loaded application. Browser builds reject imports of `@instjs/core/units`, runtime, adapter, compiler, and CLI packages.

The trigger field is intentionally extensible. HTTP is the first supported trigger family; future CLI, queue, scheduled, and realtime triggers can use the same Unit model without turning filenames into application architecture.

This v1 model provides explicit dependency access and deployment validation. It is not a JavaScript sandbox: application code can still import modules or access globals. V1 does not automatically move Units between runtimes, infer capabilities from arbitrary code, hydrate server Units, or serialize their results into browser code. Browser execution uses a separate, explicitly configured entry.
