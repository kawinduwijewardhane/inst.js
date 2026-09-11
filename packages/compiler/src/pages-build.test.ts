import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./pages-build.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("discovered Unit server build", () => {
  it("bundles page Units without requiring a manual registry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "inst-pages-"));
    roots.push(root);
    await mkdir(path.join(root, "src", "pages"), { recursive: true });
    await writeFile(path.join(root, "src", "app.ts"), "export default { unit() { return this; } };\n");
    await writeFile(path.join(root, "src", "pages", "about.ts"), "export default { name: 'about' };\n");

    const result = await buildServer({ root, entry: "src/app.ts", outDir: ".inst" });

    expect(result.manifest.entry).toBe("src/app.ts");
    expect(Object.keys(result.metafile.inputs).some((input) => input.endsWith("src/pages/about.ts"))).toBe(true);
    await expect(access(path.join(root, ".inst-units-entry.ts"))).rejects.toThrow();
  });

  it("discovers Unit folders and marked feature modules without treating filenames as routes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "inst-units-"));
    roots.push(root);
    await mkdir(path.join(root, "src", "units"), { recursive: true });
    await mkdir(path.join(root, "src", "features", "account"), { recursive: true });
    await writeFile(path.join(root, "src", "app.ts"), "export default { unit() { return this; } };\n");
    await writeFile(path.join(root, "src", "units", "health.ts"), "export default { name: 'health' };\n");
    await writeFile(path.join(root, "src", "features", "account", "profile.unit.ts"), "export default { name: 'profile' };\n");
    await writeFile(path.join(root, "src", "features", "account", "Profile.tsx"), "export default () => null;\n");

    const result = await buildServer({ root, entry: "src/app.ts", outDir: ".inst" });
    const inputs = Object.keys(result.metafile.inputs);

    expect(inputs.some((input) => input.endsWith("src/units/health.ts"))).toBe(true);
    expect(inputs.some((input) => input.endsWith("src/features/account/profile.unit.ts"))).toBe(true);
    expect(inputs.some((input) => input.endsWith("src/features/account/Profile.tsx"))).toBe(false);
  });

  it("ignores index and test files in discovery folders", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "inst-pages-"));
    roots.push(root);
    await mkdir(path.join(root, "src", "pages"), { recursive: true });
    await writeFile(path.join(root, "src", "app.ts"), "export default { unit() { return this; } };\n");
    await writeFile(path.join(root, "src", "pages", "home.ts"), "export default { name: 'home' };\n");
    await writeFile(path.join(root, "src", "pages", "index.ts"), "throw new Error('index should not be bundled');\n");
    await writeFile(path.join(root, "src", "pages", "home.test.ts"), "throw new Error('test should not be bundled');\n");

    const result = await buildServer({ root, entry: "src/app.ts", outDir: ".inst" });
    const inputs = Object.keys(result.metafile.inputs);

    expect(inputs.some((input) => input.endsWith("src/pages/home.ts"))).toBe(true);
    expect(inputs.some((input) => input.endsWith("src/pages/index.ts"))).toBe(false);
    expect(inputs.some((input) => input.endsWith("src/pages/home.test.ts"))).toBe(false);
  });
});
