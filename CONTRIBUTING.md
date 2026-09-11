# Contributing

Use Node.js 22+ and pnpm 10.15.1, the version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm example:check
pnpm integration:development
pnpm integration:browser
pnpm integration:production
pnpm release:check
pnpm release:install-check
```

Build before testing: package imports resolve through their public `dist` exports. Integration checks must run sequentially because development verification temporarily edits the basic example and restores it afterward.

Keep changes focused, preserve strict TypeScript and Web-standard runtime contracts, and add regression coverage for behavior changes. Document public API and output-format changes in the migration guide and changelog. Keep platform-specific code in adapters, compiler, or CLI packages. Capability Units and explicit browser boundaries are part of the v1 architecture.

Pull requests run on the repository's self-hosted Linux runner. Do not change runner configuration or credentials as part of a framework change. Package publication is separate from CI; see [releasing](docs/releasing.md).
