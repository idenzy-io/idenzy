import { InternalError } from "@idenzy/core/errors/errors";
import type { TemplateValue, TemplateVariables } from "./template.js";

/**
 * The whole template language: `{{ name }}` and `{{ name.path }}`, nothing else
 * (PROJECT.md 11.3).
 *
 * No conditionals, no loops, no helpers, no expressions. A template is customer-authored
 * content rendered server-side with our data in scope, so anything that can evaluate is
 * a sandbox escape waiting to be found. Substitution is the entire feature, and the
 * absence of everything else is the security property.
 */
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*\}\}/g;

/**
 * Variables that must be an absolute http or https URL.
 *
 * Named rather than sniffed, because these are the values that land in an `href`, and
 * escaping does not help there: a correctly quoted attribute whose whole value is a
 * script URL is still a script. Every other value is escaped and therefore inert.
 */
const URL_VARIABLE = /(?:^|\.)(?:link|[a-z0-9_]*_url)$/;

/**
 * Refused in any variable, URL-typed or not, before escaping is considered.
 *
 * Tested against the value with the characters a browser ignores while resolving a URL
 * removed first, since `java\tscript:` and `  javascript :` are both live script URLs
 * and a plain prefix test recognises neither.
 */
const DANGEROUS_SCHEME = /^(?:javascript|data|vbscript):/i;

/** A code-point filter, not a regex: a regex may not hold control characters. */
function stripIgnoredByUrlParsers(value: string): string {
  let kept = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 0x20 && code !== 0x7f) kept += character;
  }
  return kept;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * Substitutes variables into one template body.
 *
 * Fails closed on a name that is not in scope. A missing variable rendered as an empty
 * string would send a sign-in mail with no code in it, so a template typo would be found
 * by a user who cannot log in rather than by us.
 */
export function bind(source: string, variables: TemplateVariables, mode: "html" | "text"): string {
  return source.replace(PLACEHOLDER, (_match, path: string) => {
    const value = resolve(variables, path);
    return mode === "html" ? escapeHtml(value) : value;
  });
}

/** Every placeholder a body references, for checking a template before it is stored. */
export function referencedVariables(source: string): readonly string[] {
  return [...source.matchAll(PLACEHOLDER)].map(([, path]) => path ?? "");
}

function resolve(variables: TemplateVariables, path: string): string {
  let current: TemplateValue | TemplateVariables | undefined = variables;
  for (const segment of path.split(".")) {
    // hasOwn, not a bare index read: `{{ constructor }}` satisfies the placeholder
    // grammar, and walking the prototype chain would hand a template the Function
    // constructor and its source.
    if (typeof current !== "object" || !Object.hasOwn(current, segment)) {
      current = undefined;
      break;
    }
    current = current[segment];
  }
  if (typeof current !== "string" && typeof current !== "number") {
    throw new InternalError({
      detail: { reason: "template referenced a variable that is not in scope", path },
    });
  }
  const value = String(current);
  assertSafeValue(path, value);
  return value;
}

function assertSafeValue(path: string, value: string): void {
  if (DANGEROUS_SCHEME.test(stripIgnoredByUrlParsers(value))) {
    throw new InternalError({
      detail: { reason: "template variable carries an executable URI scheme", path },
    });
  }
  if (!URL_VARIABLE.test(path)) return;

  const parsed = URL.parse(value);
  if (parsed === null || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new InternalError({
      detail: { reason: "a link variable must be an absolute http or https URL", path },
    });
  }
}
