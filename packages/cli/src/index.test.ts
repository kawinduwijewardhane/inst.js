import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs, runCli } from "./index.js";

describe("parseCliArgs", () => {
  it("uses production-safe defaults", () => {
    const options = parseCliArgs(["build"], "/work/app");

    expect(options).toEqual({
      command: "build",
      root: path.resolve("/work/app"),
      outDir: ".inst",
      hostname: "0.0.0.0",
      port: 3000,
      prerenderPaths: [],
    });
  });

  it("accepts root and server options", () => {
    const options = parseCliArgs(
      [
        "dev",
        "site",
        "--entry",
        "src/server.ts",
        "--client-entry",
        "src/client.ts",
        "--out-dir=.build",
        "--host",
        "127.0.0.1",
        "--port=4100",
      ],
      "/work",
    );

    expect(options).toEqual({
      command: "dev",
      root: path.resolve("/work/site"),
      entry: "src/server.ts",
      clientEntry: "src/client.ts",
      outDir: ".build",
      hostname: "127.0.0.1",
      port: 4100,
      prerenderPaths: [],
    });
  });

  it("collects browser and build-only static entries", () => {
    const options = parseCliArgs(
      [
        "build",
        "--client-entry",
        "src/client.ts",
        "--prerender",
        "/",
        "--prerender=/about",
        "--origin",
        "https://example.test",
      ],
      "/work/app",
    );

    expect(options.clientEntry).toBe("src/client.ts");
    expect(options.prerenderPaths).toEqual(["/", "/about"]);
    expect(options.origin).toBe("https://example.test");
    expect(
      parseCliArgs(["dev", "--client-entry", "src/client.ts"], "/work/app").clientEntry,
    ).toBe("src/client.ts");
    expect(() =>
      parseCliArgs(["start", "--client-entry", "src/client.ts"], "/work/app"),
    ).toThrow("only supported by inst build and inst dev");
    expect(() =>
      parseCliArgs(["dev", "--origin", "https://example.test"], "/work/app"),
    ).toThrow("only supported by inst build");
  });

  it("parses a project creation target", () => {
    expect(parseCliArgs(["create", "site"], "/work")).toEqual({
      command: "create",
      root: path.resolve("/work/site"),
      outDir: ".inst",
      hostname: "0.0.0.0",
      port: 3000,
      prerenderPaths: [],
    });
    expect(() => parseCliArgs(["create"])).toThrow("requires a target directory");
    expect(() => parseCliArgs(["create", "site", "extra"], "/work")).toThrow("Unexpected argument");
  });

  it("rejects invalid commands and ports", () => {
    expect(() => parseCliArgs(["ship"])).toThrow("Unknown Inst command");
    expect(() => parseCliArgs(["dev", "--port", "99999"])).toThrow("Invalid port");
  });
});

