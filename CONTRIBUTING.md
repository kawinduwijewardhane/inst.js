# Contributing

Use Node.js 22+ and pnpm 10.15.1, the version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

Keep changes focused, preserve strict TypeScript and Web-standard runtime contracts, and add regression coverage for behavior changes.

Document changes that affect public APIs, documented behavior, or generated output. Keep platform-specific code in the appropriate adapter, compiler, or CLI package, and preserve Inst.js's capability-first architecture and explicit browser boundaries.

Before opening a pull request, make sure the project builds, typechecks, and tests successfully.
