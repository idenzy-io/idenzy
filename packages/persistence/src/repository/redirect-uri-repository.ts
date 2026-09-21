import { and, asc, eq } from "drizzle-orm";
import { redirectUris } from "../schema/projects.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/**
 * The exact-match redirect allowlist (PROJECT.md 4.6, 4.7).
 *
 * `isAllowed` compares the whole URI in SQL, and there is deliberately no method that
 * takes a prefix, a pattern or an origin. Because we render no page of our own, this
 * table is the only thing standing between our 302 and an attacker's, and every
 * open-redirect writeup in this class begins with a match that was almost exact.
 *
 * The value is compared as given. Normalizing here would mean the string we checked and
 * the string we redirect to can differ, which is how a check gets bypassed by a trailing
 * slash. Callers register and present the same canonical form.
 */
export class RedirectUriRepository extends BaseRepository<typeof redirectUris> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, redirectUris);
  }

  async isAllowed(kind: string, uri: string): Promise<boolean> {
    const rows = await this.tx
      .select({ id: redirectUris.id })
      .from(redirectUris)
      .where(and(this.tenantScope(), eq(redirectUris.kind, kind), eq(redirectUris.uri, uri)))
      .limit(1);
    return rows.length === 1;
  }

  async register(kind: string, uri: string): Promise<void> {
    await this.guard(() =>
      this.tx
        .insert(redirectUris)
        .values({ projectId: this.context.projectId, kind, uri })
        .onConflictDoNothing(),
    );
  }

  /** Removes one exactly. Matching is exact here as it is at the callback (PROJECT.md 4.6). */
  async remove(kind: string, uri: string): Promise<boolean> {
    const rows = await this.tx
      .delete(redirectUris)
      .where(and(this.tenantScope(), eq(redirectUris.kind, kind), eq(redirectUris.uri, uri)))
      .returning({ id: redirectUris.id });
    return rows.length > 0;
  }

  async list(kind: string): Promise<readonly string[]> {
    const rows = await this.tx
      .select({ uri: redirectUris.uri })
      .from(redirectUris)
      .where(and(this.tenantScope(), eq(redirectUris.kind, kind)))
      // Ordered so "the project's reset page" is the same URI on every request, whatever
      // order the rows were written in.
      .orderBy(asc(redirectUris.uri));
    return rows.map((row) => row.uri);
  }
}
