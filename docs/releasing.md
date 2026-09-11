# Releasing Inst.js

Inst.js releases use one version across the root workspace and every publishable `@instjs/*` package.

## Prepare a release

1. Choose the semantic version for the release.
2. Set that version in the root `package.json` and every package under `packages/`.
3. Run `pnpm install` so the committed lockfile reflects any manifest changes.
4. Run the full verification sequence:

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

The development integration check verifies that `inst dev` starts successfully, reports failed rebuilds in the browser, retains the last known good application, and reloads after successful server or browser rebuilds. The browser integration check verifies the built client entry, source map delivery, and `HEAD` semantics through the production Node server. The production integration check verifies the built application through the real Node server lifecycle.

`pnpm release:check` creates package archives in a temporary directory and verifies public metadata, generated `dist` files, package boundaries, version consistency, and removal of workspace protocol references from packed manifests.

`pnpm release:install-check` installs fresh tarballs outside the workspace, checks public imports and the installed CLI executable, creates a new application, installs its dependencies using local Inst tarballs, typechecks it, verifies development SSR and rebuilds, compares repeated production builds, verifies production SSR/health/static output and browser assets, and checks bounded shutdown. Framework packages never need to exist on npm. Third-party dependencies still require registry access or a populated package-manager cache. Graceful signal exit is asserted on Linux CI; Windows checks process termination because Node's child-process signal API forcibly terminates Windows processes.

## Tag validation

Before tagging, confirm the exact `main` commit has a successful CI run, review `CHANGELOG.md`, and confirm all seven public packages and the root use the release version. Do not treat an earlier commit's CI result as validation of the release commit.

Create a tag matching the package version exactly:

```bash
node scripts/verify-release-tag.mjs v1.0.2
git tag -a v1.0.2 -m "Inst.js v1.0.2"
git push origin v1.0.2
```

The release validation workflow rejects tags that do not match the root version or package versions and reruns the complete production verification sequence from a frozen lockfile.

After all validation steps pass, the workflow packs all seven publishable packages from that exact checked-out tag and uploads them as a `inst-v1.0.2-packages` workflow artifact. Those tarballs are the release candidates. Do not rebuild the packages on another machine before publishing them.

## Publication

Package publication is intentionally separate from validation. Configure an authenticated npm publishing mechanism, preferably trusted publishing with short-lived credentials, before adding an automated publish step. Never store a long-lived npm token in the repository.

For v1.0.2, download the `inst-v1.0.2-packages` artifact from the successful release-validation run and publish those exact `.tgz` files. Publish the dependency foundations first and the CLI last:

```bash
npm publish release-artifacts/inst.js-core-1.0.2.tgz --access public
npm publish release-artifacts/inst.js-router-1.0.2.tgz --access public
npm publish release-artifacts/inst.js-render-1.0.2.tgz --access public
npm publish release-artifacts/inst.js-compiler-1.0.2.tgz --access public
npm publish release-artifacts/inst.js-runtime-1.0.2.tgz --access public
npm publish release-artifacts/inst.js-adapter-node-1.0.2.tgz --access public
npm publish release-artifacts/inst.js-cli-1.0.2.tgz --access public
```

If a package manager produces slightly different archive filenames, use the seven tarballs from the workflow artifact by package name. The important invariant is that npm receives the exact archives produced by the successful tag-validation run, not a fresh local `dist` directory.

The publish command is a separate external action and requires npm ownership/access for the `@instjs` scope. Use a fresh npm OTP only in the terminal when npm requests it; never paste credentials, tokens, or OTP values into chat or source control.

## Release checklist

- All versions match the tag and the lockfile is committed when it changes.
- Exact release commit CI is successful on the existing Linux runner.
- Unit tests, typechecking, three lifecycle integrations, starter verification, tarball checks, and packed installation checks pass.
- Release validation succeeds for the exact tag and uploads seven verified tarballs.
- README installation command and generated package names match the actual CLI package.
- Changelog, migration notes, architecture, deployment, and security guidance describe the implementation.
- npm scope access and publication credentials are configured separately.
- After publication, verify all seven registry versions and `latest` dist-tags, then run `npx @instjs/cli@1.0.2 create my-app` from outside the repository before announcing availability.
