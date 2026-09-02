import { classificationRegistry } from "../classification/registry.js";
import { Erasure } from "../classification/vocabulary.js";

export interface SubjectFieldMap {
  /** Columns a data-subject access or portability request returns, by table. */
  readonly export: ReadonlyMap<string, readonly string[]>;
  /** Columns an erasure request acts on, by table, with the action to take. */
  readonly erase: ReadonlyMap<string, ReadonlyMap<string, Erasure>>;
}

/**
 * What a data-subject request touches, derived from the schema (PROJECT.md 4.13.6).
 *
 * Generated rather than hand-listed, which is what stops the most common GDPR Art.15
 * failure: an export that quietly omits a column somebody added two years ago.
 */
export function generateSubjectFields(): SubjectFieldMap {
  const exportFields = new Map<string, string[]>();
  const eraseFields = new Map<string, Map<string, Erasure>>();

  for (const [table, columns] of classificationRegistry()) {
    for (const [name, c] of Object.entries(columns)) {
      if (c.subjectField === true) {
        const list = exportFields.get(table) ?? [];
        list.push(name);
        exportFields.set(table, list);
      }
      const action = c.erasure;
      if (
        action !== undefined &&
        action !== Erasure.NotApplicable &&
        action !== Erasure.RetainPseudonymous
      ) {
        const map = eraseFields.get(table) ?? new Map<string, Erasure>();
        map.set(name, action);
        eraseFields.set(table, map);
      }
    }
  }

  return { export: exportFields, erase: eraseFields };
}
