import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ScaffoldOptions {
  readonly language?: "typescript" | "javascript";
  readonly tailwind?: boolean;
}

export interface ScaffoldResult {
  readonly root: string;
  readonly files: readonly string[];
}

interface BrandAssets {
  readonly logo: string;
  readonly favicon: string;
}

function packageName(root: string): string {
  const name = path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  return name || "inst-app";
}

async function frameworkVersion(): Promise<string> {
  const packagePath = new URL("../package.json", import.meta.url);
  const manifest = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Unable to determine the Inst.js CLI version");
  }
  return manifest.version === "0.0.0" ? "latest" : manifest.version;
}

async function brandAsset(name: "logo.svg" | "favicon.svg"): Promise<string> {
  try {
    return await readFile(new URL(`./assets/${name}`, import.meta.url), "utf8");
  } catch {
    return readFile(new URL(`../../../${name}`, import.meta.url), "utf8");
  }
}

async function brandAssets(): Promise<BrandAssets> {
  const [logo, favicon] = await Promise.all([brandAsset("logo.svg"), brandAsset("favicon.svg")]);
  return { logo, favicon };
}

function sourceExtension(language: "typescript" | "javascript", jsx = false): string {
  if (language === "typescript") return jsx ? "tsx" : "ts";
  return jsx ? "jsx" : "js";
}

