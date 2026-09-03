import type { ProjectManifest } from "../project-manifest.js";
import type { FrameworkTemplate } from "./framework-template.js";
import { NextTemplate } from "./templates/next-template.js";
import { ReactTemplate } from "./templates/react-template.js";
import { VueTemplate } from "./templates/vue-template.js";

/**
 * Every framework `idenzy init` can scaffold, most specific first.
 *
 * The order is the detection rule. A Next application has React in it and a Nuxt application
 * has Vue, so the general templates have to come last or they would answer for the frameworks
 * built on them. Adding a template means adding it here in the right place, which the
 * conformance suite checks by resolving each template's own markers back to it.
 */
export const TEMPLATES: readonly FrameworkTemplate[] = [
  new NextTemplate(),
  new VueTemplate(),
  new ReactTemplate(),
];

/** The template for what this project already depends on, or null where nothing matches. */
export function resolveTemplate(manifest: ProjectManifest): FrameworkTemplate | null {
  return TEMPLATES.find((template) => template.detect(manifest)) ?? null;
}

/** The template a `--framework` flag names. */
export function templateById(id: string): FrameworkTemplate | null {
  return TEMPLATES.find((template) => template.id === id) ?? null;
}
