import { describe, expect, it } from "vitest";
import {
  afterRemoval,
  BOUNCE_LIMIT,
  BREAK_EVEN_SENDS,
  COMPLAINT_LIMIT,
  CUSTOM_DOMAIN_MONTHLY,
  type DnsRecord,
  DOMAIN_ISSUE_LABELS,
  fromAddress,
  isReadyToSend,
  mailFromFor,
  monthlyCost,
  normaliseDomain,
  RECORD_KINDS,
  ratePercent,
  recordKindInfo,
  recordProgress,
  reputationTone,
  type SendingDomain,
  SHARED_DOMAIN,
  senderLine,
  sendingFrom,
  useForSending,
  validateDomain,
} from "../../app/utils/sending-domains";

function record(part: Partial<DnsRecord> & Pick<DnsRecord, "id" | "kind">): DnsRecord {
  return {
    host: `${part.id}.acme.com`,
    type: "CNAME",
    value: "value",
    status: "pending",
    ...part,
  };
}

function domainOf(part: Partial<SendingDomain> = {}): SendingDomain {
  return {
    id: "dom_acme",
    domain: "acme.com",
    shared: false,
    status: "verifying",
    inUse: false,
    mailFrom: "bounce.acme.com",
    records: [
      record({ id: "dkim-0", kind: "dkim" }),
      record({ id: "mx", kind: "mail_from_mx", type: "MX" }),
      record({ id: "spf", kind: "spf", type: "TXT" }),
      record({ id: "dmarc", kind: "dmarc", type: "TXT" }),
    ],
    addedAt: "2026-09-01T00:00:00.000Z",
    checkedAt: null,
    ...part,
  };
}

function sharedOf(inUse: boolean): SendingDomain {
  return domainOf({
    id: "dom_shared",
    domain: SHARED_DOMAIN,
    shared: true,
    status: "verified",
    inUse,
    mailFrom: SHARED_DOMAIN,
    records: [],
  });
}

/** Every required record found, which is the shape of a domain that may send. */
function verified(part: Partial<SendingDomain> = {}): SendingDomain {
  const base = domainOf(part);
  return {
    ...base,
    status: "verified",
    records: base.records.map((entry) => ({ ...entry, status: "found" as const })),
  };
}

describe("the record kinds", () => {
  it("requires the three that authenticate and never DMARC", () => {
    const required = RECORD_KINDS.filter((kind) => kind.required).map((kind) => kind.id);
    expect(required).toEqual(["dkim", "mail_from_mx", "spf"]);
    expect(recordKindInfo("dmarc").required).toBe(false);
  });

  it("says why each one exists, because a record with no reason gets skipped", () => {
    for (const kind of RECORD_KINDS) {
      expect(kind.note.length).toBeGreaterThan(0);
      expect(recordKindInfo(kind.id)).toBe(kind);
    }
  });
});

describe("recordProgress", () => {
  it("counts the required records only, so DMARC cannot hold a domain back", () => {
    expect(recordProgress(domainOf())).toEqual({ found: 0, required: 3 });
    const withDkim = domainOf({
      records: [
        record({ id: "dkim-0", kind: "dkim", status: "found" }),
        record({ id: "mx", kind: "mail_from_mx", status: "missing" }),
        record({ id: "spf", kind: "spf", status: "pending" }),
        record({ id: "dmarc", kind: "dmarc", status: "pending" }),
      ],
    });
    expect(recordProgress(withDkim)).toEqual({ found: 1, required: 3 });
  });

  it("reads a domain as ready only once every required record is in", () => {
    expect(isReadyToSend(domainOf())).toBe(false);
    expect(isReadyToSend(verified())).toBe(true);
  });

  it("reads a domain the provider calls verified as unready while a record is missing", () => {
    const claimed = domainOf({
      status: "verified",
      records: [
        record({ id: "dkim-0", kind: "dkim", status: "found" }),
        record({ id: "mx", kind: "mail_from_mx", status: "missing" }),
        record({ id: "spf", kind: "spf", status: "found" }),
      ],
    });
    expect(isReadyToSend(claimed)).toBe(false);
  });

  it("holds the shared domain ready without records, because it is ours", () => {
    expect(isReadyToSend(sharedOf(true))).toBe(true);
    expect(recordProgress(sharedOf(true))).toEqual({ found: 0, required: 0 });
  });
});

