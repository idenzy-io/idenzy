#!/usr/bin/env node

import { run } from "./cli.js";
import { NodeFileSystem } from "./file-system.js";

/** The executable: arguments in, lines out, exit code from the command. */
const result = await run(process.argv.slice(2), new NodeFileSystem());
const stream = result.code === 0 ? process.stdout : process.stderr;
stream.write(`${result.lines.join("\n")}\n`);
process.exitCode = result.code;
