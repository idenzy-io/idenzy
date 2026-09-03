import { AuthCodeRepository } from "@idenzy/persistence/repository/auth-code-repository";
import { EmailChangeRepository } from "@idenzy/persistence/repository/email-change-repository";
import { MagicLinkRepository } from "@idenzy/persistence/repository/magic-link-repository";
import { OtpChallengeRepository } from "@idenzy/persistence/repository/otp-challenge-repository";
import { RedirectUriRepository } from "@idenzy/persistence/repository/redirect-uri-repository";
import { SuppressionRepository } from "@idenzy/persistence/repository/suppression-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { VerificationTokenRepository } from "@idenzy/persistence/repository/verification-token-repository";
import {
  WebauthnCeremony,
  WebauthnChallengeRepository,
} from "@idenzy/persistence/repository/webauthn-challenge-repository";
import { WebauthnCredentialRepository } from "@idenzy/persistence/repository/webauthn-credential-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { VerificationPurpose } from "@idenzy/protocol/enums/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresHarness } from "../src/postgres-harness.js";

const harness = new PostgresHarness();
const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";

let uow: UnitOfWork;
let aliceId = "";

interface Repos {
  readonly users: UserRepository;
  readonly otp: OtpChallengeRepository;
  readonly links: MagicLinkRepository;
  readonly codes: AuthCodeRepository;
  readonly tokens: VerificationTokenRepository;
  readonly changes: EmailChangeRepository;
  readonly suppressions: SuppressionRepository;
  readonly redirects: RedirectUriRepository;
  readonly passkeyChallenges: WebauthnChallengeRepository;
  readonly passkeys: WebauthnCredentialRepository;
}

function inTenant<T>(projectId: string, work: (repos: Repos) => Promise<T>): Promise<T> {
  const context = new TenantContext(projectId, "req_test", "user");
  return uow.run(context, (tx) =>
    work({
      users: new UserRepository(tx, context),
      otp: new OtpChallengeRepository(tx, context),
      links: new MagicLinkRepository(tx, context),
      codes: new AuthCodeRepository(tx, context),
      tokens: new VerificationTokenRepository(tx, context),
      changes: new EmailChangeRepository(tx, context),
      suppressions: new SuppressionRepository(tx, context),
      redirects: new RedirectUriRepository(tx, context),
      passkeyChallenges: new WebauthnChallengeRepository(tx, context),
      passkeys: new WebauthnCredentialRepository(tx, context),
    }),
  );
}

