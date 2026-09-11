import { describe, expect, it } from "vitest";
import { snapshotRetentionSeconds } from "../../app/utils/lifetimes";
import {
  agesOutAt,
  cacheExample,
  entryKindFor,
  INTEGRATION_TONES,
  integrationStateOf,
  isPublished,
  MATCHED_CLAIM,
  POLL_SECONDS,
  PUBLISHING_REASONS,
  probeCheckExample,
  probeLatencySeconds,
  publishedEntries,
  REVOCATION_KIND_LABELS,
  REVOCATION_KIND_RULES,
  type RevocationEntry,
  remainingShare,
  revocationPath,
  SNAPSHOT_PATH,
  SNAPSHOT_TTL_SECONDS,
  SNAPSHOT_TYP,
  STALE_AFTER_SECONDS,
  secondsLeft,
  snapshotEndpoint,
  snapshotPayload,
} from "../../app/utils/revocation";
import { REVOKE_REASONS, type RevokeReason } from "../../app/utils/sessions";

const TOKEN_SECONDS = 300;
const RETENTION = snapshotRetentionSeconds(TOKEN_SECONDS);
const NOW = new Date("2026-09-09T12:00:00.000Z");

function entry(change: Partial<RevocationEntry> = {}): RevocationEntry {
  return {
    id: "ses_01j9",
    kind: "session",
    revokedAt: NOW.toISOString(),
    reason: "admin_revoked",
    userId: "usr_01j9",
    ...change,
  };
}

const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

describe("entryKindFor", () => {
  it("answers for every reason a session can end with", () => {
    for (const reason of REVOKE_REASONS) {
      expect(() => entryKindFor(reason)).not.toThrow();
    }
  });

  it("writes nothing for a lapse, because there is no live token left to kill", () => {
    expect(entryKindFor("idle_timeout")).toBeNull();
    expect(entryKindFor("absolute_timeout")).toBeNull();
  });

  it("writes a watermark for the reasons that end every session an account holds", () => {
    expect(entryKindFor("signed_out_everywhere")).toBe("user");
    expect(entryKindFor("password_changed")).toBe("user");
    expect(entryKindFor("user_deleted")).toBe("user");
  });

  it("writes one session id for the reasons that end one session", () => {
    expect(entryKindFor("signed_out")).toBe("session");
    expect(entryKindFor("admin_revoked")).toBe("session");
    expect(entryKindFor("refresh_token_reuse")).toBe("session");
  });

  it("lists exactly the reasons that reach the set, and no lapse", () => {
    const publishing = REVOKE_REASONS.filter(
      (reason: RevokeReason) => entryKindFor(reason) !== null,
    );
    expect([...PUBLISHING_REASONS].sort()).toEqual([...publishing].sort());
  });
});

describe("ageing out", () => {
  it("keeps an entry for one access-token lifetime plus the skew and no longer", () => {
    expect(agesOutAt(entry(), TOKEN_SECONDS).toISOString()).toBe(
      new Date(NOW.getTime() + RETENTION * 1000).toISOString(),
    );
  });

  it("measures from the revocation rather than from now, so a replay is free", () => {
    const replayed = entry({ revokedAt: secondsAgo(100) });
    expect(secondsLeft(replayed, NOW, TOKEN_SECONDS)).toBe(RETENTION - 100);
  });

  it("floors at zero rather than going negative once the window has passed", () => {
    const gone = entry({ revokedAt: secondsAgo(RETENTION + 60) });
    expect(secondsLeft(gone, NOW, TOKEN_SECONDS)).toBe(0);
    expect(remainingShare(gone, NOW, TOKEN_SECONDS)).toBe(0);
    expect(isPublished(gone, NOW, TOKEN_SECONDS)).toBe(false);
  });

  it("drains from a full meter to an empty one across the window", () => {
    expect(remainingShare(entry(), NOW, TOKEN_SECONDS)).toBe(1);
    const half = entry({ revokedAt: secondsAgo(RETENTION / 2) });
    expect(remainingShare(half, NOW, TOKEN_SECONDS)).toBeCloseTo(0.5, 5);
  });

  it("grows the window when the access-token lifetime does", () => {
    expect(secondsLeft(entry(), NOW, 3600)).toBeGreaterThan(
      secondsLeft(entry(), NOW, TOKEN_SECONDS),
    );
  });
});

