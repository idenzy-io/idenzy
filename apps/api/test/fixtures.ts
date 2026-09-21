import { type RevocationCommands, RevocationSet } from "@idenzy/cache/revocation-set";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
// From `dist`, like every other app test: Vitest transforms with Rolldown, which does not
// apply the decorator semantics NestJS needs, and a class imported from `src` here would be
// a different identity from the one the tests construct.
import { ClaimTemplateService } from "../dist/claims/claim-template-service.js";
import { MfaFactorRegistry } from "../dist/mfa/factor-registry.js";
import { MfaChallengeGate } from "../dist/mfa/mfa-challenge-gate.js";
import { PasskeyFactor } from "../dist/mfa/passkey.factor.js";
import { RecoveryCodeFactor } from "../dist/mfa/recovery-code.factor.js";
import { TotpFactor } from "../dist/mfa/totp.factor.js";
import { PasskeyCeremony } from "../dist/passkey/passkey-ceremony.js";
import { RelyingPartyResolver } from "../dist/passkey/relying-party-resolver.js";
import { RevocationPublisher } from "../dist/session/revocation-publisher.js";

/**
 * A config parsed from a fixed environment rather than a hand-built object, so a test
 * exercises the same validation a boot does and a new required variable breaks here
 * before it breaks a deploy.
 */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return AppConfig.fromEnvironment({
    IDENZY_ENV: "development",
    NODE_ENV: "test",
    DATABASE_URL: "postgres://idenzy@localhost:5432/idenzy",
    VALKEY_URL: "redis://localhost:6379",
    ISSUER_BASE_URL: "https://auth.example.test",
    // Required at boot by `DashboardTenancyModule`, which is in the composition root now
    // that one service serves both surfaces. It is optional in the shared schema because
    // `workers` does not read it, so the failure without it is a refusal to start.
    DASHBOARD_PROJECT_ID: "prj_00000000000040008000000000000002",
    ...overrides,
  });
}

export class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

/**
 * The revocation set's seven commands, in memory.
 *
 * Integration tests use a real `RevocationSet` over this rather than a stubbed publisher,
 * because what is worth asserting is that a revocation actually reaches the set on the
 * paths that perform one, and a stub would assert only that we called our own method.
 */
export class InMemoryRevocationCommands implements RevocationCommands {
  readonly sorted = new Map<string, Map<string, number>>();
  readonly strings = new Map<string, string>();

  zadd(key: string, ...scoreMembers: (string | number)[]): Promise<unknown> {
    const set = this.sorted.get(key) ?? new Map<string, number>();
    for (let index = 0; index + 1 < scoreMembers.length; index += 2) {
      set.set(String(scoreMembers[index + 1]), Number(scoreMembers[index]));
    }
    this.sorted.set(key, set);
    return Promise.resolve(set.size);
  }

  zscore(key: string, member: string): Promise<string | null> {
    const found = this.sorted.get(key)?.get(member);
    return Promise.resolve(found === undefined ? null : String(found));
  }

  zremrangebyscore(key: string, _min: string, max: string): Promise<unknown> {
    const set = this.sorted.get(key);
    if (set === undefined) return Promise.resolve(0);
    const bound = Number(max.startsWith("(") ? max.slice(1) : max);
    for (const [member, score] of [...set]) {
      if (score < bound) set.delete(member);
    }
    return Promise.resolve(0);
  }

  zrange(key: string, _start: number, _stop: number, _scores: "WITHSCORES"): Promise<string[]> {
    const set = this.sorted.get(key);
    if (set === undefined) return Promise.resolve([]);
    return Promise.resolve([...set].flatMap(([member, score]) => [member, String(score)]));
  }

  set(key: string, value: string, _mode: "EX", _seconds: number): Promise<unknown> {
    this.strings.set(key, value);
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  expire(): Promise<unknown> {
    return Promise.resolve(1);
  }
}

/** A publisher over an in-memory set, with the set handed back so a test can read it. */
export function testRevocations(clock: Clock): {
  publisher: RevocationPublisher;
  set: RevocationSet;
  commands: InMemoryRevocationCommands;
} {
  const commands = new InMemoryRevocationCommands();
  const set = new RevocationSet(commands, clock, 360);
  return { publisher: new RevocationPublisher(set, new SilentLogger()), set, commands };
}

/** The in-memory set plus the one connection method the shutdown hook calls. */
export class TestValkey extends InMemoryRevocationCommands {
  quit(): Promise<string> {
    return Promise.resolve("OK");
  }
}

/**
 * The real gate over the real factors, which is what every flow now takes.
 *
 * Real rather than a stub that always answers null, because the property worth holding
 * is that a user who has enrolled nothing is not challenged, and a stub would assert
 * only that we called our own method. It costs one extra read per sign-in in a test.
 */
export function testMfaGate(uow: UnitOfWork, clock: Clock, config: AppConfig): MfaChallengeGate {
  const encryptor = new FieldEncryptor(developmentDataKey(config.get("IDENZY_ENV")));
  return new MfaChallengeGate(
    uow,
    clock,
    config,
    new MfaFactorRegistry(
      new PasskeyFactor(uow, clock, config, new PasskeyCeremony(), new RelyingPartyResolver(uow)),
      new TotpFactor(uow, encryptor, clock),
      new RecoveryCodeFactor(uow, clock),
    ),
  );
}

/**
 * The real claim-template service, which every `SessionService` needs.
 *
 * Real rather than a stub returning an empty template, because "a project that configured
 * nothing gets nothing extra" is the property worth holding, and a stub would assert only
 * that we called our own method.
 */
export function claimTemplates(uow: UnitOfWork, clock: Clock): ClaimTemplateService {
  return new ClaimTemplateService(uow, clock);
}

/**
 * The meter every `AuthFlow` now inherits, recording instead of writing.
 *
 * The rules it applies are the real ones — this subclasses the same base production does — so a
 * test that signs somebody in on the day they were created sees an empty list, which is what
 * PROJECT.md 5.1 promises. What it substitutes is only the destination, because a flow test has
 * no business asserting on a `bytea` column.
 */
export class RecordingActiveUserMeter extends ActiveUserMeter {
  readonly marked: { projectId: string; userId: string; at: Date }[] = [];

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets a test build one.
  constructor(clock: Clock) {
    super(clock);
  }

  protected override record(projectId: string, userId: string, at: Date): Promise<void> {
    this.marked.push({ projectId, userId, at });
    return Promise.resolve();
  }
}

export function testActives(clock: Clock): RecordingActiveUserMeter {
  return new RecordingActiveUserMeter(clock);
}