function projectFiles(
  root: string,
  version: string,
  brand: BrandAssets,
  options: Required<ScaffoldOptions>,
): Readonly<Record<string, string>> {
  const typed = options.language === "typescript";
  const codeExt = sourceExtension(options.language);
  const jsxExt = sourceExtension(options.language, true);
  const configExt = typed ? "ts" : "js";
  const welcomeImportExt = typed ? "js" : "jsx";
  const dependencies: Record<string, string> = {
    "@instjs/core": version,
    "@instjs/render": version,
    "@instjs/runtime": version,
  };
  const devDependencies: Record<string, string> = {
    "@instjs/cli": version,
    ...(typed ? { "@types/node": "^22.0.0", typescript: "^5.9.0" } : {}),
    ...(options.tailwind ? { concurrently: "^9.2.1", tailwindcss: "^3.4.17" } : {}),
  };
  const scripts: Record<string, string> = options.tailwind
    ? {
        dev: "concurrently -k -n styles,inst \"npm:styles:watch\" \"inst dev\"",
        build: "npm run styles:build && inst build",
        start: "inst start",
        "styles:build": "tailwindcss -i ./src/styles.css -o ./public/styles.css --minify",
        "styles:watch": "tailwindcss -i ./src/styles.css -o ./public/styles.css --watch",
        ...(typed ? { typecheck: "tsc -p tsconfig.json --noEmit" } : {}),
      }
    : {
        dev: "inst dev",
        build: "inst build",
        start: "inst start",
        ...(typed ? { typecheck: "tsc -p tsconfig.json --noEmit" } : {}),
      };

  const files: Record<string, string> = {
    ".gitignore": ".inst\nnode_modules\n.env*.local\npublic/styles.css\n",
    "package.json": `${JSON.stringify({
      name: packageName(root),
      private: true,
      type: "module",
      engines: { node: ">=22.0.0" },
      scripts,
      dependencies,
      devDependencies,
    }, null, 2)}\n`,
    [`inst.config.${configExt}`]: `import { defineConfig } from "@instjs/core";\n\nexport default defineConfig({\n  build: {\n    entry: "src/app.${codeExt}",\n    prerender: ["/"],\n  },\n});\n`,
    [`src/app.${codeExt}`]: `import { createApplication } from "@instjs/runtime";\nimport publicAssets from "./system/public-assets.js";\n\nexport default await createApplication({\n  mode: process.env.NODE_ENV === "production" ? "production" : "development",\n  env: process.env,\n  units: [...publicAssets],\n});\n`,
    [`src/pages/home.${jsxExt}`]: `import { http } from "@instjs/core/units";\nimport { definePage } from "@instjs/render/page";\nimport Welcome from "../components/Welcome.${welcomeImportExt}";\n\nexport default definePage({\n  name: "home",\n  trigger: http.get("/"),\n  meta: {\n    title: "Inst.js",\n    description: "An Inst.js application.",\n  },\n  head: [\n    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />,\n    ${options.tailwind ? '<link rel="stylesheet" href="/styles.css" />,' : ""}\n  ],\n  view() {\n    return <Welcome />;\n  },\n});\n`,
    [`src/components/Welcome.${jsxExt}`]: options.tailwind
      ? `export default function Welcome() {\n  return (\n    <div className="min-h-screen bg-zinc-950 text-zinc-100">\n      <header className="border-b border-zinc-800">\n        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">\n          <img src="/logo.svg" alt="Inst.js" className="h-8 w-auto" />\n          <a className="text-sm text-zinc-400 hover:text-white" href="https://github.com/kawinduwijewardhane/inst.js">GitHub</a>\n        </div>\n      </header>\n\n      <main className="mx-auto max-w-4xl px-6 py-20 sm:py-28">\n        <p className="text-sm text-zinc-400">Inst.js is running.</p>\n        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-6xl">Your app is ready.</h1>\n        <p className="mt-6 max-w-xl text-base leading-7 text-zinc-400">\n          Edit <code className="rounded bg-zinc-900 px-1.5 py-1 text-zinc-200">src/pages/home.${jsxExt}</code> and save to see your changes.\n        </p>\n\n        <div className="mt-8 flex flex-wrap gap-3">\n          <a href="https://github.com/kawinduwijewardhane/inst.js" className="rounded-md bg-white px-4 py-2.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200">Documentation</a>\n          <a href="https://github.com/kawinduwijewardhane/inst.js" className="rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:border-zinc-500">View on GitHub</a>\n        </div>\n\n        <p className="mt-12 max-w-xl text-sm leading-6 text-zinc-500">\n          Pages are discovered automatically. Routes still come from each Unit's trigger.\n        </p>\n      </main>\n    </div>\n  );\n}\n`
      : `export default function Welcome() {\n  return (\n    <main>\n      <img src="/logo.svg" alt="Inst.js" width="180" />\n      <p>Inst.js is running.</p>\n      <h1>Your app is ready.</h1>\n      <p>Edit src/pages/home.${jsxExt} and save to see your changes.</p>\n    </main>\n  );\n}\n`,
    [`src/system/public-assets.${codeExt}`]: `import { readFile } from "node:fs/promises";\nimport path from "node:path";\nimport { defineUnit, http } from "@instjs/core/units";\n\nconst publicFile = (name${typed ? ": string" : ""}, type${typed ? ": string" : ""}) => defineUnit({\n  name: \`public.\${name.replace(/[^a-z0-9]+/gi, ".")}\`,\n  trigger: http.get(\`/\${name}\`),\n  async execute() {\n    const body = await readFile(path.join(process.cwd(), "public", name));\n    return new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=0, must-revalidate" } });\n  },\n});\n\nexport default [\n  publicFile("logo.svg", "image/svg+xml"),\n  publicFile("favicon.svg", "image/svg+xml"),\n  ${options.tailwind ? 'publicFile("styles.css", "text/css; charset=utf-8"),' : ""}\n];\n`,
    "public/logo.svg": brand.logo,
    "public/favicon.svg": brand.favicon,
  };

  if (options.tailwind) {
    files["src/styles.css"] = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n";
    files["tailwind.config.js"] = `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: ["./src/**/*.{js,jsx,ts,tsx}"],\n  theme: { extend: {} },\n  plugins: [],\n};\n`;
  }

  if (typed) {
    files["tsconfig.json"] = `${JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        jsx: "react-jsx",
        jsxImportSource: "@instjs/render",
        types: ["node"],
      },
      include: ["src/**/*.ts", "src/**/*.tsx", "inst.config.ts"],
    }, null, 2)}\n`;
  }

  return files;
}

export async function scaffoldProject(root: string, options: ScaffoldOptions = {}): Promise<ScaffoldResult> {
  const resolvedRoot = path.resolve(root);
  await mkdir(resolvedRoot, { recursive: true });

  const existing = await readdir(resolvedRoot);
  if (existing.length > 0) {
    throw new Error(`Cannot create an Inst project in non-empty directory: ${resolvedRoot}`);
  }

  const resolvedOptions: Required<ScaffoldOptions> = {
    language: options.language ?? "typescript",
    tailwind: options.tailwind ?? true,
  };
  const [version, brand] = await Promise.all([frameworkVersion(), brandAssets()]);
  const files = projectFiles(resolvedRoot, version, brand, resolvedOptions);
  for (const [relativePath, content] of Object.entries(files)) {
    const outputPath = path.join(resolvedRoot, relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, { encoding: "utf8", flag: "wx" });
  }

  return { root: resolvedRoot, files: Object.keys(files) };
}
