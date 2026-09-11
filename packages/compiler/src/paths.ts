import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function rejectLinks(target: string, recursive = false): Promise<void> {
  let info;
  try { info = await lstat(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error(`Inst build paths must not contain symbolic links: ${target}`);
  if (recursive && info.isDirectory()) {
    for (const entry of await readdir(target)) await rejectLinks(path.join(target, entry), true);
  }
}

export async function assertSafeBuildDirectory(
  root: string,
  output: string,
  entries: readonly string[] = [],
): Promise<void> {
  if (path.relative(root, output) === "" || !within(root, output)) {
    throw new Error(`Inst build directory must be a child of the project root: ${output}`);
  }
  const segments = path.relative(root, output).split(path.sep);
  if (segments.some((segment) => ["src", ".git", "node_modules"].includes(segment.toLowerCase()))) {
    throw new Error(`Inst build directory overlaps a protected project directory: ${output}`);
  }
  for (const entry of entries) {
    if (within(output, path.resolve(root, entry))) {
      throw new Error(`Inst build directory contains a source entry: ${entry}`);
    }
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    await rejectLinks(current);
  }
  await rejectLinks(output, true);
}
