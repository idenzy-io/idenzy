import type { ProjectManifest } from "../project-manifest.js";

/** A file the scaffold wants to exist, at a path relative to the project root. */
export interface ScaffoldFile {
  readonly path: string;
  readonly contents: string;
}

/** A variable the framework reads at build time, and what it is for. */
export interface EnvEntry {
  readonly key: string;
  readonly value: string;
  readonly comment: string;
}

export interface EnvPlan {
  readonly path: string;
  readonly entries: readonly EnvEntry[];
}

export interface ScaffoldPlan {
  readonly framework: string;
  readonly files: readonly ScaffoldFile[];
  readonly env: EnvPlan;
  /** What the developer does next, printed in order. */
  readonly steps: readonly string[];
}

export interface ScaffoldContext {
  /** The project's publishable key, which is meant to be in a browser bundle. */
  readonly publishableKey: string;
  /** The auth API this project answers on: a custom auth domain, or ours in development. */
  readonly apiUrl: string;
}

/**
 * A framework's scaffold: working sign-in, sign-up, OTP and OAuth routes in its own idiom
 * (PROJECT.md 3.3, 13).
 *
 * What this writes is the customer's code from the moment it lands. They own it, restyle it
 * and never update it, which is the opposite of a component dependency and the whole reason
 * we can promise a five-minute integration without shipping UI (ADR-0002). Nothing generated
 * here imports a component of ours, because there is none to import.
 *
 * The base owns the parts that must not vary: the env file and its two keys, the SDK packages
 * to install, and the shape of the plan. A template supplies the routes and the framework's
 * own next steps.
 */
export abstract class FrameworkTemplate {
  /** What `--framework` accepts, and the directory an example is generated into. */
  abstract readonly id: string;
  abstract readonly title: string;
  /** The packages a customer installs. The browser binding, and the client it is built on. */
  abstract readonly packages: readonly string[];
  /**
   * Dependencies that mean this framework is in use. Every one of them has to be present, and
   * the registry tries the specific before the general: a Next application also has React.
   */
  abstract readonly markers: readonly string[];
  /** Where this framework reads environment variables from. */
  abstract readonly envFile: string;
  /** What makes a variable readable in the browser bundle. Empty where nothing does. */
  abstract readonly envPrefix: string;

  detect(manifest: ProjectManifest): boolean {
    return this.markers.every((marker) => manifest.dependencies.has(marker));
  }

  plan(context: ScaffoldContext): ScaffoldPlan {
    return {
      framework: this.id,
      files: this.routes(context),
      env: { path: this.envFile, entries: this.envEntries(context) },
      steps: [`Install the SDK: npm install ${this.packages.join(" ")}`, ...this.steps()],
    };
  }

  /** The routes and the wiring, which is everything that differs between frameworks. */
  protected abstract routes(context: ScaffoldContext): readonly ScaffoldFile[];

  /** What is left for the developer to do, in their own files. */
  protected abstract steps(): readonly string[];

  /**
   * The publishable key and the API URL, under whatever prefix this framework exposes to a
   * browser.
   *
   * A secret key never appears here and cannot: the browser bundle is a public place, and the
   * key that belongs in it is the one whose prefix says so.
   */
  protected envEntries(context: ScaffoldContext): readonly EnvEntry[] {
    return [
      {
        key: `${this.envPrefix}IDENZY_PUBLISHABLE_KEY`,
        value: context.publishableKey,
        comment: "Safe in a browser bundle. The secret key is not: keep that on a server.",
      },
      {
        key: `${this.envPrefix}IDENZY_API_URL`,
        value: context.apiUrl,
        comment: "Your auth domain. Cookie mode needs one that is same-site with your app.",
      },
    ];
  }
}