const inTen = () => new Date(Date.now() + 600_000);
const ago = () => new Date(Date.now() - 1000);

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES (gen_random_uuid(), 'Acme', (SELECT id FROM region_cells LIMIT 1)) RETURNING id`,
  );
  for (const projectId of [PROJECT_A, PROJECT_B]) {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
       VALUES ($1, $2, 'p', (SELECT id FROM region_cells LIMIT 1), 'k')`,
      [projectId, rows[0]?.id],
    );
  }

  aliceId = await inTenant(PROJECT_A, async ({ users }) => {
    const user = await users.create({
      email: "alice@a.test",
      emailVerified: false,
      phone: null,
      passwordHash: null,
      passwordAlgoVersion: null,
      displayName: null,
      avatarUrl: null,
    });
    return user.id;
  });
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("one-time codes", () => {
  it("counts a wrong guess in the database, so parallel guesses cannot outrun the cap", async () => {
    const id = await inTenant(PROJECT_A, ({ otp }) =>
      otp.create({
        channel: "email",
        targetHash: "t-parallel",
        targetEncrypted: "enc",
        codeHash: "h",
        flowId: "req_1",
        expiresAt: inTen(),
      }),
    );

    // Five guesses at once. A read-modify-write would leave the counter at one.
    const counts = await Promise.all(
      Array.from({ length: 5 }, () => inTenant(PROJECT_A, ({ otp }) => otp.recordAttempt(id))),
    );
    expect([...counts].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("can be consumed exactly once, and the loser of a race is told so", async () => {
    const id = await inTenant(PROJECT_A, ({ otp }) =>
      otp.create({
        channel: "email",
        targetHash: "t-once",
        targetEncrypted: "enc",
        codeHash: "h",
        flowId: "req_2",
        expiresAt: inTen(),
      }),
    );
    const outcomes = await Promise.all([
      inTenant(PROJECT_A, ({ otp }) => otp.consume(id, new Date())),
      inTenant(PROJECT_A, ({ otp }) => otp.consume(id, new Date())),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it("retires earlier challenges for a target, so resending leaves one live code", async () => {
    await inTenant(PROJECT_A, async ({ otp }) => {
      for (const flowId of ["req_a", "req_b"]) {
        await otp.create({
          channel: "email",
          targetHash: "t-resend",
          targetEncrypted: "enc",
          codeHash: "h",
          flowId,
          expiresAt: inTen(),
        });
      }
      expect(await otp.invalidateOutstanding("email", "t-resend", new Date())).toBe(2);
      expect(await otp.invalidateOutstanding("email", "t-resend", new Date())).toBe(0);
    });
  });
});

describe("links and exchange codes", () => {
  it("burns a magic link on first use, however many arrive together", async () => {
    await inTenant(PROJECT_A, ({ links }) =>
      links.issue({
        tokenHash: "link-1",
        targetEncrypted: "enc",
        userId: aliceId,
        redirectUri: "https://app.test/cb",
        expiresAt: inTen(),
      }),
    );
    const row = await inTenant(PROJECT_A, ({ links }) => links.findByHash("link-1"));
    const outcomes = await Promise.all([
      inTenant(PROJECT_A, ({ links }) => links.consume(row?.id ?? "", new Date())),
      inTenant(PROJECT_A, ({ links }) => links.consume(row?.id ?? "", new Date())),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it("pins the redirect target to the token rather than to the click", async () => {
    await inTenant(PROJECT_A, ({ links }) =>
      links.issue({
        tokenHash: "link-2",
        targetEncrypted: "enc",
        userId: aliceId,
        redirectUri: "https://app.test/finish",
        expiresAt: inTen(),
      }),
    );
    const row = await inTenant(PROJECT_A, ({ links }) => links.findByHash("link-2"));
    expect(row?.redirectUri).toBe("https://app.test/finish");
  });

  it("burns an exchange code on first use and keeps the amr it was minted with", async () => {
    await inTenant(PROJECT_A, ({ codes }) =>
      codes.issue({
        userId: aliceId,
        codeHash: "code-1",
        amr: ["link"],
        redirectUri: "https://app.test/cb",
        expiresAt: inTen(),
      }),
    );
    const row = await inTenant(PROJECT_A, ({ codes }) => codes.findByHash("code-1"));
    expect(row?.amr).toEqual(["link"]);
    const outcomes = await Promise.all([
      inTenant(PROJECT_A, ({ codes }) => codes.consume(row?.id ?? "", new Date())),
      inTenant(PROJECT_A, ({ codes }) => codes.consume(row?.id ?? "", new Date())),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });
});

describe("verification tokens", () => {
  /**
   * A reset token that could also verify an address would let anyone who can trigger a
   * reset for an address they do not own have it marked verified.
   */
  it("will not answer for a purpose it was not minted for", async () => {
    await inTenant(PROJECT_A, async ({ tokens }) => {
      await tokens.issue({
        userId: aliceId,
        purpose: VerificationPurpose.PasswordReset,
        tokenHash: "vt-1",
        expiresAt: inTen(),
      });
      expect(await tokens.findByHash(VerificationPurpose.PasswordReset, "vt-1")).not.toBeNull();
      expect(await tokens.findByHash(VerificationPurpose.EmailVerification, "vt-1")).toBeNull();
    });
  });

  it("retires every other outstanding token of that purpose", async () => {
    await inTenant(PROJECT_A, async ({ tokens }) => {
      await tokens.issue({
        userId: aliceId,
        purpose: VerificationPurpose.EmailVerification,
        tokenHash: "vt-old",
        expiresAt: inTen(),
      });
      await tokens.issue({
        userId: aliceId,
        purpose: VerificationPurpose.EmailVerification,
        tokenHash: "vt-new",
        expiresAt: inTen(),
      });
      const retired = await tokens.invalidateOutstanding(
        aliceId,
        VerificationPurpose.EmailVerification,
        new Date(),
      );
      expect(retired).toBe(2);
      const row = await tokens.findByHash(VerificationPurpose.EmailVerification, "vt-old");
      expect(row?.consumedAt).not.toBeNull();
    });
  });
});

describe("email changes", () => {
  it("finds either half of the pair and says which half it was", async () => {
    await inTenant(PROJECT_A, async ({ changes }) => {
      await changes.open({
        userId: aliceId,
        newEmail: "moved@a.test",
        oldTokenHash: "ec-old",
        newTokenHash: "ec-new",
        expiresAt: inTen(),
      });
      expect((await changes.findByToken("ec-old"))?.side).toBe("old");
      expect((await changes.findByToken("ec-new"))?.side).toBe("new");
    });
  });

  it("does not consider one confirmation enough, and applies exactly once", async () => {
    const id = await inTenant(PROJECT_A, ({ changes }) =>
      changes.open({
        userId: aliceId,
        newEmail: "both@a.test",
        oldTokenHash: "ec2-old",
        newTokenHash: "ec2-new",
        expiresAt: inTen(),
      }),
    );

    const half = await inTenant(PROJECT_A, ({ changes }) => changes.confirm(id, "new", new Date()));
    expect(half?.oldConfirmedAt).toBeNull();
    expect(half?.newConfirmedAt).not.toBeNull();

    const full = await inTenant(PROJECT_A, ({ changes }) => changes.confirm(id, "old", new Date()));
    expect(full?.oldConfirmedAt).not.toBeNull();

    const applied = await Promise.all([
      inTenant(PROJECT_A, ({ changes }) => changes.markApplied(id, new Date())),
      inTenant(PROJECT_A, ({ changes }) => changes.markApplied(id, new Date())),
    ]);
    expect(applied.filter(Boolean)).toHaveLength(1);
  });

  it("expires an abandoned request rather than marking it applied", async () => {
    const id = await inTenant(PROJECT_A, ({ changes }) =>
      changes.open({
        userId: aliceId,
        newEmail: "abandoned@a.test",
        oldTokenHash: "ec3-old",
        newTokenHash: "ec3-new",
        expiresAt: inTen(),
      }),
    );
    await inTenant(PROJECT_A, ({ changes }) => changes.cancelOutstanding(aliceId, ago()));
    const row = await inTenant(PROJECT_A, ({ changes }) => changes.findByToken("ec3-old"));
    expect(row?.id).toBe(id);
    expect(row?.appliedAt).toBeNull();
    expect(row?.expiresAt.getTime()).toBeLessThan(Date.now());
  });
});

describe("passkey challenges and credentials", () => {
  const startCeremony = (project: string) =>
    inTenant(project, ({ passkeyChallenges }) =>
      passkeyChallenges.create({
        ceremony: WebauthnCeremony.Authentication,
        challengeHash: `h-${Math.random()}`,
        userId: null,
        expiresAt: inTen(),
      }),
    );

  it("hands a challenge to exactly one claimant, whatever arrives together", async () => {
    const id = await startCeremony(PROJECT_A);
    const outcomes = await Promise.all([
      inTenant(PROJECT_A, ({ passkeyChallenges }) => passkeyChallenges.claim(id, new Date())),
      inTenant(PROJECT_A, ({ passkeyChallenges }) => passkeyChallenges.claim(id, new Date())),
    ]);
    expect(outcomes.filter((row) => row !== null)).toHaveLength(1);
  });

  it("keeps one project's challenges out of another's", async () => {
    const id = await startCeremony(PROJECT_A);
    const stolen = await inTenant(PROJECT_B, ({ passkeyChallenges }) =>
      passkeyChallenges.claim(id, new Date()),
    );
    expect(stolen).toBeNull();
    // Still available to the project that minted it, so the attempt consumed nothing.
    const mine = await inTenant(PROJECT_A, ({ passkeyChallenges }) =>
      passkeyChallenges.claim(id, new Date()),
    );
    expect(mine).not.toBeNull();
  });

  it("will not resolve a credential id registered by another project", async () => {
    await inTenant(PROJECT_A, ({ passkeys }) =>
      passkeys.register({
        userId: aliceId,
        credentialId: "cred-shared",
        publicKey: "pk",
        signCount: 0,
        transports: ["internal"],
        aaguid: null,
        backupEligible: true,
        backupState: true,
        name: null,
      }),
    );

    expect(
      await inTenant(PROJECT_A, ({ passkeys }) => passkeys.findByCredentialId("cred-shared")),
    ).not.toBeNull();
    expect(
      await inTenant(PROJECT_B, ({ passkeys }) => passkeys.findByCredentialId("cred-shared")),
    ).toBeNull();
  });
});

describe("the redirect allowlist", () => {
  /**
   * We render no page of our own, so this table is the only thing between our 302 and an
   * attacker's. Every open-redirect writeup in this class starts with a match that was
   * almost exact.
   */
  it("matches the whole URI and nothing that merely resembles it", async () => {
    await inTenant(PROJECT_A, async ({ redirects }) => {
      await redirects.register("magic_link", "https://app.test/auth/callback");

      expect(await redirects.isAllowed("magic_link", "https://app.test/auth/callback")).toBe(true);
      for (const attempt of [
        "https://app.test/auth/callback/",
        "https://app.test/auth/callback?next=x",
        "https://app.test/auth/callback.evil.test",
        "https://app.test.evil.test/auth/callback",
        "http://app.test/auth/callback",
        "https://app.test/auth",
      ]) {
        expect(await redirects.isAllowed("magic_link", attempt), attempt).toBe(false);
      }
    });
  });

  it("does not let a URI registered for one purpose serve another", async () => {
    await inTenant(PROJECT_A, async ({ redirects }) => {
      expect(await redirects.isAllowed("oauth", "https://app.test/auth/callback")).toBe(false);
    });
  });

  it("keeps one project's allowlist out of another's", async () => {
    await inTenant(PROJECT_B, async ({ redirects }) => {
      expect(await redirects.isAllowed("magic_link", "https://app.test/auth/callback")).toBe(false);
    });
  });
});

describe("suppression", () => {
  it("reports a suppressed target and tolerates the same bounce twice", async () => {
    await inTenant(PROJECT_A, async ({ suppressions }) => {
      await suppressions.suppress("email", "hash-bounced", "hard_bounce");
      await suppressions.suppress("email", "hash-bounced", "hard_bounce");
      expect(await suppressions.isSuppressed("email", "hash-bounced")).toBe(true);
      expect(await suppressions.isSuppressed("sms", "hash-bounced")).toBe(false);
    });
  });

  it("is per project, so one customer's bounce does not mute another's mail", async () => {
    await inTenant(PROJECT_B, async ({ suppressions }) => {
      expect(await suppressions.isSuppressed("email", "hash-bounced")).toBe(false);
    });
  });
});
