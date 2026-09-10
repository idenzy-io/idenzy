import { describe, expect, it } from "vitest";
import {
  agentLine,
  countDevices,
  countriesIn,
  countryFlag,
  countryIsExitOnly,
  countryName,
  countryOf,
  countSessionsByStatus,
  describeAgent,
  deviceLabel,
  EMPTY_SESSION_FILTERS,
  endedBy,
  endsAt,
  filterSessions,
  isNetworkConcern,
  liveCount,
  matchesSessionQuery,
  type NetworkIntel,
  networkFlags,
  networkSignal,
  PLATFORM_NAMES,
  platformTone,
  reconcileSessions,
  revokeSessions,
  type SessionRow,
  sessionFilterCount,
  sessionStatus,
  sessionsToCsv,
} from "../../app/utils/sessions";

const NOW = new Date("2026-09-09T12:00:00.000Z");

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "ses_01",
    projectId: "prj_test",
    userId: "usr_01",
    user: {
      id: "usr_01",
      displayName: "Nuray Aksoy",
      email: "nuray@example.com",
      avatarUrl: null,
      deletedAt: null,
    },
    deviceId: "dev_01",
    deviceName: "Work laptop",
    ip: "203.0.113.9",
    network: { country: "DE", vpn: false, proxy: false, tor: false },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36",
    amr: ["pwd", "totp", "mfa"],
    factorVerifiedAt: "2026-09-08T09:00:00.000Z",
    deviceBound: false,
    lastActiveAt: "2026-09-09T11:00:00.000Z",
    idleExpiresAt: "2026-09-23T11:00:00.000Z",
    absoluteExpiresAt: "2026-12-01T09:00:00.000Z",
    revokedAt: null,
    revokeReason: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("endsAt", () => {
  it("is whichever expiry falls first", () => {
    expect(endsAt(session()).cause).toBe("idle");
    expect(endsAt(session({ idleExpiresAt: "2027-01-01T00:00:00.000Z" })).cause).toBe("absolute");
  });
});

describe("sessionStatus", () => {
  it("is active while both expiries are ahead and nothing revoked it", () => {
    expect(sessionStatus(session(), NOW)).toBe("active");
  });

  it("is expired once the idle window has closed, with nothing written to the row", () => {
    const gone = session({
      lastActiveAt: "2026-08-01T00:00:00.000Z",
      idleExpiresAt: "2026-08-15T00:00:00.000Z",
    });
    expect(sessionStatus(gone, NOW)).toBe("expired");
    expect(gone.revokedAt).toBeNull();
  });

  it("is expired once the lifetime cap is behind us", () => {
    const capped = session({
      idleExpiresAt: "2027-01-01T00:00:00.000Z",
      absoluteExpiresAt: "2026-09-01T00:00:00.000Z",
    });
    expect(sessionStatus(capped, NOW)).toBe("expired");
  });

  it("is revoked where something ended it", () => {
    const revoked = session({
      revokedAt: "2026-09-05T00:00:00.000Z",
      revokeReason: "refresh_token_reuse",
    });
    expect(sessionStatus(revoked, NOW)).toBe("revoked");
  });

  /* A sweeper stamping a lapsed session must not move it between tabs: what ended the
     session did not change, only who wrote it down. */
  it("reads a timeout reason as expired however it was written", () => {
    const swept = session({
      lastActiveAt: "2026-08-01T00:00:00.000Z",
      idleExpiresAt: "2026-08-15T00:00:00.000Z",
      revokedAt: "2026-08-15T00:05:00.000Z",
      revokeReason: "idle_timeout",
    });
    expect(sessionStatus(swept, NOW)).toBe("expired");
  });
});

