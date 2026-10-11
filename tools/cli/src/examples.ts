import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameworkTemplate, ScaffoldPlan } from "./init/framework-template.js";
import { DEFAULT_API_URL, PLACEHOLDER_KEY } from "./init/init-command.js";
import { TEMPLATES } from "./init/template-registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, "..", "..", "..", "examples");

const CONTEXT = { publishableKey: PLACEHOLDER_KEY, apiUrl: DEFAULT_API_URL } as const;

/**
 * Regenerates `examples/`, which is the same scaffold `idenzy init` writes (PROJECT.md 3.3).
 *
 * One implementation rather than two. A starter template maintained beside the CLI is a
 * starter template that drifts from it, and the version a customer reads first is the one in
 * the repository. With `--check` this verifies the committed copies instead of writing them,
 * which is how CI fails a template change that did not regenerate them: the same contract as
 * the compliance artifacts and a lockfile.
 */
async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const stale: string[] = [];

  for (const template of TEMPLATES) {
    const plan = template.plan(CONTEXT);
    const files = [
      ...plan.files,
      { path: ".env.example", contents: envExample(plan) },
      { path: "README.md", contents: readme(template, plan) },
    ];
    for (const file of files) {
      const path = join(outputDir, template.id, file.path);
      if (checkOnly) {
        const existing = await readFile(path, "utf8").catch(() => "");
        if (existing !== file.contents) stale.push(`${template.id}/${file.path}`);
        continue;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.contents, "utf8");
    }
    if (!checkOnly) process.stdout.write(`wrote examples/${template.id}\n`);
  }

  if (stale.length > 0) {
    process.stderr.write(
      `Stale examples: ${stale.join(", ")}.\n` +
        "Run `pnpm examples:generate` and commit the result.\n",
    );
    process.exitCode = 1;
  }
}

function envExample(plan: ScaffoldPlan): string {
  const lines = plan.env.entries.map((entry) => `# ${entry.comment}\n${entry.key}=${entry.value}`);
  return `# Copy this to ${plan.env.path} and fill in your own project's values.\n${lines.join("\n")}\n`;
}

/**
 * The one file here that is not scaffolded code: what this is, how to get it, and what is
 * left to do afterwards.
 */
function readme(template: FrameworkTemplate, plan: ScaffoldPlan): string {
  const steps = plan.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  return `# Idenzy starter: ${template.title}

Working sign-in, sign-up, one-time code and OAuth routes, written in this framework's own
idiom. Copy them into your application, or have the CLI write them for you:

\`\`\`bash
npx @idenzy/cli init --framework ${template.id}
\`\`\`

Idenzy ships no authentication UI, so none of this is a component of ours: it is ordinary
application code that calls the SDK. It is yours the moment you copy it. Restyle it, rename
the routes, delete what you do not use, and there is nothing here to keep in step with our
releases.

Every message a user reads comes from \`auth-errors\`, which maps our stable error codes to
your copy. The codes are the API; the sentences are yours.

## Getting there

${steps}

Environment variables are listed in \`.env.example\`. Copy it to \`${plan.env.path}\`.

---

Generated from the \`${template.id}\` template in \`@idenzy/cli\`. Change the template, then run
\`pnpm examples:generate\`; CI fails if these files and that template disagree.
`;
}

await main();
