import { join } from "node:path";
import { isPublishableKey, isSecretKey } from "@idenzy/protocol/schemas/common";
import type { FileSystem } from "../file-system.js";
import { parseManifest } from "../project-manifest.js";
import type { FrameworkTemplate } from "./framework-template.js";
import { ScaffoldWriter } from "./scaffold-writer.js";
import { resolveTemplate, TEMPLATES, templateById } from "./template-registry.js";

/** What the shared API host answers on until a customer points their own domain at us. */
export const DEFAULT_API_URL = "https://auth.idenzy.io";

/**
 * What the CLI writes for a key it does not have.
 *
 * Carries the real `pk_` prefix and an obviously fake body, so it teaches the right shape to the
 * one reader guaranteed to copy it while staying something a developer notices. It used to name
 * a region cell in the middle — `pk_us1_replace_me` — because a key was `pk_<cell>_<body>`; with
 * one deployment a key is its kind and its body and there is no cell to stand in for.
 */
export const PLACEHOLDER_KEY = "pk_replace_me";

export interface InitOptions {
  readonly dir: string;
  readonly framework?: string;
  readonly publishableKey?: string;
  readonly apiUrl?: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

export interface CommandResult {
  readonly code: number;
  readonly lines: readonly string[];
}

/**
 * `idenzy init`: detect the framework, scaffold working auth routes into the repository, and
 * write the environment variables they read (PROJECT.md 13).
 *
 * What it leaves behind is the customer's code and not a dependency. There is nothing here to
 * keep in step with our releases and nothing of ours in their render tree, which is what makes
 * a headless product integrate in minutes instead of an afternoon (ADR-0002).
 */
export class InitCommand {
  private readonly writer: ScaffoldWriter;

  constructor(private readonly files: FileSystem) {
    this.writer = new ScaffoldWriter(files);
  }

  async run(options: InitOptions): Promise<CommandResult> {
    const key = keyFrom(options.publishableKey);
    if (key === null) {
      return {
        code: 1,
        lines: [
          "That is not a publishable key. A publishable key starts with pk_ and is meant to sit in a browser bundle.",
          "A secret key starts with sk_ and must never leave a server, so this refuses it on the prefix rather than after using it.",
        ],
      };
    }

    const template = await this.templateFor(options);
    if (template === null) {
      return { code: 1, lines: notDetected(options.framework) };
    }

    const plan = template.plan({
      publishableKey: key,
      apiUrl: options.apiUrl ?? DEFAULT_API_URL,
    });
    const report = await this.writer.apply(plan, {
      dir: options.dir,
      ...(options.force === undefined ? {} : { force: options.force }),
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    });

    const lines = [
      options.dryRun === true
        ? `${template.title} detected. Nothing was written (--dry-run).`
        : `${template.title} detected.`,
      ...report.written.map((path) => `  created  ${path}`),
      ...report.skipped.map((path) => `  kept     ${path} (already there; --force overwrites)`),
      ...report.env.map((entry) => `  set      ${plan.env.path} ${entry}`),
      "",
      ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
    ];
    if (key === PLACEHOLDER_KEY) {
      lines.push(
        "",
        `Your publishable key is a placeholder. Put the real one in ${plan.env.path} before this signs anybody in.`,
      );
    }
    return { code: 0, lines };
  }

  private async templateFor(options: InitOptions): Promise<FrameworkTemplate | null> {
    if (options.framework !== undefined) return templateById(options.framework);
    const manifest = parseManifest(await this.files.read(join(options.dir, "package.json")));
    return resolveTemplate(manifest);
  }
}

/**
 * The key, or null where it is one we will not write.
 *
 * Refused on the prefix, before anything is written, for the same reason the browser-facing
 * header refuses one: a secret key scaffolded into a client bundle is published the moment it
 * builds, and nothing after that point can unpublish it.
 */
function keyFrom(given: string | undefined): string | null {
  if (given === undefined) return PLACEHOLDER_KEY;
  if (isSecretKey(given) || !isPublishableKey(given)) return null;
  return given;
}

function notDetected(named: string | undefined): readonly string[] {
  const known = TEMPLATES.map((template) => template.id).join(", ");
  return named === undefined
    ? ["No supported framework found in package.json.", `Name one with --framework: ${known}.`]
    : [`There is no template called "${named}".`, `Try one of: ${known}.`];
}