describe("endedBy", () => {
  it("is nothing while the session is live", () => {
    expect(endedBy(session(), NOW)).toBeNull();
  });

  it("is the written reason where there is one", () => {
    expect(
      endedBy(session({ revokedAt: "2026-09-05T00:00:00.000Z", revokeReason: "signed_out" }), NOW),
    ).toBe("signed_out");
  });

  it("names the expiry a lapsed session hit, so the filter finds an unswept row", () => {
    const idle = session({
      lastActiveAt: "2026-08-01T00:00:00.000Z",
      idleExpiresAt: "2026-08-15T00:00:00.000Z",
    });
    expect(endedBy(idle, NOW)).toBe("idle_timeout");

    const capped = session({
      idleExpiresAt: "2027-01-01T00:00:00.000Z",
      absoluteExpiresAt: "2026-09-01T00:00:00.000Z",
    });
    expect(endedBy(capped, NOW)).toBe("absolute_timeout");
  });
});

describe("describeAgent", () => {
  it("reads Edge before the Chrome it also claims", () => {
    const edge = describeAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    );
    expect(edge).toEqual({ browser: "Edge", os: "Windows", form: "desktop" });
  });

  it("reads Android before the Linux it also claims, and Mobile decides the form", () => {
    const phone = describeAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0.0.0 Mobile");
    expect(phone).toEqual({ browser: "Chrome", os: "Android", form: "mobile" });

    const tablet = describeAgent("Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/139.0.0.0");
    expect(tablet.form).toBe("tablet");
  });

  /* A confident wrong answer is worse than a blank on a security screen. */
  it("admits to nothing it cannot read", () => {
    expect(describeAgent("IdenzyKit/1.4.0 (build 812)")).toEqual({
      browser: null,
      os: null,
      form: "unknown",
    });
    expect(describeAgent(null)).toEqual({ browser: null, os: null, form: "unknown" });
    expect(describeAgent("   ")).toEqual({ browser: null, os: null, form: "unknown" });
  });

  it("writes only the halves it has", () => {
    expect(agentLine({ browser: "Chrome", os: "macOS", form: "desktop" })).toBe("Chrome on macOS");
    expect(agentLine({ browser: null, os: "Windows", form: "desktop" })).toBe("Windows");
    expect(agentLine({ browser: null, os: null, form: "unknown" })).toBe("Unrecognised client");
  });
});

describe("deviceLabel", () => {
  it("is the client's own label", () => {
    expect(deviceLabel(session({ deviceName: "Nuray's iPhone" }))).toBe("Nuray's iPhone");
  });

  /* Never derived: the server refuses to guess a name off a user agent and so does this,
     however much the string appears to say. */
  it("is never derived from a user agent", () => {
    const rich = session({
      deviceName: null,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.0 Mobile",
    });
    expect(deviceLabel(rich)).toBe("Unnamed device");
    expect(deviceLabel(session({ deviceName: "   " }))).toBe("Unnamed device");
  });
});

describe("platformTone", () => {
  /* A platform the table can name but nothing tinted would draw in the muted ink of one
     we could not place, which is the wrong answer told quietly. */
  it("covers every platform describeAgent can name", () => {
    for (const name of PLATFORM_NAMES) {
      expect(platformTone(name)).not.toBe("text-ink/40");
    }
  });

  it("gives an unreadable platform no colour at all", () => {
    expect(platformTone(null)).toBe("text-ink/40");
    expect(platformTone("Haiku")).toBe("text-ink/40");
  });

  it("gives Apple's two one colour, since the glyph already tells them apart", () => {
    expect(platformTone("macOS")).toBe(platformTone("iOS"));
    expect(platformTone("Windows")).not.toBe(platformTone("macOS"));
  });
});

