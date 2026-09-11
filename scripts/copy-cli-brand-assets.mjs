import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "packages", "cli", "dist", "assets");

await mkdir(output, { recursive: true });
await Promise.all([
  copyFile(path.join(root, "logo.svg"), path.join(output, "logo.svg")),
  copyFile(path.join(root, "favicon.svg"), path.join(output, "favicon.svg")),
]);
