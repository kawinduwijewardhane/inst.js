import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { scaffoldProject, type ScaffoldOptions } from "./scaffold.js";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface CreateAnswers extends Required<ScaffoldOptions> {
  readonly packageManager: PackageManager;
  readonly install: boolean;
  readonly git: boolean;
}

function detectedPackageManager(): PackageManager {
  const agent = process.env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm/")) return "pnpm";
  if (agent.startsWith("yarn/")) return "yarn";
  if (agent.startsWith("bun/")) return "bun";
  return "npm";
}

async function askChoice(
  rl: ReturnType<typeof createInterface>,
  question: string,
  choices: readonly string[],
  defaultIndex = 0,
): Promise<number> {
  process.stdout.write(`\n${question}\n`);
  choices.forEach((choice, index) => {
    process.stdout.write(`  ${index + 1}) ${choice}${index === defaultIndex ? " (default)" : ""}\n`);
  });
  const answer = (await rl.question("> ")).trim();
  if (!answer) return defaultIndex;
  const selected = Number(answer) - 1;
  if (!Number.isInteger(selected) || selected < 0 || selected >= choices.length) {
    process.stdout.write("Please choose one of the listed options.\n");
    return askChoice(rl, question, choices, defaultIndex);
  }
  return selected;
}

async function askYesNo(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const hint = defaultValue ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${hint}) `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  process.stdout.write("Please answer yes or no.\n");
  return askYesNo(rl, question, defaultValue);
}

async function promptAnswers(): Promise<CreateAnswers> {
  const defaultManager = detectedPackageManager();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      language: "typescript",
      tailwind: true,
      packageManager: defaultManager,
      install: false,
      git: false,
    };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const language = (await askChoice(rl, "Which language do you want to use?", ["TypeScript", "JavaScript"])) === 0
      ? "typescript"
      : "javascript";
    const tailwind = await askYesNo(rl, "Use Tailwind CSS?", true);
    const managers: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];
    const managerIndex = await askChoice(
      rl,
      "Which package manager should Inst use?",
      managers,
      Math.max(0, managers.indexOf(defaultManager)),
    );
    const install = await askYesNo(rl, "Install dependencies now?", true);
    const git = await askYesNo(rl, "Initialize a Git repository?", true);

    return { language, tailwind, packageManager: managers[managerIndex]!, install, git };
  } finally {
    rl.close();
  }
}

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, [...args], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

export async function runCreateWizard(args: readonly string[]): Promise<boolean> {
  if (args[0] !== "create") return false;
  const target = args[1];
  if (!target || target.startsWith("-") || args.length > 2) return false;

  const root = path.resolve(process.cwd(), target);
  const answers = await promptAnswers();
  const result = await scaffoldProject(root, {
    language: answers.language,
    tailwind: answers.tailwind,
  });

  console.log(`\nCreated Inst.js project in ${result.root}`);

  if (answers.install) {
    console.log(`\nInstalling dependencies with ${answers.packageManager}...`);
    run(answers.packageManager, ["install"], root);
  }
  if (answers.git) {
    console.log("\nInitializing Git repository...");
    run("git", ["init"], root);
  }

  console.log(`\nNext steps:\n  cd ${path.relative(process.cwd(), root) || "."}\n  ${answers.packageManager} run dev\n`);
  return true;
}
