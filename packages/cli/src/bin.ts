#!/usr/bin/env node

import { runCreateWizard } from "./create.js";
import { runCli } from "./index.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (await runCreateWizard(args)) return;
  await runCli(args);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Inst: ${message}`);
  process.exitCode = 1;
});
