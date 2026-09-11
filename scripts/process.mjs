import { spawnSync } from "node:child_process";

export function run(command, args, cwd) {
  let executable = command;
  if (command === "pnpm" && process.env.npm_execpath?.includes("pnpm")) {
    if (/\.[cm]?js$/i.test(process.env.npm_execpath)) {
      executable = process.execPath;
      args = [process.env.npm_execpath, ...args];
    } else {
      executable = process.env.npm_execpath;
    }
  }
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
    env: { ...process.env, CI: "1", npm_config_loglevel: "error" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result.stdout.trim();
}