describe("naming a domain", () => {
  it("lowercases, trims and drops a trailing dot or a www", () => {
    expect(normaliseDomain("  ACME.com. ")).toBe("acme.com");
    expect(normaliseDomain("www.acme.com")).toBe("acme.com");
  });

  it("refuses anything that is not a hostname", () => {
    for (const value of [
      "",
      "acme",
      "https://acme.com",
      "acme.com/mail",
      "acme.com:25",
      "-a.com",
    ]) {
      expect(validateDomain(value, [])).toBe("domain_invalid");
    }
  });

  it("refuses our own domain, since every project already sends from it", () => {
    expect(validateDomain(SHARED_DOMAIN, [])).toBe("domain_ours");
  });

  it("refuses a mailbox provider, whose DNS is not the customer's to publish", () => {
    expect(validateDomain("gmail.com", [])).toBe("domain_mailbox");
    expect(validateDomain("Outlook.com", [])).toBe("domain_mailbox");
  });

  it("refuses one the project already holds, however it was typed", () => {
    expect(validateDomain(" ACME.com ", ["acme.com"])).toBe("domain_taken");
  });

  it("accepts a domain and a subdomain of one", () => {
    expect(validateDomain("acme.com", [])).toBeNull();
    expect(validateDomain("mail.acme.co.uk", ["acme.com"])).toBeNull();
  });

  it("has a sentence for every issue it can report", () => {
    for (const issue of [
      "domain_invalid",
      "domain_taken",
      "domain_ours",
      "domain_mailbox",
    ] as const) {
      expect(DOMAIN_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });
});

describe("the addresses a domain decides", () => {
  it("sends from one local part and returns bounces to a subdomain", () => {
    expect(fromAddress("acme.com")).toBe("no-reply@acme.com");
    expect(mailFromFor("acme.com")).toBe("bounce.acme.com");
    expect(senderLine("Acme Inc.", "acme.com")).toBe("Acme Inc. <no-reply@acme.com>");
  });
});

describe("useForSending", () => {
  it("moves the From line and leaves exactly one domain holding it", () => {
    const list = [sharedOf(true), verified()];
    const next = useForSending(list, "dom_acme");
    expect(next.filter((domain) => domain.inUse).map((domain) => domain.domain)).toEqual([
      "acme.com",
    ]);
  });

  it("refuses a domain whose records are not all found", () => {
    const list = [sharedOf(true), domainOf()];
    expect(useForSending(list, "dom_acme")).toEqual(list);
    expect(sendingFrom(useForSending(list, "dom_acme"))?.shared).toBe(true);
  });

  it("leaves the list alone when nothing has that id", () => {
    const list = [sharedOf(true), verified()];
    expect(useForSending(list, "dom_missing")).toEqual(list);
  });
});

describe("afterRemoval", () => {
  it("hands the From line back to the shared domain when the sender is removed", () => {
    const list = [sharedOf(false), verified({ inUse: true })];
    const next = afterRemoval(list, "dom_acme");
    expect(next.map((domain) => domain.domain)).toEqual([SHARED_DOMAIN]);
    expect(sendingFrom(next)?.domain).toBe(SHARED_DOMAIN);
  });

  it("leaves the sender alone when some other domain is removed", () => {
    const list = [sharedOf(true), verified({ id: "dom_other", domain: "other.com" })];
    const next = afterRemoval(list, "dom_other");
    expect(sendingFrom(next)?.domain).toBe(SHARED_DOMAIN);
    expect(next).toHaveLength(1);
  });

  it("refuses to remove the shared domain, which is what a project falls back to", () => {
    const list = [sharedOf(true), verified()];
    expect(afterRemoval(list, "dom_shared")).toEqual(list);
  });

  it("never leaves a project with nothing sending", () => {
    const list = [sharedOf(false), verified({ inUse: true })];
    expect(sendingFrom(afterRemoval(list, "dom_acme"))).not.toBeNull();
  });
});

describe("what it costs", () => {
  it("prices a month on either domain", () => {
    expect(monthlyCost(10_000, false)).toBeCloseTo(5, 10);
    expect(monthlyCost(10_000, true)).toBeCloseTo(CUSTOM_DOMAIN_MONTHLY + 4, 10);
  });

  it("puts the break-even where the two lines actually cross", () => {
    expect(BREAK_EVEN_SENDS).toBe(50_000);
    expect(monthlyCost(BREAK_EVEN_SENDS, false)).toBeCloseTo(
      monthlyCost(BREAK_EVEN_SENDS, true),
      10,
    );
  });

  it("is the dearer option below that and the cheaper one above it", () => {
    expect(monthlyCost(10_000, true)).toBeGreaterThan(monthlyCost(10_000, false));
    expect(monthlyCost(500_000, true)).toBeLessThan(monthlyCost(500_000, false));
  });
});

describe("reputation", () => {
  it("warns from half the limit rather than at it", () => {
    expect(reputationTone(0.001, BOUNCE_LIMIT)).toBe("good");
    expect(reputationTone(0.03, BOUNCE_LIMIT)).toBe("watch");
    expect(reputationTone(0.06, BOUNCE_LIMIT)).toBe("over");
    expect(reputationTone(COMPLAINT_LIMIT / 2, COMPLAINT_LIMIT)).toBe("watch");
  });

  it("writes a rate with the digits its size needs", () => {
    expect(ratePercent(0)).toBe("0.00%");
    expect(ratePercent(0.0004)).toBe("0.040%");
    expect(ratePercent(0.052)).toBe("5.20%");
    expect(ratePercent(0.31)).toBe("31.0%");
  });
});
