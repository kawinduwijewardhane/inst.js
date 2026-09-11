# Getting started

Inst.js requires Node.js 22 or newer.

## Create an application

Create a project with the CLI:

```bash
npx @instjs/cli@latest create my-app
```

In an interactive terminal, Inst asks for the language, Tailwind CSS, package manager, dependency installation, and Git initialization. TypeScript and Tailwind are the defaults. Non-interactive creation uses the same defaults without installing dependencies or initializing Git.

A typical generated project is intentionally conventional and readable:

```text
my-app/
├─ public/
│  ├─ favicon.svg
│  └─ logo.svg
├─ src/
│  ├─ components/
│  │  └─ Welcome.tsx
│  ├─ pages/
│  │  └─ home.tsx
│  ├─ system/
│  │  └─ public-assets.ts
│  ├─ app.ts
│  └─ styles.css
├─ tailwind.config.js
├─ tsconfig.json
└─ inst.config.ts
```

The official Inst.js logo and favicon are copied as real files into `public`; application code does not embed their SVG source. The default welcome page is server-rendered TSX and uses Tailwind when Tailwind is selected.

## Pages and Unit discovery

Files under `src/pages` are discovered as Inst page Units. A page filename is only organization; it never determines the URL. The page owns its route through its trigger:

```tsx
import { http } from "@instjs/core/units";
import { definePage } from "@instjs/render/page";

export default definePage({
  name: "about",
  trigger: http.get("/about"),
  meta: {
    title: "About",
  },
  view() {
    return (
      <main>
        <h1>About</h1>
      </main>
    );
  },
});
```

Creating `src/pages/about.tsx` is enough for discovery. There is no page registry to update and no filename-to-route convention to remember.

Inst also discovers ordinary Unit modules under `src/units`. For domain-oriented feature folders, mark discoverable files with `.unit`:

```text
src/
├─ pages/
│  ├─ home.tsx
│  └─ account.tsx
├─ units/
│  └─ health.ts
└─ features/
   └─ billing/
      ├─ BillingCard.tsx
      └─ invoice.unit.ts
```

`BillingCard.tsx` remains a normal component. `invoice.unit.ts` is discovered because it is explicitly marked as a Unit. This keeps filesystem organization flexible without turning folders or filenames into routing rules.

Dynamic parameters use the Unit model:

```ts
import { defineUnit, http } from "@instjs/core/units";

export default defineUnit({
  name: "profile",
  trigger: http.get("/users/:id"),
  execute({ request }) {
    return Response.json({ id: request.params.id });
  },
});
```

Available HTTP helpers are `http.get()`, `http.post()`, `http.put()`, `http.patch()`, `http.delete()`, and `http.any()`. Internal Units can omit a trigger and exist only as graph dependencies. Low-level `app.route()` and explicit `app.unit()` registration remain available as escape hatches.

## Page data

Pages can load request-specific data before rendering. The loader receives the Web-standard request context, including dynamic params and environment values. Its inferred result is available to metadata, head entries, and the view as `data`:

```tsx
export default definePage({
  name: "profile",
  trigger: http.get("/users/:id"),
  async data({ params }) {
    const response = await fetch(`https://api.example.com/users/${params.id}`);
    return response.json() as Promise<{ id: string; name: string }>;
  },
  meta({ data }) {
    return { title: data.name };
  },
  view({ data }) {
    return <h1>{data.name}</h1>;
  },
});
```

The `data` phase may be synchronous or asynchronous. Pages without a data loader keep the existing synchronous rendering path. Static/server-rendered output still ships no application JavaScript unless browser behavior is explicitly configured.

## Environment variables

Inst loads `.env`, `.env.local`, mode-specific environment files such as `.env.development`, and their local variants. Existing process environment values take precedence.

Page views receive the environment through their request context:

```tsx
export default definePage({
  name: "dashboard",
  trigger: http.get("/dashboard"),
  view({ env }) {
    return <h1>{env.values.APP_NAME}</h1>;
  },
});
```

## Application entry

The generated `src/app.ts` or `src/app.js` creates the application and is intentionally small. Discovered page and Unit modules are attached by the compiler, so feature registration does not accumulate in the entry file. Loaded process environment values are passed into the application context automatically by the generated starter.

Inst applications expose the Web-standard `fetch(Request): Promise<Response>` contract. The Node.js adapter translates incoming HTTP requests to that contract without changing application code.

## Project configuration

Use `inst.config.ts` for TypeScript projects or `inst.config.js` for JavaScript projects:

```ts
import { defineConfig } from "@instjs/core";

export default defineConfig({
  build: {
    entry: "src/app.ts",
    outDir: ".inst",
    prerender: ["/"],
    origin: "https://example.com",
  },
  server: {
    hostname: "127.0.0.1",
    port: 3000,
  },
});
```

Inst also accepts `inst.config.mts` and `inst.config.mjs`. Keep exactly one configuration file in a project. Command-line options take precedence over matching configuration values.

The `build.clientEntry` option enables an explicit browser graph. Without one, server-rendered pages ship no application JavaScript by default.

## Development and production

Use the generated scripts:

```bash
npm run dev
npm run build
npm run start
```

When Tailwind is selected, `npm run dev` runs the Tailwind watcher beside `inst dev`, and `npm run build` creates the production stylesheet before the Inst build.

`inst dev` watches `src` recursively. Added, removed, renamed, and edited page or Unit files trigger rebuilds. Failed rebuilds keep the last known good application visible while the browser error overlay shows the failure. Runtime 500 responses also receive a development error page. A successful rebuild reloads the browser automatically.

`inst build` writes deterministic production output to `.inst` by default. `inst start` verifies server, route, Unit, static, deployment, and optional browser manifests before starting the Node.js server.

## Optional browser code

Browser execution is opt-in. Add a client entry only when a feature needs browser behavior:

```ts
import { defineConfig } from "@instjs/core";

export default defineConfig({
  build: {
    clientEntry: "src/client.ts",
  },
});
```

Inst serves the emitted entry at `/.inst/client/app.js` in development and production. Production startup verifies the browser manifest and asset hashes before serving emitted browser files.

## Where to go next

Continue with [Capability Units](units.md) for graph composition, [Rendering](rendering.md) for server HTML and metadata, [Routing](routing.md) for routing behavior, and [Build output](build-output.md) for deployment artifacts and integrity checks.
