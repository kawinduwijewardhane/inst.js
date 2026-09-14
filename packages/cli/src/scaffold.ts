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
    ...(options.tailwind ? { "@tailwindcss/cli": "^4.3.3", concurrently: "^9.2.1", tailwindcss: "^4.3.3" } : {}),
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
      ? `export default function Welcome() {\n  return (\n    <div className="min-h-screen bg-[#08090a] text-zinc-100 antialiased selection:bg-white selection:text-black">\n      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">\n        <img src="/logo.svg" alt="Inst.js" className="h-8 w-auto sm:h-9" />\n        <a className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500 transition-colors hover:text-white" href="https://github.com/kawinduwijewardhane/inst.js">GitHub</a>\n      </header>\n\n      <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center px-5 py-16 sm:px-8 sm:py-20">\n        <div className="w-full max-w-4xl">\n          <div className="mb-9 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">\n            <span className="inline-block h-2 w-2 bg-emerald-400" />\n            <span>Inst.js is running.</span>\n          </div>\n\n          <h1 className="max-w-3xl text-5xl font-medium leading-[0.95] tracking-[-0.055em] text-white sm:text-7xl lg:text-8xl">\n            Your app\n            <span className="block text-zinc-500">is ready.</span>\n          </h1>\n\n          <p className="mt-10 max-w-2xl text-sm leading-7 text-zinc-400 sm:mt-12 sm:text-base">\n            Edit <code className="font-mono text-zinc-100">src/pages/home.${jsxExt}</code> and save to see your changes.\n          </p>\n\n          <div className="mt-10 flex flex-wrap items-center gap-4">\n            <a href="https://github.com/kawinduwijewardhane/inst.js" className="inline-flex h-11 items-center bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-zinc-200">Documentation</a>\n            <a href="https://github.com/kawinduwijewardhane/inst.js" className="text-sm font-medium text-zinc-400 transition-colors hover:text-white">View on GitHub</a>\n          </div>\n\n          <p className="mt-16 max-w-2xl text-xs leading-6 text-zinc-600 sm:mt-20 sm:text-sm">Pages are discovered automatically. Routes still come from each Unit's trigger.</p>\n        </div>\n      </main>\n    </div>\n  );\n}\n`
      : `export default function Welcome() {\n  return (\n    <main>\n      <img src="/logo.svg" alt="Inst.js" width="180" />\n      <p>Inst.js is running.</p>\n      <h1>Your app is ready.</h1>\n      <p>Edit src/pages/home.${jsxExt} and save to see your changes.</p>\n    </main>\n  );\n}\n`,
    [`src/system/public-assets.${codeExt}`]: `import { readFile } from "node:fs/promises";\nimport path from "node:path";\nimport { defineUnit, http } from "@instjs/core/units";\n\nconst publicFile = (name${typed ? ": string" : ""}, type${typed ? ": string" : ""}) => defineUnit({\n  name: \`public.\${name.replace(/[^a-z0-9]+/gi, ".")}\`,\n  trigger: http.get(\`/\${name}\`),\n  async execute() {\n    const body = await readFile(path.join(process.cwd(), "public", name));\n    return new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=0, must-revalidate" } });\n  },\n});\n\nexport default [\n  publicFile("logo.svg", "image/svg+xml"),\n  publicFile("favicon.svg", "image/svg+xml"),\n  ${options.tailwind ? 'publicFile("styles.css", "text/css; charset=utf-8"),' : ""}\n];\n`,
    "public/logo.svg": brand.logo,
    "public/favicon.svg": brand.favicon,
  };

  if (options.tailwind) {
    files["src/styles.css"] = '@import "tailwindcss";\n';
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
