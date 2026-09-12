import { Resolver } from "node:dns/promises";
import type { DomainDnsRecord } from "@idenzy/persistence/repository/project-domain-repository";
import { Injectable } from "@nestjs/common";

/**
 * How long a single lookup may take before it is treated as not found.
 *
 * Short on purpose. This runs on a request somebody is waiting on, and a nameserver that
 * is not answering is indistinguishable from a record that is not there — from the
 * reader's point of view both mean "check again in a minute".
 */
const TIMEOUT_MS = 3_000;

/**
 * Resolves the records a custom domain needs, and reports what is actually there.
 *
 * Real DNS, not a simulation: `node:dns` asks a resolver the same way anything else would.
 * The two records are the pair Google Certificate Manager and our load balancer need — one
 * CNAME pointing traffic at the edge, one authorisation CNAME proving the customer
 * controls the name.
 *
 * **A missing record and a broken resolver are the same answer here, and that is
 * deliberate.** Both mean "not verified yet, look again shortly", and a screen that
 * distinguished them would be offering the reader a difference they cannot act on. What it
 * must never do is report `found` for a lookup that failed, which is why every error path
 * lands on `missing`.
 *
 * Nothing is cached. A customer who has just fixed a record will press the button again
 * immediately, and a cached miss would tell them their correct record is still wrong.
 */
@Injectable()
export class DnsVerifier {
  /** Its own resolver so the timeout is ours rather than the platform's default. */
  private readonly resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 1 });

  /**
   * Checks every record and answers with the same list, each marked found or missing.
   *
   * Run together rather than in sequence: they are independent lookups against different
   * names, and a reader waiting on a button should wait for the slower one rather than the
   * sum of both.
   */
  async check(records: readonly DomainDnsRecord[]): Promise<DomainDnsRecord[]> {
    return await Promise.all(records.map((record) => this.checkOne(record)));
  }

  private async checkOne(record: DomainDnsRecord): Promise<DomainDnsRecord> {
    const found = await this.pointsAt(record.name, record.value);
    return { ...record, status: found ? "found" : "missing" };
  }

  /**
   * Whether a name is a CNAME for the expected target.
   *
   * Compared case-insensitively and with the trailing dot removed, because a resolver may
   * answer with the fully qualified form and a customer's console may or may not have
   * written one. Refusing a correct record over a dot is the kind of thing that sends
   * somebody to support convinced our check is broken.
   */
  private async pointsAt(name: string, expected: string): Promise<boolean> {
    try {
      const answers = await this.resolver.resolveCname(name);
      return answers.some((answer) => normalise(answer) === normalise(expected));
    } catch {
      // Every failure is the same answer: NXDOMAIN, no CNAME at that name, a timeout, or a
      // resolver that is down. None of them is evidence the record is there.
      return false;
    }
  }
}

function normalise(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}
