import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

/**
 * `pnpm dev` for the three Node services: compile on change, restart on output.
 *
 * **Node cannot run this repository's source directly**, which is what the dev script used to
 * assume: `node --watch src/main.ts` in all three services, failing on the first import since
 * whenever it was written. Two reasons and both are structural. A `.js` specifier does not resolve
 * to the sibling `.ts`, and NodeNext requires writing `./x.js`, so every first-party import is
 * unresolvable. And strip-only mode refuses a constructor parameter property, which is how every
 * class in the codebase takes its dependencies (PROJECT.md 7.2.2). That also rules out a
 * stripping-based runner such as `tsx`: esbuild declines to emit the `design:paramtypes` metadata
 * Nest's DI reads. The compiler is not optional here, so this runs it.
 *
 * Which leaves the reason this is a script rather than a line in each `package.json`. Two watchers
 * are two child processes, and `tsc --watch & node --watch` in a shell orphans both the moment
 * whatever started it is killed — measured rather than assumed: a stray compiler and a stray service,
 * reparented to init and still holding a port. This kills what it started.
 *
 * It has no build of its own, and must not need one: it imports nothing but `node:` builtins and uses
 * no syntax that needs transforming, so Node runs the file as it is. A launcher that had to be
 * compiled before it could compile anything would be the wrong shape.
 */

const ENTRY = "dist/main.js";
const ROOT_ENV = resolve(import.meta.dirname, "..", "..", "..", ".env");
const TSC = resolve(process.cwd(), "node_modules", "typescript", "bin", "tsc");

if (!existsSync(TSC)) {
  console.error(`[dev] no typescript in ${process.cwd()}. Run pnpm install.`);
  process.exit(1);
}

const children: ChildProcess[] = [];
let stopping = false;

/**
 * Stops both watchers and leaves with a code.
 *
 * Guarded, because every path here can be reached twice: a Ctrl-C that also kills the children, and
 * a child exiting because it was killed.
 */
function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  process.exit(code);
}

function start(args: readonly string[]): ChildProcess {
  const child = spawn(process.execPath, [...args], { stdio: "inherit" });
  children.push(child);
  child.on("exit", (code, signal) => {
    // One watcher stopping means the pair is no longer doing its job, so the other goes too rather
    // than being left compiling for nobody.
    stop(signal === null ? (code ?? 0) : 0);
  });
  child.on("error", (error: Error) => {
    console.error(`[dev] ${error.message}`);
    stop(1);
  });
  return child;
}

// `--preserveWatchOutput` because tsc clears the screen on every rebuild otherwise, and what it
// clears is the log of the service running underneath it.
start([TSC, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"]);

// The entry does not exist yet on a clean checkout, and that is fine: `node --watch` waits for it
// and starts when the first build lands.
start([`--env-file-if-exists=${ROOT_ENV}`, "--watch", ENTRY]);

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
