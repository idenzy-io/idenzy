import { join } from "node:path";
import type { FileSystem } from "../file-system.js";
import type { EnvPlan, ScaffoldPlan } from "./framework-template.js";

export interface WriteOptions {
  readonly dir: string;
  /** Overwrite files that already exist. Off by default, and it should stay off. */
  readonly force?: boolean;
  /** Work out what would happen and write none of it. */
  readonly dryRun?: boolean;
}

export interface WriteReport {
  readonly written: readonly string[];
  readonly skipped: readonly string[];
  readonly env: readonly string[];
}

/**
 * Puts a plan on disk, and never over anything.
 *
 * Scaffolded code becomes the customer's the moment it lands, so the second run of
 * `idenzy init` is the dangerous one: by then they have restyled the sign-in page, and an
 * overwrite is their work gone. Existing files are reported as skipped instead, and `--force`
 * is the explicit way to ask for the other thing.
 */
export class ScaffoldWriter {
  constructor(private readonly files: FileSystem) {}

  async apply(plan: ScaffoldPlan, options: WriteOptions): Promise<WriteReport> {
    const written: string[] = [];
    const skipped: string[] = [];

    for (const file of plan.files) {
      const path = join(options.dir, file.path);
      const existing = await this.files.read(path);
      if (existing !== null && options.force !== true) {
        skipped.push(file.path);
        continue;
      }
      if (options.dryRun !== true) await this.files.write(path, file.contents);
      written.push(file.path);
    }

    return { written, skipped, env: await this.applyEnv(plan.env, options) };
  }

  /**
   * Adds the keys the framework needs, and changes no value that is already there.
   *
   * A second run must not overwrite a real publishable key with the placeholder from a flag,
   * and an environment file is the one file in a repository most likely to hold something the
   * developer cannot get back.
   */
  private async applyEnv(plan: EnvPlan, options: WriteOptions): Promise<readonly string[]> {
    const path = join(options.dir, plan.path);
    const existing = (await this.files.read(path)) ?? "";
    const present = new Set(
      existing
        .split("\n")
        .map((line) => line.slice(0, Math.max(line.indexOf("="), 0)).trim())
        .filter((key) => key.length > 0),
    );

    const missing = plan.entries.filter((entry) => !present.has(entry.key));
    if (missing.length === 0) return [];

    const block = missing.map((entry) => `# ${entry.comment}\n${entry.key}=${entry.value}`);
    const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    if (options.dryRun !== true) {
      await this.files.write(path, `${existing}${separator}${block.join("\n")}\n`);
    }
    return missing.map((entry) => entry.key);
  }
}
