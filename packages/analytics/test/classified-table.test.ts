import { classificationRegistry } from "@idenzy/compliance/classification/registry";
import {
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";
import { describe, expect, it } from "vitest";
import { authEvents } from "../src/schema/auth-events.js";
import {
  classifiedAnalyticsTable,
  column,
  MissingTtlColumnError,
  RetentionMismatchError,
  UnenforceableRetentionError,
} from "../src/schema/classified-table.js";
import { ANALYTICS_TABLES } from "../src/schema/tables.js";

const base = {
  class: DataClass.Operational,
  purpose: Purpose.SecurityAndAbusePrevention,
  retention: Retention.Days30,
  erasure: Erasure.NotApplicable,
} as const;

function table(
  name: string,
  overrides: Partial<Parameters<typeof classifiedAnalyticsTable>[2]> = {},
) {
  return classifiedAnalyticsTable(
    name,
    {
      project_id: column("UUID", base),
      at: column("DateTime64(3, 'UTC')", base),
    },
    {
      retention: Retention.Days30,
      orderBy: ["project_id", "at"],
      partitionBy: "toYYYYMM(at)",
      ttlColumn: "at",
      ...overrides,
    },
  );
}

describe("declaring an analytics table", () => {
  it("registers into the same registry the generators already read, under its own prefix", () => {
    const registered = classificationRegistry().get("analytics.auth_events");
    expect(registered).toBeDefined();
    expect(Object.keys(registered ?? {})).toContain("ip");
    // Prefixed so a ClickHouse table cannot collide with a Postgres one of the same name, and so
    // a reader of the data map can tell which store an answer came from.
    expect(classificationRegistry().get("auth_events")).toBeUndefined();
  });

  it("creates a partitioned table that ages out by dropping parts", () => {
    const ddl = table("probe_parts").createTable("idenzy");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS idenzy.probe_parts");
    expect(ddl).toContain("PARTITION BY toYYYYMM(at)");
    expect(ddl).toContain("TTL toDateTime(at) + INTERVAL 30 DAY");
    // Without this ClickHouse rewrites parts to remove expired rows, which is a mutation over the
    // whole table on a schedule rather than a drop.
    expect(ddl).toContain("ttl_only_drop_parts = 1");
  });

  it("orders by the tenant first, or the policy's predicate is a full scan", () => {
    expect(table("probe_order").createTable("idenzy")).toContain("ORDER BY (project_id, at)");
    for (const declared of ANALYTICS_TABLES) {
      expect(declared.options.orderBy[0]).toBe("project_id");
    }
  });

  it("writes the row policy that is the second line of ADR-0013", () => {
    const policy = table("probe_policy").createRowPolicy("idenzy", "idenzy_app", "SQL_x");
    expect(policy).toContain(
      "CREATE ROW POLICY IF NOT EXISTS probe_policy_tenant ON idenzy.probe_policy",
    );
    expect(policy).toContain("USING project_id = toUUID(getSetting('SQL_x'))");
    expect(policy).toContain("TO idenzy_app");
  });

  /**
   * The three refusals, all at module load rather than at a request.
   *
   * Each of them is a way to end up with a data map that says something the engine does not do,
   * which is worse than a missing one: it is the document a customer is shown.
   */
  it("refuses a column whose lifetime differs from the row that holds it", () => {
    expect(() =>
      classifiedAnalyticsTable(
        "probe_mismatch",
        {
          project_id: column("UUID", base),
          at: column("DateTime64(3, 'UTC')", { ...base, retention: Retention.Years6 }),
        },
        {
          retention: Retention.Days30,
          orderBy: ["project_id", "at"],
          partitionBy: "toYYYYMM(at)",
          ttlColumn: "at",
        },
      ),
    ).toThrow(RetentionMismatchError);
  });

  it("refuses a retention it has no interval for", () => {
    expect(() =>
      classifiedAnalyticsTable(
        "probe_unenforceable",
        { project_id: column("UUID", { ...base, retention: Retention.ProjectLifetime }) },
        {
          retention: Retention.ProjectLifetime,
          orderBy: ["project_id"],
          partitionBy: "tuple()",
          ttlColumn: "project_id",
        },
      ),
    ).toThrow(UnenforceableRetentionError);
  });

  it("refuses a table that measures its TTL from a column it does not have", () => {
    expect(() => table("probe_no_ttl_column", { ttlColumn: "happened_at" })).toThrow(
      MissingTtlColumnError,
    );
  });
});

describe("the declared tables", () => {
  it("classifies the fields that are actually personal as personal", () => {
    const columns = authEvents.columns;
    expect(columns["ip"]?.classification.class).toBe(DataClass.Pii);
    expect(columns["user_agent"]?.classification.class).toBe(DataClass.Pii);
    expect(columns["user_id"]?.classification.class).toBe(DataClass.Pseudonymous);
  });

  /* An erasure cannot null a column here and leave the row: a row keyed on a user, with the user
     removed, is not anonymous — the timing alone re-identifies. */
  it("says an erasure removes the row rather than nulling a field", () => {
    for (const name of ["ip", "user_agent", "user_id"]) {
      expect(authEvents.columns[name]?.classification.erasure).toBe(Erasure.RowDeleted);
    }
  });

  it("carries a project_id on every table, because the row policy compares it", () => {
    for (const declared of ANALYTICS_TABLES) {
      expect(declared.columns["project_id"]?.type).toBe("UUID");
    }
  });
});
