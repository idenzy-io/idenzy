import { ValidationFailedError } from "@idenzy/core/errors";
import { StaffRole } from "@idenzy/protocol/enums/staff";
import type pg from "pg";

export interface StaffRow {
  readonly email: string;
  readonly role: StaffRole;
  readonly active: boolean;
  readonly note: string;
  readonly createdAt: Date;
}

const DOMAIN = /^[a-z0-9._%+-]+@idenzy\.io$/;
const ROLES = new Set<string>(Object.values(StaffRole));

/**
 * Makes and unmakes operators, over the owner connection (ADR-0018).
 *
 * The one writer of `staff`. It runs from `pnpm staff`, never from a service: the app role cannot
 * write the table at all, which is the property this class exists outside of. Every check here is
 * repeated by a constraint, because a person with `psql` is the other way in and the constraints
 * are what hold for them too.
 */
export class StaffAdministration {
  constructor(private readonly owner: pg.Client) {}

  async add(email: string, role: string, note: string): Promise<void> {
    const address = this.address(email);
    await this.owner.query(
      `INSERT INTO staff (email, role, note) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET role = excluded.role, note = excluded.note, active = true, deactivated_at = null`,
      [address, this.role(role), note],
    );
  }

  async setRole(email: string, role: string): Promise<boolean> {
    const result = await this.owner.query(`UPDATE staff SET role = $2 WHERE email = $1`, [
      this.address(email),
      this.role(role),
    ]);
    return result.rowCount === 1;
  }

  /** Takes access away at once: the guard reads `active` on every request. */
  async deactivate(email: string): Promise<boolean> {
    const result = await this.owner.query(
      `UPDATE staff SET active = false, deactivated_at = now() WHERE email = $1 AND active`,
      [this.address(email)],
    );
    return result.rowCount === 1;
  }

  async list(): Promise<readonly StaffRow[]> {
    const result = await this.owner.query<{
      email: string;
      role: string;
      active: boolean;
      note: string;
      created_at: Date;
    }>(`SELECT email, role, active, note, created_at FROM staff ORDER BY email`);
    return result.rows.map((row) => ({
      email: row.email,
      // Safe: constrained to StaffRole's values by `staff_role_ck`.
      role: row.role as StaffRole,
      active: row.active,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  private address(email: string): string {
    const address = email.trim().toLowerCase();
    if (!DOMAIN.test(address)) {
      throw new ValidationFailedError({
        message: "Staff must have an @idenzy.io address.",
        fields: [{ path: "email", code: "invalid" }],
      });
    }
    return address;
  }

  private role(role: string): StaffRole {
    if (!ROLES.has(role)) {
      throw new ValidationFailedError({
        message: `Role must be one of: ${[...ROLES].join(", ")}.`,
        fields: [{ path: "role", code: "invalid" }],
      });
    }
    // Safe: membership in StaffRole's values was checked on the line above.
    return role as StaffRole;
  }
}