describe("runCli", () => {
  it("creates a Tailwind pages starter without overwriting existing content", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "inst-create-"));
    const root = path.join(parent, "site");

    try {
      await runCli(["create", root]);

      const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      expect(packageJson.scripts.dev).toContain("inst dev");
      expect(packageJson.scripts.dev).toContain("styles:watch");
      expect(packageJson.devDependencies.tailwindcss).toBeTruthy();
      const cliPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
      expect(packageJson.dependencies["@instjs/runtime"]).toBe(cliPackage.version);
      expect(await readFile(path.join(root, "src/app.ts"), "utf8")).toContain("createApplication");
      expect(await readFile(path.join(root, "src/pages/home.tsx"), "utf8")).toContain('http.get("/")');
      const welcome = await readFile(path.join(root, "src/components/Welcome.tsx"), "utf8");
      expect(welcome).toContain("Your app");
      expect(welcome).toContain("is ready.");
      expect((await readFile(path.join(root, "src/styles.css"), "utf8")).trim()).toBe('@import "tailwindcss";');
      expect(await readFile(path.join(root, "public/logo.svg"), "utf8")).toContain("<svg");
      expect(await readFile(path.join(root, "public/favicon.svg"), "utf8")).toContain("<svg");
      expect(await readFile(path.join(root, "inst.config.ts"), "utf8")).toContain("defineConfig");

      const occupied = path.join(parent, "occupied");
      await mkdir(occupied);
      await writeFile(path.join(occupied, "keep.txt"), "keep", "utf8");
      await expect(runCli(["create", occupied])).rejects.toThrow("non-empty directory");
      expect(await readFile(path.join(occupied, "keep.txt"), "utf8")).toBe("keep");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("builds explicit browser code and prerenders requested HTML paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-cli-"));

    try {
      await writeFile(
        path.join(root, "app.ts"),
        `export default {
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    return new Response(\`<h1>\${pathname}</h1>\`, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
  routes() {
    return [{ path: "/" }, { path: "/about" }];
  },
};
`,
        "utf8",
      );
      await writeFile(
        path.join(root, "client.ts"),
        "document.documentElement.dataset.inst = 'ready';\n",
        "utf8",
      );

      await runCli([
        "build",
        root,
        "--entry",
        "app.ts",
        "--client-entry",
        "client.ts",
        "--out-dir",
        "dist",
        "--prerender",
        "/",
        "--prerender",
        "/about",
      ]);

      expect(await readFile(path.join(root, "dist/static/index.html"), "utf8")).toBe("<h1>/</h1>");
      expect(await readFile(path.join(root, "dist/static/about/index.html"), "utf8")).toBe("<h1>/about</h1>");
      expect(await readFile(path.join(root, "dist/client/app.js"), "utf8")).toContain("dataset.inst");
      const routeManifest = JSON.parse(await readFile(path.join(root, "dist/routes-manifest.json"), "utf8"));
      expect(routeManifest.routes).toEqual([{ path: "/" }, { path: "/about" }]);

      await runCli(["build", root, "--entry", "app.ts", "--out-dir", "dist"]);

      await expect(readFile(path.join(root, "dist/client/app.js"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(root, "dist/client-manifest.json"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(root, "dist/assets-manifest.json"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(root, "dist/static/index.html"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(root, "dist/static-manifest.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("verifies optional browser and static artifacts before production start", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-cli-integrity-"));

    try {
      await writeFile(
        path.join(root, "app.ts"),
        `export default {
  fetch() {
    return new Response("<h1>ready</h1>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
  routes() {
    return [{ path: "/" }];
  },
};\n`,
        "utf8",
      );
      await writeFile(path.join(root, "client.ts"), "console.log('ready');\n", "utf8");

      const buildArgs = [
        "build",
        root,
        "--entry",
        "app.ts",
        "--client-entry",
        "client.ts",
        "--out-dir",
        "dist",
        "--prerender",
        "/",
      ];
      const startArgs = ["start", root, "--out-dir", "dist", "--port", "0"];

      await runCli(buildArgs);
      await writeFile(path.join(root, "dist/client/app.js"), "tampered\n", "utf8");
      await expect(runCli(startArgs)).rejects.toThrow("client output failed integrity verification");

      await runCli(buildArgs);
      await writeFile(path.join(root, "dist/static/index.html"), "tampered\n", "utf8");
      await expect(runCli(startArgs)).rejects.toThrow("static output failed integrity verification");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies project config with command-line options taking precedence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inst-cli-config-"));

    try {
      await writeFile(
        path.join(root, "app.ts"),
        `export default {
  fetch(request) {
    const url = new URL(request.url);
    return new Response(\`\${url.origin}\${url.pathname}\`, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
  routes() {
    return [{ path: "/configured" }, { path: "/cli" }];
  },
};\n`,
        "utf8",
      );
      await writeFile(
        path.join(root, "inst.config.ts"),
        `export default {
  build: {
    entry: "app.ts",
    outDir: "configured",
    prerender: ["/configured"],
    origin: "https://config.test",
  },
};\n`,
        "utf8",
      );

      await runCli(["build", root]);
      expect(await readFile(path.join(root, "configured/static/configured/index.html"), "utf8")).toBe("https://config.test/configured");

      await runCli([
        "build",
        root,
        "--out-dir",
        "override",
        "--prerender",
        "/cli",
        "--origin",
        "https://cli.test",
      ]);
      expect(await readFile(path.join(root, "override/static/cli/index.html"), "utf8")).toBe("https://cli.test/cli");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