describe("publishedEntries", () => {
  const live = entry({ id: "ses_live", revokedAt: secondsAgo(10) });
  const older = entry({ id: "ses_older", revokedAt: secondsAgo(200) });
  const gone = entry({ id: "ses_gone", revokedAt: secondsAgo(RETENTION + 1) });

  it("drops what has aged out and keeps what has not", () => {
    const kept = publishedEntries([live, older, gone], NOW, TOKEN_SECONDS);
    expect(kept.map((row) => row.id)).toEqual(["ses_live", "ses_older"]);
  });

  it("puts what happened most recently first", () => {
    const kept = publishedEntries([older, live], NOW, TOKEN_SECONDS);
    expect(kept[0]?.id).toBe("ses_live");
  });
});

describe("snapshotPayload", () => {
  const payload = (entries: RevocationEntry[]) =>
    JSON.parse(snapshotPayload(entries, TOKEN_SECONDS));

  it("splits the three shapes into the fields the SDK compares against", () => {
    const body = payload([
      entry({ id: "ses_a" }),
      entry({ id: "usr_b", kind: "user", revokedAt: secondsAgo(30) }),
    ]);
    expect(body.sessions).toEqual(["ses_a"]);
    expect(body.users).toEqual([
      { userId: "usr_b", revokedBefore: Math.floor((NOW.getTime() - 30_000) / 1000) },
    ]);
    expect(body.projectRevokedBefore).toBeNull();
  });

  it("carries the retention, so a client can tell an empty set from a misread window", () => {
    expect(payload([]).retentionSeconds).toBe(RETENTION);
  });

  it("writes watermarks in unix seconds, which is what an iat is compared in", () => {
    const body = payload([entry({ id: "prj_x", kind: "project" })]);
    expect(body.projectRevokedBefore).toBe(Math.floor(NOW.getTime() / 1000));
    expect(Number.isInteger(body.projectRevokedBefore)).toBe(true);
  });

  it("answers an empty set rather than nothing when there is nothing revoked", () => {
    expect(payload([])).toEqual({
      sessions: [],
      users: [],
      projectRevokedBefore: null,
      retentionSeconds: RETENTION,
    });
  });
});

describe("the published facts", () => {
  it("keeps a typ that no access-token verifier would accept", () => {
    expect(SNAPSHOT_TYP).not.toBe("JWT");
    expect(SNAPSHOT_TYP).toBe("idenzy-revocations+jwt");
  });

  it("expires a snapshot sooner than any poller's gap between polls could matter", () => {
    expect(SNAPSHOT_TTL_SECONDS).toBeGreaterThan(POLL_SECONDS);
  });

  it("names every shape and says what each is matched on", () => {
    for (const kind of ["session", "user", "project"] as const) {
      expect(REVOCATION_KIND_LABELS[kind].length).toBeGreaterThan(0);
      expect(REVOCATION_KIND_RULES[kind].length).toBeGreaterThan(0);
    }
  });
});

describe("revocationPath", () => {
  const connected = revocationPath(true);
  const alone = revocationPath(false);

  it("runs from the row being written to the verifier refusing the token", () => {
    expect(connected[0]?.id).toBe("row");
    expect(connected[connected.length - 1]?.id).toBe("verifier");
  });

  it("names each stage once and gives every one a cost and a reason", () => {
    expect(new Set(connected.map((stage) => stage.id)).size).toBe(connected.length);
    for (const stage of connected) {
      expect(stage.cost.length).toBeGreaterThan(0);
      expect(stage.detail.length).toBeGreaterThan(0);
    }
  });

  it("hangs the durable path off the write it stands behind", () => {
    expect(connected.filter((stage) => stage.backstop !== undefined).map((s) => s.id)).toEqual([
      "set",
    ]);
  });

  it("marks the verifier stage conditional, because it is the one we do not perform", () => {
    expect(connected.filter((stage) => stage.conditional === true).map((s) => s.id)).toEqual([
      "verifier",
    ]);
    expect(alone.filter((stage) => stage.conditional === true).map((s) => s.id)).toEqual([
      "verifier",
    ]);
  });

  it("never promises a poll window to a project nothing polls", () => {
    const last = alone[alone.length - 1];
    expect(last?.cost).not.toContain(String(POLL_SECONDS));
    expect(connected[connected.length - 1]?.cost).toContain(String(POLL_SECONDS));
  });
});

