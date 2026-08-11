import { hostname, homedir } from "node:os";
import { join, resolve } from "node:path";

export const CLI_VERSION = "0.7.0";

export interface ServeOptions {
  readonly dataDirectory: string;
  readonly workspaceDirectory: string;
  readonly computerLabel: string;
}

export type CliCommand =
  | { readonly type: "help" }
  | { readonly type: "version" }
  | { readonly type: "serve"; readonly options: ServeOptions };

const requiredValue = (args: readonly string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
};

export function parseCliCommand(argv: readonly string[]): CliCommand {
  const command = argv[0];
  if (command === undefined || command === "--help" || command === "-h") {
    return { type: "help" };
  }
  if (command === "--version" || command === "-v") return { type: "version" };
  if (command !== "serve") throw new Error(`Unknown command: ${command}`);

  const args = argv.slice(1);
  if (args.includes("--help") || args.includes("-h")) return { type: "help" };

  let dataDirectory = join(homedir(), ".honk", "core");
  let computerLabel = hostname();
  let workspaceDirectory: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--data") {
      dataDirectory = requiredValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--label") {
      computerLabel = requiredValue(args, index, argument).trim();
      if (computerLabel.length === 0) throw new Error("--label cannot be empty.");
      index += 1;
      continue;
    }
    if (argument?.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    if (workspaceDirectory !== null) throw new Error("Only one workspace directory is allowed.");
    workspaceDirectory = argument ?? null;
  }

  return {
    type: "serve",
    options: {
      dataDirectory: resolve(dataDirectory),
      workspaceDirectory: resolve(workspaceDirectory ?? process.cwd()),
      computerLabel,
    },
  };
}