describe("networkSignal", () => {
  const intel = (over: Partial<NetworkIntel> = {}): NetworkIntel => ({
    country: "DE",
    vpn: false,
    proxy: false,
    tor: false,
    ...over,
  });

  /* Nothing answered is not a kind of clean, and must never draw as one. */
  it("calls a missing lookup unchecked, not direct", () => {
    expect(networkSignal(null)).toBe("unchecked");
    expect(networkSignal(intel())).toBe("direct");
  });

  it("names the strongest signal", () => {
    expect(networkSignal(intel({ vpn: true }))).toBe("vpn");
    expect(networkSignal(intel({ proxy: true, vpn: true }))).toBe("proxy");
    expect(networkSignal(intel({ tor: true, proxy: true, vpn: true }))).toBe("tor");
  });

  it("keeps every flag for the tooltip, in the same order", () => {
    expect(networkFlags(intel({ tor: true, vpn: true }))).toEqual(["tor", "vpn"]);
    expect(networkFlags(intel())).toEqual([]);
    expect(networkFlags(null)).toEqual([]);
  });

  /* A column that flagged every VPN would be ignored by the end of the first page. */
  it("marks Tor alone as worth a second look", () => {
    expect(isNetworkConcern("tor")).toBe(true);
    expect(isNetworkConcern("vpn")).toBe(false);
    expect(isNetworkConcern("proxy")).toBe(false);
    expect(isNetworkConcern("unchecked")).toBe(false);
  });

  it("says a Tor country places the exit node and nothing else", () => {
    expect(countryIsExitOnly(intel({ tor: true }))).toBe(true);
    expect(countryIsExitOnly(intel({ vpn: true }))).toBe(false);
    expect(countryIsExitOnly(null)).toBe(false);
  });
});

describe("countryName", () => {
  it("writes the country out in English", () => {
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("SE")).toBe("Sweden");
  });

  it("hands back a code it does not know rather than losing it", () => {
    expect(countryName(null)).toBeNull();
    expect(countryName("QQ")).toBe("QQ");
  });
});

describe("countryFlag", () => {
  it("maps a code to its regional-indicator pair", () => {
    expect(countryFlag("JP")).toBe("\u{1F1EF}\u{1F1F5}");
    expect(countryFlag("DE")).toBe("\u{1F1E9}\u{1F1EA}");
    expect(countryFlag("GB")).toBe("\u{1F1EC}\u{1F1E7}");
  });

  /* Anything that is not two capitals would render as stray letter tiles rather than a
     flag, so it draws nothing and the name carries the cell on its own. */
  it("draws nothing for what is not a country code", () => {
    expect(countryFlag(null)).toBeNull();
    expect(countryFlag("de")).toBeNull();
    expect(countryFlag("D")).toBeNull();
    expect(countryFlag("DEU")).toBeNull();
    expect(countryFlag("D1")).toBeNull();
  });

  it("takes what countryOf gives it, which is already upper case", () => {
    const code = countryOf({ country: "jp", vpn: false, proxy: false, tor: false });
    expect(countryFlag(code)).toBe("\u{1F1EF}\u{1F1F5}");
  });
});

describe("countryOf", () => {
  const intel = (country: string | null): NetworkIntel => ({
    country,
    vpn: false,
    proxy: false,
    tor: false,
  });

  it("is the code where the address was placed", () => {
    expect(countryOf(intel("DE"))).toBe("DE");
    expect(countryOf(intel("de"))).toBe("DE");
  });

  /* CLDR renders ZZ as "Unknown Region", which beside a row showing nothing would read as
     a different answer. It is the same answer. */
  it("reads the codes that mean nothing as nothing", () => {
    expect(countryOf(intel("ZZ"))).toBeNull();
    expect(countryOf(intel("XA"))).toBeNull();
    expect(countryOf(intel(null))).toBeNull();
    expect(countryOf(null)).toBeNull();
  });
});

describe("countriesIn", () => {
  it("lists only what the sessions actually show, by name", () => {
    const rows = [
      session({ id: "a", network: { country: "SE", vpn: false, proxy: false, tor: false } }),
      session({ id: "b", network: { country: "DE", vpn: false, proxy: false, tor: false } }),
      session({ id: "c", network: { country: "DE", vpn: false, proxy: false, tor: false } }),
      session({ id: "d", network: null }),
      session({ id: "e", network: { country: null, vpn: false, proxy: false, tor: false } }),
    ];
    expect(countriesIn(rows)).toEqual([
      { code: "DE", name: "Germany" },
      { code: "SE", name: "Sweden" },
    ]);
  });
});

