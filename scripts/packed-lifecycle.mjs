import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "./process.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pageText = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

async function server(cli, cwd, mode, verify) {
  const child = spawn(process.execPath, [cli, mode, "--host", "127.0.0.1", "--port", "0"], {
    cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: mode === "dev" ? "development" : "production" },
  });
  let output = "";
  let spawnError;
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.on("error", (error) => { spawnError = error; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  try {
    const deadline = Date.now() + 20_000;
    let url;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      const match = output.match(/Inst (?:dev server|listening) on (https?:\/\/\S+)/);
      if (match) { url = new URL(match[1]); break; }
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(output);
      await delay(30);
    }
    assert.ok(url, `Packed ${mode} server did not start\n${output}`);
    const request = (pathname, options = {}) => fetch(new URL(pathname, url), { ...options, signal: AbortSignal.timeout(5_000) });
    await verify(request);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    let timeout;
    const result = await Promise.race([
      exited,
      new Promise((resolve) => { timeout = setTimeout(() => resolve(null), 5_000); }),
    ]);
    clearTimeout(timeout);
    if (!result) { child.kill("SIGKILL"); await exited; throw new Error(`Packed ${mode} shutdown timed out\n${output}`); }
    if (process.platform !== "win32") assert.equal(result.code, 0, `Packed ${mode} did not shut down cleanly\n${output}`);
  }
}

async function checkPages(request, browser = false, development = false) {
  const home = await request("/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /^text\/html/);
  const html = await home.text();
  assert.match(pageText(html), /Your app is ready\./);
  assert.match(html, /Inst\.js is running\./);
  assert.match(html, /src\/pages\/home\.tsx/);
  assert.match(html, /<title>Inst\.js<\/title>/);
  assert.match(html, /<img[^>]+src="\/logo\.svg"[^>]+alt="Inst\.js"/);
  assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /href="\/styles\.css"/);
  if (development) {
    assert.match(html, /<script data-inst-dev-overlay>/i);
  } else {
    assert.doesNotMatch(html, /data-inst-dev-overlay/i);
  }
  if (!browser) {
    const applicationHtml = html.replace(/<script data-inst-dev-overlay>[\s\S]*?<\/script>/i, "");
    assert.doesNotMatch(applicationHtml, /<script\b/i);
  }

  for (const assetPath of ["/logo.svg", "/favicon.svg"]) {
    const asset = await request(assetPath);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /^image\/svg\+xml/);
    assert.match(await asset.text(), /^<svg\b/);
    const assetHead = await request(assetPath, { method: "HEAD" });
    assert.equal(assetHead.status, 200);
    assert.equal(await assetHead.text(), "");
  }

  if (!development) {
    const styles = await request("/styles.css");
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get("content-type"), /^text\/css/);
    assert.match(await styles.text(), /\.min-h-screen/);
  }

  const head = await request("/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await request("/.inst/server/app.mjs")).status, 404);
  if (!browser) assert.equal((await request("/.inst/client/app.js")).status, 404);
}

async function snapshot(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    result[entry.name] = entry.isDirectory() ? await snapshot(target) : (await readFile(target)).toString("base64");
  }
  return result;
}

export async function verifyPackedLifecycle(consumerRoot, dependencies, overrides) {
  const appRoot = path.join(consumerRoot, "new app");
  run("pnpm", ["exec", "inst", "create", appRoot], consumerRoot);
  const manifestPath = path.join(appRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith("@instjs/")) {
        assert.ok(dependencies[name], `Unknown generated package ${name}`);
        manifest[field][name] = dependencies[name];
      }
    }
  }
  manifest.pnpm = { overrides };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  run("pnpm", ["install", "--ignore-workspace", "--frozen-lockfile=false"], appRoot);
  run("pnpm", ["run", "typecheck"], appRoot);
  const cliManifest = JSON.parse(await readFile(path.join(appRoot, "node_modules/@instjs/cli/package.json"), "utf8"));
  const cli = path.join(appRoot, "node_modules/@instjs/cli", cliManifest.bin.inst);
  await server(cli, appRoot, "dev", (request) => checkPages(request, false, true));
  run("pnpm", ["run", "build"], appRoot);
  const first = await snapshot(path.join(appRoot, ".inst"));
  run("pnpm", ["run", "build"], appRoot);
  assert.deepEqual(await snapshot(path.join(appRoot, ".inst")), first, "Packed production build is not deterministic");
  const prerendered = await readFile(path.join(appRoot, ".inst/static/index.html"), "utf8");
  assert.match(pageText(prerendered), /Your app is ready\./);
  assert.match(prerendered, /href="\/favicon\.svg"/);
  await server(cli, appRoot, "start", (request) => checkPages(request));

  await writeFile(path.join(appRoot, "src/client.ts"), 'document.documentElement.dataset.inst = "packed-browser";\n');
  await writeFile(path.join(appRoot, "inst.config.ts"), 'export default { build: { entry: "src/app.ts", clientEntry: "src/client.ts", prerender: ["/"] } };\n');
  await server(cli, appRoot, "dev", async (request) => {
    await checkPages(request, true, true);
    assert.match(await (await request("/.inst/client/app.js")).text(), /packed-browser/);
    await writeFile(path.join(appRoot, "src/style.css"), 'body { color: rebeccapurple; }\n');
    await writeFile(path.join(appRoot, "src/client.ts"), 'import "./style.css"; document.documentElement.dataset.inst = "rebuilt-browser";\n');
    let css = "";
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const response = await request("/.inst/client/app.css");
      css = await response.text();
      if (response.ok && css.includes("rebeccapurple")) break;
      await delay(50);
    }
    assert.match(css, /rebeccapurple/, "Development server did not map newly emitted CSS");
  });
  run("pnpm", ["run", "build"], appRoot);
  await server(cli, appRoot, "start", async (request) => {
    await checkPages(request, true);
    const asset = await request("/.inst/client/app.js");
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /javascript/);
    assert.equal(asset.headers.get("cache-control"), "no-cache");
    assert.match(await asset.text(), /rebuilt-browser/);
    assert.equal((await request("/.inst/client/app.css")).status, 200);
    const head = await request("/.inst/client/app.js", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });
  console.log("Verified packed create, Tailwind starter, brand assets, install, typecheck, dev, rebuild, deterministic build, SSR, SSG, browser assets, and shutdown");
}
