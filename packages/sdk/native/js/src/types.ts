import {
  AuthMethod,
  MfaChallengePurpose,
  MfaFactorType,
  SessionRevokeReason,
} from "@idenzy/protocol/enums/auth";
import { IdenzyError } from "./errors.js";

/** The user as an application sees it. `metadataPublic` is whatever your backend stored. */
export interface User {
  readonly id: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly phone: string | null;
  readonly phoneVerified: boolean;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly metadataPublic: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly lastSignInAt: Date | null;
}

/** The session handed to your code: the access token, never the refresh token. */
export interface Session {
  readonly id: string;
  readonly user: User;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
}

/** `loading` lasts until `restore` has answered. Render it as signed out and a signed-in user sees a sign-in screen on every launch. */
export type IdenzyStatus =
  | { readonly status: "loading" }
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly user: User };

export interface ChallengeStarted {
  readonly challengeId: string;
  readonly expiresAt: Date;
}

/** What proves a second factor. */
export type MfaProof =
  | { readonly factor: "totp"; readonly code: string }
  | { readonly factor: "recovery"; readonly code: string };

/** A sign-in that stopped at a second factor, or a step-up waiting for one. `factors` is strongest first. */
export interface MfaChallenge {
  readonly challengeId: string;
  readonly purpose: MfaChallengePurpose | "unrecognized";
  readonly factors: readonly (MfaFactorType | "unrecognized")[];
  readonly expiresAt: Date;
  submit(proof: MfaProof): Promise<Session>;
}

/** What every way in answers with: a session, or a challenge to finish first. */
export type AuthResult =
  | { readonly status: "authenticated"; readonly session: Session }
  | { readonly status: "mfa_required"; readonly challenge: MfaChallenge };

/** A nonce for one native sign-in: `digest` to the platform's sheet, `nonce` back to Idenzy. */
export interface IdTokenNonce {
  readonly nonce: string;
  readonly digest: string;
  readonly expiresAt: Date;
}

export interface MfaFactorSummary {
  readonly id: string;
  readonly type: MfaFactorType | "unrecognized";
  readonly label: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

export interface MfaFactorList {
  readonly factors: readonly MfaFactorSummary[];
  readonly recoveryCodesRemaining: number;
}

/** The shared secret, once. `uri` is what a QR code encodes; rendering it is yours. */
export interface TotpEnrolment {
  readonly factorId: string;
  readonly secret: string;
  readonly uri: string;
}

/** Shown once and never again: only digests are kept. */
export interface RecoveryCodes {
  readonly codes: readonly string[];
  readonly generatedAt: Date;
}

export interface MfaEnrolmentConfirmed {
  readonly factor: MfaFactorSummary;
  readonly recoveryCodes: RecoveryCodes | null;
}

/** A session as the device list shows it. No token material. */
export interface SessionSummary {
  readonly id: string;
  readonly deviceName: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly amr: readonly (AuthMethod | "unrecognized")[];
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokeReason: SessionRevokeReason | "unrecognized" | null;
  readonly current: boolean;
}

/**
 * Reads one value the native module sent, refusing anything not of the shape it promised.
 *
 * The native side is ours, and it is still a trust boundary (PROJECT.md 7.1): a mismatch between
 * a JavaScript bundle and the native code it runs on is how a wrong shape would arrive, and the
 * alternative to refusing it here is a `TypeError` deep in somebody's screen.
 */
export class Reader {
  private constructor(
    private readonly values: Readonly<Record<string, unknown>>,
    private readonly where: string,
  ) {}

  static of(value: unknown, where: string): Reader {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw malformed(where, "an object");
    }
    return new Reader(value as Readonly<Record<string, unknown>>, where); // proven an object above
  }

  text(name: string): string {
    const value = this.values[name];
    if (typeof value !== "string") throw malformed(`${this.where}.${name}`, "a string");
    return value;
  }

  optionalText(name: string): string | null {
    const value = this.values[name];
    return typeof value === "string" ? value : null;
  }

  flag(name: string): boolean {
    const value = this.values[name];
    if (typeof value !== "boolean") throw malformed(`${this.where}.${name}`, "a boolean");
    return value;
  }

  count(name: string): number {
    const value = this.values[name];
    if (typeof value !== "number") throw malformed(`${this.where}.${name}`, "a number");
    return value;
  }

  time(name: string): Date {
    return new Date(this.count(name));
  }

  optionalTime(name: string): Date | null {
    const value = this.values[name];
    return typeof value === "number" ? new Date(value) : null;
  }

