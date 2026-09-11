import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "packages/cli/dist/index.js");
const projectRoot = await mkdtemp(path.join(os.tmpdir(), "inst-browser-integration-"));
const timeoutMs = 15_000;

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (result.status !== 0) {
    throw new Error(`Inst command failed\n${result.stdout}${result.stderr}`);
  }
}

await writeFile(
  path.join(projectRoot, "app.ts"),
  `export default {
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname !== "/") return new Response("Not Found", { status: 404 });
    return new Response(
      '<!doctype html><h1>Browser boundary</h1><script type="module" src="/.inst/client/app.js"></script>',
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  },
  routes() {
    return [{ path: "/" }];
  },
};
`,
  "utf8",
);
await writeFile(
  path.join(projectRoot, "client.ts"),
  `globalThis.__INST_BROWSER_TEST__ = "ready";\n`,
  "utf8",
);

let child;
let stdout = "";
let stderr = "";

try {
  runCli([
    "build",
    projectRoot,
    "--entry",
    "app.ts",
    "--client-entry",
    "client.ts",
  ]);

  child = spawn(
    process.execPath,
    [cliPath, "start", projectRoot, "--host", "127.0.0.1", "--port", "0"],
    {
      cwd: repositoryRoot,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const startedAt = Date.now();
  let baseUrl;
  while (Date.now() - startedAt < timeoutMs) {
    const match = stdout.match(/Inst listening on (https?:\/\/\S+)/);
    if (match?.[1]) {
      baseUrl = new URL(match[1]);
      break;
    }
    if (child.exitCode !== null) {
      throw new Error(`Inst server exited before listening\n${stdout}${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!baseUrl) throw new Error(`Inst server did not start\n${stdout}${stderr}`);

  const homeResponse = await fetch(new URL("/", baseUrl));
  const home = await homeResponse.text();
  if (!homeResponse.ok || !home.includes('src="/.inst/client/app.js"')) {
    throw new Error("Server-rendered document did not expose the explicit browser entry");
  }

  const assetUrl = new URL("/.inst/client/app.js", baseUrl);
  const assetResponse = await fetch(assetUrl);
  const asset = await assetResponse.text();
  if (!assetResponse.ok || !asset.includes("__INST_BROWSER_TEST__")) {
    throw new Error("Production server did not deliver the verified browser entry");
  }
  if (!assetResponse.headers.get("content-type")?.startsWith("text/javascript")) {
    throw new Error("Browser entry returned an unexpected content type");
  }

  const headResponse = await fetch(assetUrl, { method: "HEAD" });
  if (!headResponse.ok || (await headResponse.text()) !== "") {
    throw new Error("Browser entry HEAD request returned an unexpected response");
  }
  if (!headResponse.headers.get("content-length")) {
    throw new Error("Browser entry HEAD response did not include content length");
  }

  const sourceMapResponse = await fetch(new URL("/.inst/client/app.js.map", baseUrl));
  if (!sourceMapResponse.ok) {
    throw new Error(`Browser source map request failed with HTTP ${sourceMapResponse.status}`);
  }
  const sourceMap = await sourceMapResponse.json();
  if (sourceMap?.version !== 3) {
    throw new Error("Browser source map returned an unexpected payload");
  }

  console.log(`Verified browser build delivery at ${baseUrl.origin}`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  if (child && child.exitCode === null) {
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await rm(projectRoot, { recursive: true, force: true });
}
