import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeBuildDirectory } from "./paths.js";

const required = ["manifest.json", "routes-manifest.json", "units-manifest.json"];
const optional = ["client-manifest.json", "assets-manifest.json", "static-manifest.json"];
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function writeDeploymentManifest(root: string, output: string): Promise<void> {
  await assertSafeBuildDirectory(root, output);
  const manifests: Record<string, string> = {};
  for (const name of [...required, ...optional]) {
    try { manifests[name] = digest(await readFile(path.join(output, name))); } catch (error) {
      if (optional.includes(name) && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  await writeFile(path.join(output, "deployment-manifest.json"), `${JSON.stringify({ version: 1, kind: "inst-deployment", manifests }, null, 2)}\n`);
}

export async function verifyDeploymentManifest(root: string, output: string): Promise<void> {
  await assertSafeBuildDirectory(root, output);
  let value: unknown;
  try { value = JSON.parse(await readFile(path.join(output, "deployment-manifest.json"), "utf8")); } catch {
    throw new Error("Inst production build is incomplete; run inst build again");
  }
  if (typeof value !== "object" || value === null) throw new Error("Invalid Inst deployment manifest");
  const record = value as { version?: unknown; kind?: unknown; manifests?: unknown };
  if (record.version !== 1 || record.kind !== "inst-deployment" || typeof record.manifests !== "object" || record.manifests === null || Array.isArray(record.manifests)) {
    throw new Error("Invalid Inst deployment manifest");
  }
  const manifests = record.manifests as Record<string, unknown>;
  if (required.some((name) => !Object.hasOwn(manifests, name)) || Object.keys(manifests).some((name) => ![...required, ...optional].includes(name))) {
    throw new Error("Invalid Inst deployment manifest inventory");
  }
  for (const name of [...required, ...optional]) {
    let content;
    try { content = await readFile(path.join(output, name)); } catch (error) {
      if (!Object.hasOwn(manifests, name) && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Inst deployment manifest is missing ${name}`);
    }
    if (typeof manifests[name] !== "string" || manifests[name] !== digest(content)) {
      throw new Error(`Inst deployment manifest failed integrity verification: ${name}`);
    }
  }
}
