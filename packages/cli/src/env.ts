import { readFile } from "node:fs/promises";
import path from "node:path";
import type { InstMode } from "@instjs/core";

const keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = trimmed.slice(1, -1);
      return first === '"'
        ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : inner;
    }
  }
  return trimmed;
}

export function parseEnv(content: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) {
      throw new Error(`Invalid environment entry: ${rawLine}`);
    }

    const key = normalized.slice(0, separator).trim();
    if (!keyPattern.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }

    values[key] = parseValue(normalized.slice(separator + 1));
  }

  return values;
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadProjectEnv(
  root: string,
  mode: InstMode,
  target: NodeJS.ProcessEnv = process.env,
): Promise<Readonly<Record<string, string>>> {
  const initialKeys = new Set(Object.keys(target));
  const loaded: Record<string, string> = {};
  const filenames = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];

  for (const filename of filenames) {
    const content = await readOptional(path.join(root, filename));
    if (content === undefined) continue;

    for (const [key, value] of Object.entries(parseEnv(content))) {
      if (initialKeys.has(key)) continue;
      target[key] = value;
      loaded[key] = value;
    }
  }

  return loaded;
}