describe("countDevices", () => {
  it("counts a shared device once and an unidentified one on its own", () => {
    const rows = [
      session({ id: "ses_a", deviceId: "dev_1" }),
      session({ id: "ses_b", deviceId: "dev_1" }),
      session({ id: "ses_c", deviceId: null }),
      session({ id: "ses_d", deviceId: null }),
    ];
    expect(countDevices(rows)).toBe(3);
  });
});

describe("matchesSessionQuery", () => {
  it("finds a row by anything an operator was handed", () => {
    const row = session();
    expect(matchesSessionQuery(row, "work lap")).toBe(true);
    expect(matchesSessionQuery(row, "203.0.113")).toBe(true);
    expect(matchesSessionQuery(row, "USR_01")).toBe(true);
    expect(matchesSessionQuery(row, "nuray@example.com")).toBe(true);
    expect(matchesSessionQuery(row, "chrome/140")).toBe(true);
    expect(matchesSessionQuery(row, "dev_01")).toBe(true);
    expect(matchesSessionQuery(row, "")).toBe(true);
    expect(matchesSessionQuery(row, "nothing here")).toBe(false);
  });
});

describe("filterSessions", () => {
  const live = session({ id: "ses_live" });
  const revoked = session({
    id: "ses_revoked",
    revokedAt: "2026-09-05T00:00:00.000Z",
    revokeReason: "refresh_token_reuse",
  });
  const passkey = session({ id: "ses_passkey", amr: ["webauthn"], factorVerifiedAt: null });
  const rows = [live, revoked, passkey];

  it("keeps everything with nothing set", () => {
    expect(filterSessions(rows, EMPTY_SESSION_FILTERS, NOW)).toHaveLength(3);
  });

  it("narrows to a status", () => {
    expect(filterSessions(rows, { ...EMPTY_SESSION_FILTERS, status: "revoked" }, NOW)).toEqual([
      revoked,
    ]);
  });

  it("narrows to what ended a session", () => {
    const found = filterSessions(
      rows,
      { ...EMPTY_SESSION_FILTERS, reasons: ["refresh_token_reuse"] },
      NOW,
    );
    expect(found).toEqual([revoked]);
  });

  it("narrows to a factor proved", () => {
    expect(filterSessions(rows, { ...EMPTY_SESSION_FILTERS, methods: ["webauthn"] }, NOW)).toEqual([
      passkey,
    ]);
    expect(filterSessions(rows, { ...EMPTY_SESSION_FILTERS, factor: "no" }, NOW)).toEqual([
      passkey,
    ]);
  });

  it("narrows to a device form", () => {
    const phone = session({
      id: "ses_phone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.0 Mobile",
    });
    expect(
      filterSessions([...rows, phone], { ...EMPTY_SESSION_FILTERS, forms: ["mobile"] }, NOW),
    ).toEqual([phone]);
  });
});

describe("countSessionsByStatus", () => {
  it("adds up to the total the All tab shows", () => {
    const rows = [
      session({ id: "a" }),
      session({ id: "b", revokedAt: "2026-09-05T00:00:00.000Z", revokeReason: "signed_out" }),
      session({ id: "c", idleExpiresAt: "2026-08-15T00:00:00.000Z" }),
    ];
    expect(countSessionsByStatus(rows, NOW)).toEqual({ all: 3, active: 1, expired: 1, revoked: 1 });
  });
});

describe("sessionFilterCount", () => {
  it("counts only what sits behind the Filter button", () => {
    expect(sessionFilterCount(EMPTY_SESSION_FILTERS)).toBe(0);
    expect(sessionFilterCount({ ...EMPTY_SESSION_FILTERS, status: "revoked", query: "abc" })).toBe(
      0,
    );
    expect(sessionFilterCount({ ...EMPTY_SESSION_FILTERS, bound: "yes", lastActive: "7d" })).toBe(
      2,
    );
  });
});

