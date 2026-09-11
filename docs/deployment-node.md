# Node.js deployment

Inst.js requires Node.js 22 or newer. Production output is a Node.js ESM bundle with build, route, and Unit graph manifests. The CLI verifies them before opening the listener.

## Build

From an application root:

```bash
npm run build
```

The default output directory is `.inst`. A production build contains the server entry at `.inst/server/app.mjs` and a `.inst/manifest.json` file describing the entry, output hash, and compiler inputs.

Use `--out-dir` when the deployment environment requires another location:

```bash
npm run build -- --out-dir dist
```

Each server build clears its previous server output before compiling so removed modules cannot survive as stale deployment artifacts.

## Start

Run the verified production bundle with:

```bash
npm run start
```

The default listener is `0.0.0.0:3000`. Both values are configurable:

```bash
npm run start -- --host 127.0.0.1 --port 8080
```

`inst start` refuses to launch when the server bundle is missing or its SHA-256 hash no longer matches the build manifest.

## Adapter API

Applications that manage their own process lifecycle can use `@instjs/adapter-node` directly.

```ts
import { serve } from "@instjs/adapter-node";
import app from "./app.js";

const server = await serve(app, {
  hostname: "0.0.0.0",
  port: 3000,
  probes: {
    health: () => true,
    ready: async () => true,
  },
});

console.log(server.url.href);
```

The adapter translates Node.js requests and responses to Web Platform `Request` and `Response` objects. Request bodies are streamed into the application, response bodies are streamed back with backpressure, multiple `Set-Cookie` values are preserved, and `HEAD` responses never write a body.

## Explicit static assets

Node deployments can layer explicitly mapped files in front of an application with `@instjs/adapter-node/assets`. The mapping is opt-in: Inst does not expose arbitrary project or build directories.

```ts
import { serve } from "@instjs/adapter-node";
import { withNodeAssets } from "@instjs/adapter-node/assets";
import { fileURLToPath } from "node:url";
import app from "./app.js";

const deployed = withNodeAssets(app, {
  assets: [
    {
      pathname: "/.inst/client/app.js",
      filePath: fileURLToPath(new URL("./client/app.js", import.meta.url)),
    },
  ],
});

await serve(deployed, { port: 3000 });
```

Only `GET` and `HEAD` requests are intercepted. Missing mapped files return 404, duplicate pathnames are rejected, and asset pathnames must be normalized absolute URL paths without a query string, fragment, or scheme-relative form. All other requests continue to the underlying application. The default cache policy is `no-cache`, which is safe for stable asset URLs whose contents may change between deployments. Use `cacheControl` only when the deployed URL strategy makes stronger caching safe.

## Health and readiness

When probe support is configured, the adapter exposes these defaults:

- `/.inst/health`
- `/.inst/ready`

Probe callbacks may be synchronous or asynchronous. A false health or readiness result returns HTTP 503. Paths can be replaced with `healthPath` and `readinessPath`. Custom probe paths must be distinct, normalized absolute pathnames without a query string or fragment; invalid configuration is rejected before the listener starts.

Probe endpoints accept only `GET` and `HEAD`. Other methods return HTTP 405 with `Allow: GET, HEAD`. Probe responses always use `Cache-Control: no-store` so load balancers and intermediaries do not reuse stale process state. `HEAD` returns the same status and headers as `GET` without a response body.

## Shutdown

The CLI handles `SIGINT` and `SIGTERM`, stops file watching in development, and closes the Node.js server before exiting. Applications using the adapter directly should call `server.close()` during their own shutdown sequence. Client disconnects abort the request signal and cancel response streams. Configure a shutdown deadline in your process supervisor for applications with long-lived connections.

Deploy the complete `.inst` directory, `package.json`, lockfile, and any project configuration needed for the output location or server settings. The generated `start` script uses `@instjs/cli`, which is a development dependency: retain it in the deployment installation or explicitly install the matching CLI version. An installation with `--omit=dev` alone cannot run that script. Build-time prerendering executes application code; make required environment values and services available during the build. Static HTML is an export for static hosting; `inst start` validates it but continues to serve requests through the application.

## Reverse proxies

When Inst runs behind a reverse proxy, terminate TLS at the proxy or load balancer and forward requests to the Node.js listener. Configure a fixed `origin` in the adapter when application URL construction must not depend on the incoming `Host` header. The value must be a plain HTTP or HTTPS origin such as `https://app.example.com`; credentials, paths, query strings, and fragments are rejected so deployment mistakes cannot be silently normalized.

Without a configured `origin`, the adapter uses the incoming `Host` authority only as the base for the request path and query. Absolute-form request targets cannot override that authority. Malformed authorities are rejected with HTTP 400 before the application runs, and the response is marked `Cache-Control: no-store`.
