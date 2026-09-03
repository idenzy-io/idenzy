import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";
import type {
  AuthenticationResponse,
  RegistrationResponse,
} from "@idenzy/protocol/schemas/webauthn";

/**
 * Authenticator data flags, as bit positions in the byte after the RP ID hash.
 *
 * BE and BS are the two that get confused. BE says the credential *may* be backed up and
 * never changes; BS says it currently *is*, and moves over the credential's life.
 */
const Flag = {
  UserPresent: 0x01,
  UserVerified: 0x04,
  BackupEligible: 0x08,
  BackupState: 0x10,
  AttestedCredentialData: 0x40,
} as const;

/** Minimal CBOR writer: the four types a COSE key and a "none" attestation need. */
const cbor = {
  uint(value: number): Buffer {
    return cbor.head(0, value);
  },
  /** CBOR encodes -1-n, so -7 is major type 1 carrying 6. */
  nint(value: number): Buffer {
    return cbor.head(1, -1 - value);
  },
  bytes(value: Buffer): Buffer {
    return Buffer.concat([cbor.head(2, value.length), value]);
  },
  text(value: string): Buffer {
    const encoded = Buffer.from(value, "utf8");
    return Buffer.concat([cbor.head(3, encoded.length), encoded]);
  },
  /**
   * Entries are written in the order given, and every caller here gives them in
   * canonical order (RFC 8152): shorter keys first, then bytewise. A decoder that
   * checks would otherwise reject a key we generated ourselves.
   */
  map(entries: readonly (readonly [Buffer, Buffer])[]): Buffer {
    return Buffer.concat([
      cbor.head(5, entries.length),
      ...entries.map(([key, value]) => Buffer.concat([key, value])),
    ]);
  },
  head(major: number, value: number): Buffer {
    const tag = major << 5;
    if (value < 24) return Buffer.from([tag | value]);
    if (value < 0x100) return Buffer.from([tag | 24, value]);
    if (value < 0x10000) return Buffer.from([tag | 25, value >> 8, value & 0xff]);
    const out = Buffer.alloc(5);
    out.writeUInt8(tag | 26, 0);
    out.writeUInt32BE(value, 1);
    return out;
  },
};

export interface AuthenticatorOptions {
  /** Defaults to a synced platform credential, which is what a real passkey usually is. */
  readonly backupEligible?: boolean;
  readonly backupState?: boolean;
  readonly userVerified?: boolean;
  readonly aaguid?: Buffer;
}

export interface CeremonyOptions {
  /**
   * Overrides the counter this assertion reports. A test uses it to replay a value the
   * authenticator has already sent, which is what a cloned device looks like from here.
   */
  readonly signCount?: number;
  /** Overrides the handle, so a test can assert a mismatched one is refused. */
  readonly userHandle?: string;
}

/**
 * A software WebAuthn authenticator, for tests that want the real thing.
 *
 * It produces genuine attestation and assertion responses: a real P-256 key, real
 * authenticator data, a real CBOR attestation object and a real ECDSA signature over the
 * bytes the spec says to sign. Nothing is stubbed, so a test written against it exercises
 * the same verification path a browser does.
 *
 * That matters more here than the extra code costs. The attacks worth testing against a
 * passkey endpoint (a replayed challenge, a cloned counter, an origin we do not serve,
 * a credential from another tenant) are all things a fake verifier would happily accept,
 * so a fake would prove only that the fake agrees with itself (PROJECT.md 7.4).
 *
 * Attestation is "none" and only ES256 is offered, which is what the overwhelming
 * majority of real passkeys use and all our verifier is asked to accept.
 */
export class TestAuthenticator {
  private readonly privateKey: KeyObject;
  private readonly coseKey: Buffer;
  private readonly aaguid: Buffer;
  private readonly options: Required<Omit<AuthenticatorOptions, "aaguid">>;
  private counter = 0;

  readonly credentialId: Buffer;

  constructor(options: AuthenticatorOptions = {}) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    this.coseKey = cbor.map([
      // kty: EC2
      [cbor.uint(1), cbor.uint(2)],
      // alg: ES256
      [cbor.uint(3), cbor.nint(-7)],
      // crv: P-256
      [cbor.nint(-1), cbor.uint(1)],
      [cbor.nint(-2), cbor.bytes(Buffer.from(jwk.x ?? "", "base64url"))],
      [cbor.nint(-3), cbor.bytes(Buffer.from(jwk.y ?? "", "base64url"))],
    ]);
    this.credentialId = randomBytes(32);
    this.aaguid = options.aaguid ?? Buffer.alloc(16);
    this.options = {
      backupEligible: options.backupEligible ?? true,
      backupState: options.backupState ?? true,
      userVerified: options.userVerified ?? true,
    };
  }

  get credentialIdB64(): string {
    return this.credentialId.toString("base64url");
  }

  /** The attestation half. Signs nothing, because the format is "none". */
  register(rpId: string, origin: string, challenge: string): RegistrationResponse {
    const clientDataJSON = this.clientData("webauthn.create", challenge, origin);
    const authData = this.authenticatorData(rpId, this.counter, true);
    const attestationObject = cbor.map([
      [cbor.text("fmt"), cbor.text("none")],
      [cbor.text("attStmt"), cbor.map([])],
      [cbor.text("authData"), cbor.bytes(authData)],
    ]);

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        attestationObject: attestationObject.toString("base64url"),
        transports: ["internal", "hybrid"],
      },
    };
  }

  /**
   * The assertion half, signed over `authenticatorData || sha256(clientDataJSON)`.
   *
   * The counter advances by one per ceremony unless a test pins it, because that is what
   * a real authenticator does and what the server's clone check is comparing against.
   */
  authenticate(
    rpId: string,
    origin: string,
    challenge: string,
    userHandle: string,
    options: CeremonyOptions = {},
  ): AuthenticationResponse {
    this.counter += 1;
    const clientDataJSON = this.clientData("webauthn.get", challenge, origin);
    const authData = this.authenticatorData(rpId, options.signCount ?? this.counter, false);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]),
      this.privateKey,
    );

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
        userHandle: options.userHandle ?? userHandle,
      },
    };
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), "utf8");
  }

  private authenticatorData(rpId: string, counter: number, attested: boolean): Buffer {
    let flags = Flag.UserPresent;
    if (this.options.userVerified) flags |= Flag.UserVerified;
    if (this.options.backupEligible) flags |= Flag.BackupEligible;
    if (this.options.backupState) flags |= Flag.BackupState;
    if (attested) flags |= Flag.AttestedCredentialData;

    const header = Buffer.alloc(37);
    createHash("sha256").update(rpId).digest().copy(header, 0);
    header.writeUInt8(flags, 32);
    header.writeUInt32BE(counter, 33);
    if (!attested) return header;

    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length, 0);
    return Buffer.concat([header, this.aaguid, idLength, this.credentialId, this.coseKey]);
  }
}