describe("revokeSessions", () => {
  const live = session({ id: "ses_live" });
  const other = session({ id: "ses_other", userId: "usr_02" });
  const reused = session({
    id: "ses_reused",
    revokedAt: "2026-09-05T00:00:00.000Z",
    revokeReason: "refresh_token_reuse",
  });

  it("ends the named live sessions and names whose they were", () => {
    const result = revokeSessions([live, other, reused], ["ses_live"], "admin_revoked", NOW);
    expect(result.ended).toBe(1);
    expect(result.users).toEqual(["usr_01"]);
    expect(sessionStatus(result.sessions[0] as SessionRow, NOW)).toBe("revoked");
    expect(result.sessions[0]?.revokeReason).toBe("admin_revoked");
  });

  it("leaves the sessions it was not asked about untouched", () => {
    const result = revokeSessions([live, other], ["ses_live"], "admin_revoked", NOW);
    expect(result.sessions[1]).toBe(other);
  });

  /* The reason on the row is what an investigation reads, and a second revocation would
     write "revoked from the dashboard" over the one entry that means an attack. */
  it("never restamps a session that has already ended", () => {
    const result = revokeSessions([reused], ["ses_reused"], "admin_revoked", NOW);
    expect(result.ended).toBe(0);
    expect(result.sessions[0]).toBe(reused);
    expect(result.sessions[0]?.revokeReason).toBe("refresh_token_reuse");
  });
});

describe("liveCount", () => {
  it("counts only what is still live, for one account", () => {
    const rows = [
      session({ id: "a" }),
      session({ id: "b" }),
      session({ id: "c", idleExpiresAt: "2026-08-15T00:00:00.000Z" }),
      session({ id: "d", userId: "usr_02" }),
    ];
    expect(liveCount(rows, "usr_01", NOW)).toBe(2);
    expect(liveCount(rows, "usr_02", NOW)).toBe(1);
  });
});

describe("reconcileSessions", () => {
  const live = session({ id: "ses_live" });
  const gone = session({ id: "ses_gone", idleExpiresAt: "2026-08-15T00:00:00.000Z" });

  it("takes an erased account's sessions with it, ended ones included", () => {
    const kept = reconcileSessions(
      [live, gone],
      [{ id: "usr_01", activeSessions: 0, deletedAt: "2026-09-08T00:00:00.000Z" }],
      NOW,
    );
    expect(kept).toEqual([]);
  });

  it("ends what is live for an account that says it holds none", () => {
    const kept = reconcileSessions(
      [live, gone],
      [{ id: "usr_01", activeSessions: 0, deletedAt: null }],
      NOW,
    );
    expect(kept).toHaveLength(2);
    expect(kept[0]?.revokeReason).toBe("signed_out_everywhere");
    expect(kept[1]).toBe(gone);
  });

  /* Writing a count back after a revocation must not come round again as a second one. */
  it("changes nothing for an account whose count agrees", () => {
    const kept = reconcileSessions(
      [live, gone],
      [{ id: "usr_01", activeSessions: 1, deletedAt: null }],
      NOW,
    );
    expect(kept[0]).toBe(live);
    expect(kept[1]).toBe(gone);
  });

  it("leaves an account it was told nothing about alone", () => {
    const kept = reconcileSessions(
      [live],
      [{ id: "usr_99", activeSessions: 0, deletedAt: null }],
      NOW,
    );
    expect(kept[0]).toBe(live);
  });
});

describe("sessionsToCsv", () => {
  it("writes every column, showing or not, and quotes what needs it", () => {
    const csv = sessionsToCsv([session({ deviceName: 'Nuray, "work"' })], NOW);
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("user_agent");
    expect(header).toContain("ended_by");
    expect(row).toContain('"Nuray, ""work"""');
  });
});
