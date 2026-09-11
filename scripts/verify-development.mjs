import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = path.join(root, "examples/basic");
const sourcePath = path.join(exampleRoot, "src/app.ts");
const clientPath = path.join(exampleRoot, "src/client.integration.ts");
const cliPath = path.join(root, "packages/cli/dist/index.js");
const originalSource = await readFile(sourcePath, "utf8");
const initialText = "Your application is running.";
const reloadedText = "Your application reloaded.";
const initialClientText = "inst-client-initial";
const reloadedClientText = "inst-client-reloaded";

if (!originalSource.includes(initialText)) {
  throw new Error("Basic example does not contain the expected development marker");
}

await writeFile(
  clientPath,
  `globalThis.__INST_DEVELOPMENT_TEST__ = "${initialClientText}";\n`,
  "utf8",
);

const child = spawn(
  process.execPath,
  [
    cliPath,
    "dev",
    exampleRoot,
    "--client-entry",
    "src/client.integration.ts",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
  ],
  {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
let serverUrl;
let changedSource = false;

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  const match = stdout.match(/Inst dev server on (https?:\/\/\S+)/);
  if (match?.[1]) serverUrl = match[1];
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rebuildCount = () => stdout.match(/Rebuilt /g)?.length ?? 0;
const rebuildFailureCount = () => stderr.match(/Inst rebuild failed:/g)?.length ?? 0;

async function waitFor(predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    if (child.exitCode !== null) {
      throw new Error(`Development server exited while waiting for ${label}: ${stderr || stdout}`);
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}: ${stderr || stdout}`);
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Development request failed with ${response.status}`);
  return response.text();
}

async function fetchStatus() {
  const response = await fetch(new URL("/.inst/dev-status", serverUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Development status request failed with ${response.status}`);
  return response.json();
}

try {
  await waitFor(() => Boolean(serverUrl), "development server");
  const initialStatus = await fetchStatus();
  if (!initialStatus.ok || initialStatus.revision !== 0) {
    throw new Error(`Development server started with an unexpected status: ${JSON.stringify(initialStatus)}`);
  }

  const initialHtml = await fetchText(serverUrl);
  if (!initialHtml.includes(initialText)) {
    throw new Error("Development server did not render the initial application");
  }
  if (!initialHtml.includes("data-inst-dev-overlay")) {
    throw new Error("Development server did not inject the error overlay client");
  }

  const clientUrl = new URL("/.inst/client/app.js", serverUrl);
  const initialClient = await fetchText(clientUrl);
  if (!initialClient.includes(initialClientText)) {
    throw new Error("Development server did not serve the initial browser graph");
  }

  changedSource = true;
  const serverRebuilds = rebuildCount();
  const validReloadedSource = originalSource.replace(initialText, reloadedText);
  await writeFile(sourcePath, validReloadedSource);
  await waitFor(() => rebuildCount() > serverRebuilds, "server source rebuild");

  const reloadedStatus = await fetchStatus();
  if (!reloadedStatus.ok || reloadedStatus.revision <= initialStatus.revision) {
    throw new Error(`Successful rebuild did not advance the live reload revision: ${JSON.stringify(reloadedStatus)}`);
  }

  const serverDeadline = Date.now() + 10_000;
  let reloaded = false;
  while (Date.now() < serverDeadline) {
    const html = await fetchText(serverUrl);
    if (html.includes(reloadedText)) {
      reloaded = true;
      break;
    }
    await delay(50);
  }
  if (!reloaded) throw new Error("Development server did not serve the rebuilt application");

  const failureCount = rebuildFailureCount();
  const brokenSource = validReloadedSource.replace(
    "await createApplication(",
    "await ceateApplication(",
  );
  await writeFile(sourcePath, brokenSource);
  await waitFor(() => rebuildFailureCount() > failureCount, "failed server rebuild");

  const failedStatus = await fetchStatus();
  if (failedStatus.ok || !failedStatus.error?.message?.includes("ceateApplication")) {
    throw new Error(`Development status did not expose the rebuild error: ${JSON.stringify(failedStatus)}`);
  }
  if (failedStatus.revision !== reloadedStatus.revision) {
    throw new Error("Failed rebuild unexpectedly advanced the live reload revision");
  }
  const staleHtml = await fetchText(serverUrl);
  if (!staleHtml.includes(reloadedText) || !staleHtml.includes("data-inst-dev-overlay")) {
    throw new Error("Development server did not preserve the last working page behind the error overlay");
  }

  const recoveryRebuilds = rebuildCount();
  await writeFile(sourcePath, validReloadedSource);
  await waitFor(() => rebuildCount() > recoveryRebuilds, "rebuild recovery");
  await waitFor(async () => (await fetchStatus()).ok, "healthy development status");
  const recoveredStatus = await fetchStatus();
  if (recoveredStatus.revision <= failedStatus.revision) {
    throw new Error("Recovered rebuild did not advance the live reload revision");
  }

  const clientRebuilds = rebuildCount();
  await writeFile(
    clientPath,
    `globalThis.__INST_DEVELOPMENT_TEST__ = "${reloadedClientText}";\n`,
    "utf8",
  );
  await waitFor(() => rebuildCount() > clientRebuilds, "browser source rebuild");

  const clientStatus = await fetchStatus();
  if (clientStatus.revision <= recoveredStatus.revision) {
    throw new Error("Browser rebuild did not advance the live reload revision");
  }

  const clientDeadline = Date.now() + 10_000;
  let clientReloaded = false;
  while (Date.now() < clientDeadline) {
    const browser = await fetchText(clientUrl);
    if (browser.includes(reloadedClientText)) {
      clientReloaded = true;
      break;
    }
    await delay(50);
  }
  if (!clientReloaded) {
    throw new Error("Development server did not serve the rebuilt browser graph");
  }

  console.log("Verified development server, browser graph invalidation, live reload revision, error overlay, and recovery");
} finally {
  if (changedSource) await writeFile(sourcePath, originalSource);
  await rm(clientPath, { force: true });
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(5_000).then(() => child.kill("SIGKILL")),
    ]);
  }
}
