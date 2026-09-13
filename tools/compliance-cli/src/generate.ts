import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDataMap } from "@idenzy/compliance/generators/data-map";
import { generateRopa } from "@idenzy/compliance/generators/ropa";

// Importing the schemas is what populates the classification registry. Both stores, because a
// column outside it escapes the RoPA, the data map, the log allowlist and the DSR field lists at
// once (PROJECT.md 4.13.2) — and ClickHouse is not Drizzle, so nothing here would have found it.
import "@idenzy/analytics/schema/index";
import "@idenzy/persistence/schema/index";

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, "..", "..", "..", "docs", "compliance");

const artifacts = [
  { file: "data-map.md", render: generateDataMap },
  { file: "ropa.md", render: generateRopa },
] as const;

/**
 * Regenerates the compliance artifacts from the schema (PROJECT.md 4.13.2).
 *
 * With --check it verifies the committed copies instead of writing them, which is how
 * CI fails a schema change that did not regenerate them. Same contract as a lockfile.
 */
async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  await mkdir(outputDir, { recursive: true });

  const stale: string[] = [];
  for (const { file, render } of artifacts) {
    const path = join(outputDir, file);
    const generated = render();
    if (checkOnly) {
      const existing = await readFile(path, "utf8").catch(() => "");
      if (existing !== generated) stale.push(file);
      continue;
    }
    await writeFile(path, generated, "utf8");
    process.stdout.write(`wrote docs/compliance/${file}\n`);
  }

  if (stale.length > 0) {
    process.stderr.write(
      `Stale compliance artifacts: ${stale.join(", ")}.\n` +
        "Run `pnpm compliance:generate` and commit the result.\n",
    );
    process.exit(1);
  }
  if (checkOnly) process.stdout.write("compliance artifacts are current\n");
}

await main();
