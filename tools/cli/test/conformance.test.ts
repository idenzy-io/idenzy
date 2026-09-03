import { describe, expect, it } from "vitest";
import { TemplateConformanceSuite } from "../src/init/template-conformance.js";
import { resolveTemplate, TEMPLATES } from "../src/init/template-registry.js";
import { parseManifest } from "../src/project-manifest.js";

/**
 * PROJECT.md 7.4. A template is merged when it satisfies the family, not when someone has
 * read it: what a scaffold gets wrong is quiet, and shows up in a customer's repository.
 */
describe.each(TEMPLATES.map((template) => [template.id, template] as const))(
  "%s",
  (name, template) => {
    it("satisfies the framework template contract", () => {
      const failures = new TemplateConformanceSuite().run({ name, subject: template });

      expect(failures).toEqual([]);
    });
  },
);

describe("detection", () => {
  /**
   * The registry's order is the rule, and it is the half a template cannot check for itself:
   * a Next application has React in it and a Nuxt one has Vue, so a general template listed
   * too early would answer for the frameworks built on it.
   */
  it.each(TEMPLATES.map((template) => [template.id, template] as const))(
    "resolves %s from the dependencies that mean it",
    (id, template) => {
      const dependencies = Object.fromEntries(
        template.markers.map((marker) => [marker, "*"] as const),
      );
      const manifest = parseManifest(JSON.stringify({ dependencies }));

      expect(resolveTemplate(manifest)?.id).toBe(id);
    },
  );

  it("answers nothing for a project that uses none of them", () => {
    const manifest = parseManifest(JSON.stringify({ dependencies: { express: "*" } }));

    expect(resolveTemplate(manifest)).toBeNull();
  });

  /** A package.json a developer is mid-edit on is not a reason to fail. */
  it("treats an unreadable package.json as no dependencies at all", () => {
    expect(parseManifest("{ trailing, }").dependencies.size).toBe(0);
    expect(parseManifest(null).dependencies.size).toBe(0);
  });
});
