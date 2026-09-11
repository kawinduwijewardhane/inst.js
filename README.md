# Inst.js

Inst.js is a capability-driven TypeScript and JavaScript web framework. Server-side Units declare their triggers, capabilities, and dependencies; the runtime executes their graphs per request, and the compiler records deployment boundaries. HTML is rendered on the server, with browser JavaScript added only through an explicit client entry.

Inst.js targets Node.js 22 or newer, with Web-standard request and response APIs, SSR, static generation, deterministic builds, and a Node adapter.

## Goals

- Fast local development and production startup
- Server-rendered HTML by default
- Minimal browser JavaScript unless a feature needs it
- Capability-first application structure instead of filesystem-driven routing
- First-class TypeScript support
- Deployment through adapters instead of application rewrites

## Quick start

Create a project and start the development server:

```bash
npx @instjs/cli create my-app
cd my-app
npm install
npm run dev
```

A normal HTTP feature is a Unit with a trigger:

```tsx
import { defineUnit, http } from "@instjs/core/units";

export const home = defineUnit({
  name: "home",
  trigger: http.get("/"),
  execute() {
    return new Response("Hello from Inst.js");
  },
});
```

The route lives with the Unit, not in its filename. Organize features by domain, capability, or team without turning folders into routing configuration.

See the [getting started guide](docs/getting-started.md) for the project structure, production build, static generation, and explicit browser entry points.

## Repository

This repository is a pnpm workspace. Framework packages live under `packages/` and examples live under `examples/`.

```text
packages/
  core/          public framework contracts
  router/        route matching and route metadata
  runtime/       request dispatch and middleware runtime
  render/        server HTML and streaming helpers
  adapter-node/  Node.js HTTP adapter
  compiler/      source analysis and build pipeline
  cli/           inst commands
examples/
  basic/         small application used for integration testing
```

## Development

Requirements:

- Node.js 22+
- pnpm 10+

Install dependencies and run the same verification stages used by CI:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm example:check
pnpm integration:development
pnpm integration:browser
pnpm integration:production
pnpm release:check
pnpm release:install-check
pnpm typecheck
pnpm test
```

The development integration check starts `inst dev`, verifies server-rendered output and the optional browser graph, edits both server and client source, and confirms the running server serves rebuilt output before shutting down cleanly. The browser integration check independently builds an opted-in client graph, starts the production server, and verifies the browser entry and source map are delivered only through Inst.js's explicit asset mapping.

The basic example can be built directly from the workspace:

```bash
node packages/cli/dist/index.js build examples/basic
```

Before npm publication, use the workspace commands above. The packed installation check exercises a fresh generated application using local package tarballs and does not depend on unpublished packages from npm.

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Capability Units](docs/units.md)
- [Routing](docs/routing.md)
- [Rendering](docs/rendering.md)
- [Build output](docs/build-output.md)
- [Plugin authoring](docs/plugin-authoring.md)
- [Node.js deployment](docs/deployment-node.md)
- [Releasing](docs/releasing.md)

## License

MIT