  record(name: string): Reader {
    return Reader.of(this.values[name], `${this.where}.${name}`);
  }

  optionalRecord(name: string): Reader | null {
    const value = this.values[name];
    return value === null || value === undefined ? null : Reader.of(value, `${this.where}.${name}`);
  }

  list(name: string): readonly unknown[] {
    const value = this.values[name];
    if (!Array.isArray(value)) throw malformed(`${this.where}.${name}`, "a list");
    return value;
  }
}

function malformed(where: string, expected: string): IdenzyError {
  return new IdenzyError(
    "provider_unavailable",
    `The native SDK answered ${where} with something other than ${expected}.`,
    {
      transportReason: "unexpectedResponse",
    },
  );
}

/** A wire value of one of the protocol's enums, or `"unrecognized"` for one newer than this build. */
function member<T extends string>(
  values: Readonly<Record<string, T>>,
  value: unknown,
): T | "unrecognized" {
  const known = Object.values(values).find((candidate) => candidate === value);
  return known ?? "unrecognized";
}

export function userFrom(reader: Reader): User {
  const metadata: unknown = JSON.parse(reader.text("metadataPublicJson"));
  return {
    id: reader.text("id"),
    email: reader.optionalText("email"),
    emailVerified: reader.flag("emailVerified"),
    phone: reader.optionalText("phone"),
    phoneVerified: reader.flag("phoneVerified"),
    displayName: reader.optionalText("displayName"),
    avatarUrl: reader.optionalText("avatarUrl"),
    metadataPublic: typeof metadata === "object" && metadata !== null ? { ...metadata } : {},
    createdAt: reader.time("createdAt"),
    lastSignInAt: reader.optionalTime("lastSignInAt"),
  };
}

export function sessionFrom(reader: Reader): Session {
  return {
    id: reader.text("id"),
    user: userFrom(reader.record("user")),
    accessToken: reader.text("accessToken"),
    accessTokenExpiresAt: reader.time("accessTokenExpiresAt"),
  };
}

export function statusFrom(reader: Reader): IdenzyStatus {
  switch (reader.text("status")) {
    case "signedIn":
      return { status: "signedIn", user: userFrom(reader.record("user")) };
    case "signedOut":
      return { status: "signedOut" };
    default:
      return { status: "loading" };
  }
}

export function startedFrom(reader: Reader): ChallengeStarted {
  return { challengeId: reader.text("challengeId"), expiresAt: reader.time("expiresAt") };
}

export function challengeFrom(
  reader: Reader,
  submit: (challengeId: string, proof: MfaProof) => Promise<Session>,
): MfaChallenge {
  const challengeId = reader.text("challengeId");
  return {
    challengeId,
    purpose: member(MfaChallengePurpose, reader.optionalText("purpose")),
    factors: reader.list("factors").map((factor) => member(MfaFactorType, factor)),
    expiresAt: reader.time("expiresAt"),
    submit: (proof) => submit(challengeId, proof),
  };
}

export function nonceFrom(reader: Reader): IdTokenNonce {
  return {
    nonce: reader.text("nonce"),
    digest: reader.text("digest"),
    expiresAt: reader.time("expiresAt"),
  };
}

export function factorFrom(reader: Reader): MfaFactorSummary {
  return {
    id: reader.text("id"),
    type: member(MfaFactorType, reader.optionalText("type")),
    label: reader.optionalText("label"),
    createdAt: reader.time("createdAt"),
    lastUsedAt: reader.optionalTime("lastUsedAt"),
  };
}

export function recoveryCodesFrom(reader: Reader): RecoveryCodes {
  return {
    codes: reader.list("codes").map((code) => String(code)),
    generatedAt: reader.time("generatedAt"),
  };
}

export function sessionSummaryFrom(reader: Reader): SessionSummary {
  const reason = reader.optionalText("revokeReason");
  return {
    id: reader.text("id"),
    deviceName: reader.optionalText("deviceName"),
    ip: reader.optionalText("ip"),
    userAgent: reader.optionalText("userAgent"),
    amr: reader.list("amr").map((method) => member(AuthMethod, method)),
    createdAt: reader.time("createdAt"),
    lastActiveAt: reader.time("lastActiveAt"),
    absoluteExpiresAt: reader.time("absoluteExpiresAt"),
    revokedAt: reader.optionalTime("revokedAt"),
    revokeReason: reason === null ? null : member(SessionRevokeReason, reason),
    current: reader.flag("current"),
  };
}