describe("integrationStateOf", () => {
  const at = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

  it("tells a read that never happened from one that has stopped", () => {
    expect(integrationStateOf(null, NOW)).toBe("never");
    expect(integrationStateOf(at(STALE_AFTER_SECONDS + 1), NOW)).toBe("stale");
  });

  it("holds a poller inside its own window, missed polls included", () => {
    expect(integrationStateOf(at(0), NOW)).toBe("live");
    expect(integrationStateOf(at(POLL_SECONDS * 3), NOW)).toBe("live");
    expect(integrationStateOf(at(STALE_AFTER_SECONDS), NOW)).toBe("live");
  });

  it("does not mark an unconnected project as a fault, because it is a decision", () => {
    expect(INTEGRATION_TONES.never).toBe("neutral");
    expect(INTEGRATION_TONES.stale).toBe("warning");
  });
});

describe("snapshotEndpoint", () => {
  const inputs = {
    authDomain: null,
    deploymentBase: "",
    regionEndpoint: "https://eu.idenzy.dev",
  };

  it("prefers the project's own auth domain, because that is what it is called on", () => {
    const endpoint = snapshotEndpoint({ ...inputs, authDomain: "auth.acme.example" });
    expect(endpoint.issuerUrl).toBe("https://auth.acme.example");
    expect(endpoint.source).toBe("auth-domain");
  });

  it("falls to the deployment's host and then to the region cell", () => {
    expect(snapshotEndpoint({ ...inputs, deploymentBase: "https://api.local" }).issuerUrl).toBe(
      "https://api.local",
    );
    expect(snapshotEndpoint(inputs).issuerUrl).toBe("https://eu.idenzy.dev");
    expect(snapshotEndpoint(inputs).source).toBe("region");
  });

  it("never leaves a trailing slash on a host a path is appended to", () => {
    const endpoint = snapshotEndpoint({ ...inputs, deploymentBase: "https://api.local/" });
    expect(`${endpoint.issuerUrl}${SNAPSHOT_PATH}`).toBe(`https://api.local${SNAPSHOT_PATH}`);
  });

  it("says which configuration the host came from rather than leaving it implied", () => {
    for (const source of [inputs, { ...inputs, authDomain: "auth.acme.example" }]) {
      expect(snapshotEndpoint(source).note.length).toBeGreaterThan(0);
    }
  });
});

describe("cacheExample", () => {
  const code = cacheExample("https://auth.acme.example", "prj_acme");

  it("is written against the project and the host it is generated for", () => {
    expect(code).toContain('const issuerUrl = "https://auth.acme.example"');
    expect(code).toContain('const projectId = "prj_acme"');
  });

  it("reads the secret key from the environment and never inlines one", () => {
    expect(code).toContain('process.env["IDENZY_SECRET_KEY"]');
    expect(code).not.toContain("sk_");
  });
});

describe("probeCheckExample", () => {
  const code = probeCheckExample("ses_probe_ab12cd34");

  it("checks the probe the screen actually published", () => {
    expect(code).toContain('sessionId: "ses_probe_ab12cd34"');
  });

  it("reads freshness beside the answer, because a stale cache answers false", () => {
    expect(code).toContain("status()");
    expect(code).toContain("stale");
    expect(code).toContain("isRevoked");
  });
});

describe("probeLatencySeconds", () => {
  it("answers nothing for a run no read has landed on", () => {
    expect(
      probeLatencySeconds({
        sessionId: "ses_probe_1",
        startedAt: NOW.toISOString(),
        readAt: null,
        state: "running",
      }),
    ).toBeNull();
  });

  it("measures from the entry being published to the read that carried it", () => {
    expect(
      probeLatencySeconds({
        sessionId: "ses_probe_1",
        startedAt: secondsAgo(6),
        readAt: secondsAgo(2),
        state: "read",
      }),
    ).toBe(4);
  });
});

describe("MATCHED_CLAIM", () => {
  it("names the claim each shape is compared against", () => {
    expect(MATCHED_CLAIM).toEqual({ session: "sid", user: "sub", project: "aud" });
  });
});
