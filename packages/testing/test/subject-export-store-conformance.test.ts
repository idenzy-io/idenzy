import { SubjectExportStore } from "@idenzy/domain/ports/subject-export-store";
import { InMemorySubjectExportStore } from "@idenzy/providers-storage/in-memory-subject-export-store";
import { describe, expect, it } from "vitest";
import { SubjectExportStoreConformanceSuite } from "../src/subject-export-store-conformance.js";

const suite = new SubjectExportStoreConformanceSuite();

describe("an export store holds the most concentrated data we have", () => {
  it("the in-memory development store passes the suite", async () => {
    const subject = new InMemorySubjectExportStore("development");
    expect(await suite.run({ subject, name: "in-memory" })).toEqual([]);
  });

  /**
   * A process-local copy of somebody's entire record is right on a laptop and indefensible
   * anywhere else: unencrypted, unretained, unaudited — and working perfectly while being all
   * three. Same refusal `LoggingEmailProvider` makes, for a sharper reason.
   */
  it("refuses to exist outside development", () => {
    for (const environment of ["staging", "production"]) {
      expect(() => new InMemorySubjectExportStore(environment)).toThrowError();
    }
  });

  /**
   * The suite has to be able to fail, or it is decoration. This store names objects after the
   * subject — which is what a careless implementation does, because it is the obvious thing — and
   * the suite must catch it rather than the upload succeeding and the leak shipping.
   */
  it("catches a store that names objects after the subject", async () => {
    class LeakyStore extends SubjectExportStore {
      protected override keyFor(bundle: {
        projectId: string;
        requestId: string;
        body: Uint8Array;
      }): string {
        const decoded = JSON.parse(new TextDecoder().decode(bundle.body)) as { email: string };
        return `${bundle.projectId}/${decoded.email}.json`;
      }
      protected override put(key: string): Promise<string> {
        return Promise.resolve(`memory://${key}`);
      }
      protected override link(key: string): Promise<string> {
        return Promise.resolve(`memory://${key}`);
      }
    }

    const failures = await suite.run({ subject: new LeakyStore(), name: "leaky" });
    expect(failures.join(" ")).toContain("leaks the subject's identifier");
  });

  /**
   * And a store that hands out a link with no end. The base sets the TTL precisely so a subclass
   * cannot widen it, so the only way to fail this is to ignore the expiry it was given.
   */
  it("catches a store whose link never expires", async () => {
    class ForeverStore extends SubjectExportStore {
      protected override put(key: string): Promise<string> {
        return Promise.resolve(`memory://${key}`);
      }
      protected override link(key: string): Promise<string> {
        return Promise.resolve(`https://example.test/${key}`);
      }
      override async store(bundle: Parameters<SubjectExportStore["store"]>[0]) {
        const stored = await super.store(bundle);
        // The shape a careless override takes: keep the url, forget the clock.
        return { ...stored, expiresAt: new Date("2099-01-01T00:00:00.000Z") };
      }
    }

    const failures = await suite.run({ subject: new ForeverStore(), name: "forever" });
    expect(failures.join(" ")).toContain("beyond the hour the base allows");
  });
});
