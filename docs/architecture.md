# Architecture

Inst.js is organized around small packages with narrow responsibilities. The repository layout is deliberately boring: framework behavior belongs in framework packages, runnable examples belong in examples, and package boundaries should reflect runtime boundaries.

## Package boundaries

`@instjs/core` contains public contracts that can be shared without pulling in a server, compiler, or renderer. Runtime adapters can depend on the portable `InstFetchApplication` and `InstAdapter` contracts from `@instjs/core/adapter` without importing Node.js-specific code.

`@instjs/router` owns route normalization, precedence, matching, and parameter extraction. It has no dependency on the application runtime.

`@instjs/core/units` defines typed capability tokens, bindings, and Units. `@instjs/runtime` validates Unit dependency graphs, executes them once per request, and turns Web Platform `Request` objects into application responses. Unit routes share the same routing, middleware, and error boundaries as low-level routes.

The server adapter, compiler, CLI, renderer, and deployment adapters are built on top of these foundations rather than being folded into one package.

## Runtime rules

Inst.js uses Web Platform primitives at the application boundary. A request handler receives a `Request` and returns a `Response`. Adapters are responsible for translating platform-specific input and output when necessary.

The runtime should remain deterministic. Route selection, plugin registration order, configuration resolution, and rendering decisions must be reproducible between development and production.

## Adapter contract

Additional runtime adapters should implement the small contract exported by `@instjs/core/adapter`:

```ts
import type {
  InstAdapter,
  InstFetchApplication,
} from "@instjs/core/adapter";
```

`InstFetchApplication` exposes only Web-standard request dispatch. `InstAdapter<TOptions, TServer>` describes the deployment boundary that accepts such an application and returns a platform-specific server or runtime handle. Platform-specific concerns such as sockets, filesystem access, probes, and process lifecycle remain outside the core application contract.

## Browser cost

Server output is the default. Browser code is added through an explicit client entry, bundled separately, and tree-shaken by esbuild. The compiler rejects server-only Inst imports in that graph. Unit graphs remain on the server; their declarations are recorded in a manifest and verified at production startup. Automatic capability inference and cross-runtime Unit placement are outside v1. See [Capability Units](units.md) for the implemented model and its limits.

## Configuration

Configuration is code, but framework internals should not leak into application configuration. Stable configuration belongs in `InstConfig`; deployment-specific behavior belongs in adapters.

## Compatibility

The first release targets maintained Node.js versions beginning with Node.js 22. The core runtime is written against standard `Request`, `Response`, `URL`, and `AbortSignal` APIs so additional runtimes can be supported without changing application handlers.

## Repository discipline

Public packages should have explicit exports, strict TypeScript settings, isolated tests, and no accidental cross-package imports. Internal implementation details stay private unless they are required to extend the framework safely.
