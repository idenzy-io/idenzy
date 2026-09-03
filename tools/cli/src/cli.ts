import type { FileSystem } from "./file-system.js";
import { type CommandResult, InitCommand, type InitOptions } from "./init/init-command.js";
import { TEMPLATES } from "./init/template-registry.js";

const USAGE = `idenzy <command>

Commands:
  init [directory]   Scaffold working auth routes into your repository

Options for init:
  --framework <id>        ${TEMPLATES.map((template) => template.id).join(", ")}
  --publishable-key <pk>  Your project's publishable key
  --api-url <url>         Your auth domain (default: the shared host)
  --force                 Overwrite files that already exist
  --dry-run               Print what would happen and write nothing
  --help                  This

Everything it writes is yours: your markup, your design system, our protocol.
Idenzy ships no authentication UI, so there is no component here to keep in step
with our releases and nothing of ours in your render tree.`;

/**
 * The command surface, as a function of its arguments and a file system.
 *
 * It returns an exit code and the lines to print rather than writing to a stream, so the tests
 * assert on what a developer would see instead of capturing stdout.
 */
export function run(argv: readonly string[], files: FileSystem): Promise<CommandResult> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    return Promise.resolve({ code: command === undefined ? 1 : 0, lines: [USAGE] });
  }
  if (command !== "init") {
    return Promise.resolve({ code: 1, lines: [`Unknown command "${command}".`, "", USAGE] });
  }

  const parsed = parseInit(rest);
  if (parsed === null) {
    return Promise.resolve({ code: 1, lines: ["A flag is missing its value.", "", USAGE] });
  }
  if (parsed.help) return Promise.resolve({ code: 0, lines: [USAGE] });

  return new InitCommand(files).run(parsed.options);
}

interface ParsedInit {
  readonly options: InitOptions;
  readonly help: boolean;
}

/** Flags that take the next argument. Everything else is a switch or the directory. */
const VALUE_FLAGS = new Set(["--framework", "--publishable-key", "--api-url"]);
const SWITCHES = new Set(["--force", "--dry-run", "--help", "-h"]);

/**
 * Hand written, because a CLI that scaffolds auth code is the wrong place to add a dependency
 * for the sake of six flags (PROJECT.md 7.6).
 */
function parseInit(args: readonly string[]): ParsedInit | null {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  let dir = ".";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (VALUE_FLAGS.has(arg)) {
      const value = args[index + 1];
      if (value === undefined) return null;
      values.set(arg, value);
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      dir = arg;
      continue;
    }
    if (!SWITCHES.has(arg)) return null;
    switches.add(arg);
  }

  const framework = values.get("--framework");
  const publishableKey = values.get("--publishable-key");
  const apiUrl = values.get("--api-url");
  return {
    help: switches.has("--help") || switches.has("-h"),
    options: {
      dir,
      force: switches.has("--force"),
      dryRun: switches.has("--dry-run"),
      ...(framework === undefined ? {} : { framework }),
      ...(publishableKey === undefined ? {} : { publishableKey }),
      ...(apiUrl === undefined ? {} : { apiUrl }),
    },
  };
}
