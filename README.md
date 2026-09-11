# Inst.js

Inst.js is a capability-driven TypeScript and JavaScript web framework for building server-rendered applications with explicit browser boundaries.

It uses Web-standard request and response APIs, supports SSR and static generation, and targets Node.js 22 or newer.

## Highlights

- Server-rendered HTML by default
- Minimal browser JavaScript unless explicitly needed
- Capability-first application structure
- First-class TypeScript support
- Web-standard Request and Response APIs
- Deterministic production builds
- Adapter-based deployment

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

Routes are declared by Units instead of being inferred from filenames, so application structure can follow the domain rather than routing conventions.

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Capability Units](docs/units.md)
- [Routing](docs/routing.md)
- [Rendering](docs/rendering.md)
- [Build output](docs/build-output.md)
- [Plugin authoring](docs/plugin-authoring.md)
- [Node.js deployment](docs/deployment-node.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and security guidance.

## License

MIT
