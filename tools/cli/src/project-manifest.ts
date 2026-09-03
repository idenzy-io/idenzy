/**
 * What the CLI knows about the repository it was pointed at: the names it depends on.
 *
 * Versions are deliberately not read. A framework is detected by being there at all, and a
 * range check would turn "we have not tested that major yet" into "we refuse to scaffold",
 * which is a worse answer than scaffolding code the developer can read.
 */
export interface ProjectManifest {
  readonly dependencies: ReadonlySet<string>;
}

export const EMPTY_MANIFEST: ProjectManifest = { dependencies: new Set() };

/**
 * Reads dependencies and devDependencies out of a `package.json`.
 *
 * Unreadable or unparseable is the same answer as absent: no names. A CLI that threw here
 * would fail on a repository whose `package.json` has a trailing comma, which is a thing a
 * developer fixes in the editor they are already in.
 */
export function parseManifest(contents: string | null): ProjectManifest {
  if (contents === null) return EMPTY_MANIFEST;
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return EMPTY_MANIFEST;
  }
  if (typeof parsed !== "object" || parsed === null) return EMPTY_MANIFEST;

  const record = parsed as Record<string, unknown>;
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"]) {
    const section = record[field];
    if (typeof section !== "object" || section === null) continue;
    for (const name of Object.keys(section)) names.add(name);
  }
  return { dependencies: names };
}
