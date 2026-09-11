# Build output

`inst build` writes production artifacts under `.inst` by default. The directory can be changed with `build.outDir` in `inst.config.ts` or `--out-dir` on the CLI.

The build directory is generated output and should not be edited by hand. It must be a child of the project root, outside source entries and protected `src`, `.git`, and `node_modules` directories. Build paths must not contain symbolic links or junctions. Checks run before cleanup and verification; do not modify the output directory concurrently with a build or startup.

Each build removes optional browser and static artifacts from the previous build before deciding whether to produce them again. Disabling a client entry or removing prerender paths therefore cannot leave stale deployable output behind.

`.inst/deployment-manifest.json` is written only after the complete CLI build succeeds. It records the expected manifests and their hashes, including optional browser and static manifests. Startup rejects missing, added, or modified manifests, and a failed rebuild cannot be started as a completed release. These hashes check consistency, not authenticity; deploy only trusted artifacts.

## Server manifest

`.inst/manifest.json` describes the bundled server application. It records the build mode, application entry, server output path, SHA-256 integrity hash, and compiler inputs.

`inst start` verifies the server output against this manifest before importing the application.

## Route manifest

`.inst/routes-manifest.json` contains normalized route metadata discovered from the built application, including routes registered by plugins during setup.

```json
{
  "version": 1,
  "kind": "inst-routes",
  "routes": [
    { "path": "/" },
    { "method": "POST", "path": "/api/items" }
  ]
}
```

Method-agnostic routes omit `method`. Method-specific routes use normalized uppercase HTTP methods. Entries are sorted deterministically by path and method so the manifest is stable across equivalent builds.

The manifest contains route metadata only. Request handlers and application state are never serialized into it. `inst start` validates the route manifest before accepting a production build.

## Unit graph manifest

`.inst/units-manifest.json` records the server Unit graphs registered by the built application. It contains Unit names, declared capability names, dependency order, and route metadata, without capability values or request data. Production startup requires this manifest, including an empty graph list for applications that only use low-level routes, and compares it with the loaded application. Rebuild older output before using the v1 CLI.

## Browser manifests

When `build.clientEntry` or `--client-entry` is configured, `.inst/client-manifest.json` describes the explicit browser bundle in `.inst/client/app.js`, including its integrity hash and compiler inputs.

`.inst/assets-manifest.json` inventories every emitted browser artifact, including source maps when enabled. Each entry records its project-relative output path, byte size, and SHA-256 integrity hash. Client build verification checks every listed asset before treating the browser graph as valid.

Browser code is never inferred from server rendering. A client entry must be opted into explicitly. Applications that opt in can reference the stable public browser URL from server-rendered HTML:

```html
<script type="module" src="/.inst/client/app.js"></script>
```

`inst dev` builds the explicit browser graph in development mode, rebuilds it with source changes, and serves its emitted assets below `/.inst/client/`. `inst start` verifies the production browser entry and every asset in the asset manifest before opening the server, then exposes the same stable URL space. Modified or incomplete browser output fails startup instead of being accepted silently.

The build directory itself is never exposed as a static directory. Only files listed by the verified browser asset manifest are mapped by the Node deployment layer.

## Static manifest

When prerender paths are configured, `.inst/static-manifest.json` maps each generated URL path to its HTML output and integrity hash. Generated documents are stored below `.inst/static`.

Static generation uses the same built application as the server graph, so route setup and rendering behavior remain consistent with production request handling.

When a static manifest is present, `inst start` verifies every generated page against its recorded path and SHA-256 hash before opening the production server.
