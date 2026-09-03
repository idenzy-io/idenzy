import { strict as assert } from "node:assert";
import type { FrameworkTemplate, ScaffoldPlan } from "./framework-template.js";

const CONTEXT = {
  publishableKey: "pk_test_conformance",
  apiUrl: "https://auth.example.test",
} as const;

/** What every scaffold has to give a customer, whatever framework they arrived in. */
const WAYS_IN = [
  { name: "a one-time code", markers: ["withEmailOtp", "verifyOtp"] },
  { name: "a password", markers: ["signIn.withPassword"] },
  { name: "registration", markers: ["signUp.withPassword"] },
  { name: "a social provider", markers: ["withOAuth", "completeFromRedirect"] },
] as const;

export interface TemplateConformanceContext {
  readonly subject: FrameworkTemplate;
  readonly name: string;
}

interface Case {
  readonly name: string;
  readonly run: (template: FrameworkTemplate, plan: ScaffoldPlan) => void;
}

const CASES: readonly Case[] = [
  {
    /** Everything is written under the directory the developer named, and once each. */
    name: "writes distinct relative paths inside the project",
    run: (_template, plan) => {
      assert.ok(plan.files.length > 0, "a template that scaffolds nothing is not a template");
      const seen = new Set<string>();
      for (const file of plan.files) {
        assert.ok(!file.path.startsWith("/"), `${file.path} is absolute`);
        assert.ok(!file.path.includes(".."), `${file.path} climbs out of the project`);
        assert.ok(!file.path.includes("\\"), `${file.path} is not a posix path`);
        assert.ok(!seen.has(file.path), `${file.path} is planned twice`);
        seen.add(file.path);
        assert.ok(file.contents.trim().length > 0, `${file.path} is empty`);
        assert.ok(file.contents.endsWith("\n"), `${file.path} has no trailing newline`);
      }
    },
  },
  {
    /**
     * The four ways in that PROJECT.md 3.3 promises a starter template covers. A scaffold
     * missing one is a customer writing that flow from the API reference, which is the
     * afternoon this command exists to remove.
     */
    name: "scaffolds every way in a starter template promises",
    run: (_template, plan) => {
      const source = plan.files.map((file) => file.contents).join("\n");
      for (const way of WAYS_IN) {
        for (const marker of way.markers) {
          assert.ok(source.includes(marker), `nothing scaffolds ${way.name}: no ${marker}`);
        }
      }
    },
  },
  {
    /**
     * ADR-0002. There is no component of ours to import, and a scaffold that reached for one
     * would be the first sign that there is.
     */
    name: "imports only the packages it tells the developer to install",
    run: (template, plan) => {
      const allowed = template.packages;
      for (const file of plan.files) {
        for (const match of file.contents.matchAll(/from "(@idenzy\/[^"]+)"/g)) {
          const specifier = match[1] ?? "";
          const root = allowed.find(
            (name) => specifier === name || specifier.startsWith(`${name}/`),
          );
          assert.ok(
            root !== undefined,
            `${file.path} imports ${specifier}, which is not in the install line`,
          );
        }
        assert.ok(
          !file.contents.includes("@idenzy/ui"),
          `${file.path} imports our component library, which never ships to a customer`,
        );
      }
    },
  },
  {
    /**
     * A publishable key is meant to be in a browser bundle and a secret key is meant never to
     * leave a server. Scaffolding the second into the first publishes it at the next build,
     * and nothing after that unpublishes it.
     */
    name: "keeps a secret key out of everything it writes",
    run: (_template, plan) => {
      for (const file of plan.files) {
        assert.ok(!file.contents.includes("sk_"), `${file.path} mentions a secret key`);
      }
      for (const entry of plan.env.entries) {
        assert.ok(!entry.value.startsWith("sk_"), `${entry.key} carries a secret key`);
      }
    },
  },
  {
    name: "names the publishable key under the framework's public prefix",
    run: (template, plan) => {
      const key = `${template.envPrefix}IDENZY_PUBLISHABLE_KEY`;
      const entry = plan.env.entries.find((candidate) => candidate.key === key);
      assert.ok(entry !== undefined, `the env plan does not set ${key}`);
      assert.equal(entry?.value, CONTEXT.publishableKey);
      assert.ok(plan.env.path.length > 0, "there is nowhere to put the environment variables");
      for (const candidate of plan.env.entries) {
        assert.ok(candidate.comment.length > 0, `${candidate.key} is set with no reason given`);
      }
    },
  },
  {
    /** A scaffold is half the job; the rest is in files this command must not touch. */
    name: "tells the developer what is left to do",
    run: (template, plan) => {
      assert.ok(plan.steps.length > 1, "a template that leaves no instructions leaves a puzzle");
      const first = plan.steps[0] ?? "";
      for (const name of template.packages) {
        assert.ok(first.includes(name), `the install step does not mention ${name}`);
      }
    },
  },
];

/**
 * The suite every framework template must pass before it can be registered
 * (PROJECT.md 3.3, 7.4).
 *
 * It does not test that the scaffolded code runs, which would mean installing a framework per
 * template. It tests what a template gets wrong quietly: a way in that is missing, an import
 * of something the developer was never told to install, a secret key written into a browser
 * bundle, a path that escapes the directory they pointed us at.
 */
export class TemplateConformanceSuite {
  readonly familyName = "FrameworkTemplate";

  run(context: TemplateConformanceContext): readonly string[] {
    const plan = context.subject.plan(CONTEXT);
    const failures: string[] = [];
    for (const testCase of CASES) {
      try {
        testCase.run(context.subject, plan);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${this.familyName}/${context.name}: ${testCase.name}: ${reason}`);
      }
    }
    return failures;
  }
}
