import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(root, "packages/cli/dist/index.js");
const exampleRoot = path.join(root, "examples/basic");
const timeoutMs = 15_000;

const child = spawn(
  process.execPath,
  [cliPath, "start", exampleRoot, "--host", "127.0.0.1", "--port", "0"],
  {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
let settled = false;

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

function stop() {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
}

const timeout = setTimeout(() => {
  if (settled) return;
  settled = true;
  stop();
  console.error(`Timed out waiting for Inst production server\n${stdout}${stderr}`);
  process.exitCode = 1;
}, timeoutMs);

timeout.unref();

async function waitForUrl() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const match = stdout.match(/Inst listening on (https?:\/\/\S+)/);
    if (match?.[1]) return new URL(match[1]);
    if (child.exitCode !== null) {
      throw new Error(`Inst production server exited before listening\n${stdout}${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Inst production server did not report a listening URL\n${stdout}${stderr}`);
}

try {
  const baseUrl = await waitForUrl();
  const [homeResponse, healthResponse] = await Promise.all([
    fetch(new URL("/", baseUrl)),
    fetch(new URL("/api/health", baseUrl)),
  ]);

  if (!homeResponse.ok) {
    throw new Error(`Home request failed with HTTP ${homeResponse.status}`);
  }
  const html = await homeResponse.text();
  if (!html.includes("<h1>Inst.js</h1>") || !html.includes("Inst.js starter")) {
    throw new Error("Production server did not return the expected server-rendered document");
  }

  if (!healthResponse.ok) {
    throw new Error(`Health request failed with HTTP ${healthResponse.status}`);
  }
  const health = await healthResponse.json();
  if (health?.status !== "ok") {
    throw new Error("Production health endpoint returned an unexpected payload");
  }

  settled = true;
  console.log(`Verified production server at ${baseUrl.origin}`);
} catch (error) {
  settled = true;
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  stop();
}

await new Promise((resolve) => {
  if (child.exitCode !== null) {
    resolve();
    return;
  }
  child.once("exit", resolve);
});
