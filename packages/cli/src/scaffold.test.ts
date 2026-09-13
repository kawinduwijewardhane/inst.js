import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldProject } from "./scaffold.js";

const roots: string[] = [];

async function tempRoot(name: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), name));
  roots.push(root);
  return path.join(root, "app");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project scaffold", () => {
  it("creates the TypeScript Tailwind starter by default", async () => {
    const root = await tempRoot("inst-scaffold-ts-");
    const result = await scaffoldProject(root);
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const app = await readFile(path.join(root, "src/app.ts"), "utf8");
    const page = await readFile(path.join(root, "src/pages/home.tsx"), "utf8");
    const welcome = await readFile(path.join(root, "src/components/Welcome.tsx"), "utf8");
    const logo = await readFile(path.join(root, "public/logo.svg"), "utf8");

    expect(result.files).toContain("src/pages/home.tsx");
    expect(result.files).not.toContain("src/pages/index.ts");
    expect(result.files).toContain("tailwind.config.js");
    expect(manifest.devDependencies.tailwindcss).toBeDefined();
    expect(manifest.scripts.dev).toContain("styles:watch");
    expect(app).toContain("env: process.env");
    expect(page).toContain('import Welcome from "../components/Welcome.js";');
    expect(page).toContain('definePage({');
    expect(page).toContain("view() {");
    expect(page).toContain("return <Welcome />;");
    expect(page).not.toContain("documentResponse");
    expect(welcome).toContain("Your app is ready.");
    expect(welcome).toContain('src="/logo.svg"');
    expect(welcome).not.toContain("<svg");
    expect(logo.trimStart()).toMatch(/^<svg\b/);
  });

  it("creates a JavaScript starter without Tailwind when requested", async () => {
    const root = await tempRoot("inst-scaffold-js-");
    const result = await scaffoldProject(root, { language: "javascript", tailwind: false });
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const page = await readFile(path.join(root, "src/pages/home.jsx"), "utf8");
    const welcome = await readFile(path.join(root, "src/components/Welcome.jsx"), "utf8");

    expect(result.files).toContain("src/app.js");
    expect(result.files).toContain("src/pages/home.jsx");
    expect(result.files).toContain("src/components/Welcome.jsx");
    expect(result.files).toContain("inst.config.js");
    expect(result.files).not.toContain("tsconfig.json");
    expect(result.files).not.toContain("tailwind.config.js");
    expect(manifest.devDependencies.tailwindcss).toBeUndefined();
    expect(manifest.scripts.dev).toBe("inst dev");
    expect(page).toContain('import Welcome from "../components/Welcome.jsx";');
    expect(page).not.toContain('import Welcome from "../components/Welcome.js";');
    expect(welcome).toContain("Your app is ready.");
  });
});
