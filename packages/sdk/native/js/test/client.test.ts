import { describe, expect, it } from "vitest";
import { IdenzyError, IdenzySignInCancelled } from "../src/errors.js";
import { Idenzy } from "../src/idenzy-native-js.js";
import type { NativeAnswer, NativeBridge } from "../src/native-bridge.js";

const userWire = {
  id: "usr_00000000000000000001",
  email: "ada@example.com",
  emailVerified: true,
  phone: null,
  phoneVerified: false,
  displayName: "Ada",
  avatarUrl: null,
  metadataPublicJson: '{"plan":"pro"}',
  createdAt: 1_791_788_400_000,
  lastSignInAt: null,
};
const sessionWire = {
  id: "ses_00000000000000000001",
  user: userWire,
  accessToken: "access.token.value",
  accessTokenExpiresAt: 1_791_788_700_000,
};

/** The native half as the bridge would answer, recording what JavaScript asked. */
class FakeNative implements NativeBridge {
  readonly calls: { method: string; args: Readonly<Record<string, unknown>> }[] = [];
  private statusListener: ((status: Readonly<Record<string, unknown>>) => void) | null = null;

  constructor(private readonly answer: (method: string) => NativeAnswer = () => ({ ok: null })) {}

  call(method: string, args: Readonly<Record<string, unknown>>): Promise<NativeAnswer> {
    this.calls.push({ method, args });
    return Promise.resolve(this.answer(method));
  }

  watchStatus(listener: (status: Readonly<Record<string, unknown>>) => void): () => void {
    this.statusListener = listener;
    return () => {
      this.statusListener = null;
    };
  }

  report(status: Readonly<Record<string, unknown>>): void {
    this.statusListener?.(status);
  }
}

describe("the client over the native SDKs", () => {
  it("configures the native SDK with the project and nothing else", async () => {
    const native = new FakeNative();
    await Idenzy.configure(
      { publishableKey: "pk_test_1", apiUrl: "https://auth.example.test" },
      native,
    );
    expect(native.calls).toEqual([
      {
        method: "configure",
        args: {
          publishableKey: "pk_test_1",
          apiUrl: "https://auth.example.test",
          deviceName: null,
        },
      },
    ]);
  });

  it("turns a session into typed values", async () => {
    const client = new Idenzy(
      new FakeNative(() => ({ ok: { status: "authenticated", session: sessionWire } })),
    );
    const result = await client.signIn.withPassword({ email: "ada@example.com", password: "pw" });
    if (result.status !== "authenticated")
      throw new IdenzyError("validation_failed", "expected a session");
    expect(result.session.user.createdAt).toEqual(new Date(Date.UTC(2026, 9, 12, 7)));
    expect(result.session.user.metadataPublic).toEqual({ plan: "pro" });
  });

  it("answers a challenge through the challenge, keeping factors newer than this build", async () => {
    const native = new FakeNative((method) =>
      method === "mfa.submit"
        ? { ok: sessionWire }
        : {
            ok: {
              status: "mfa_required",
              challenge: {
                challengeId: "chl_1",
                purpose: "sign_in",
                factors: ["totp", "carrier_pigeon"],
                expiresAt: 1_791_789_000_000,
              },
            },
          },
    );
    const client = new Idenzy(native);
    const result = await client.signIn.withPassword({ email: "ada@example.com", password: "pw" });
    if (result.status !== "mfa_required")
      throw new IdenzyError("validation_failed", "expected a challenge");
    expect(result.challenge.factors).toEqual(["totp", "unrecognized"]);

    await result.challenge.submit({ factor: "recovery", code: "ABCDE-FGHIJ" });
    expect(native.calls.at(-1)).toEqual({
      method: "mfa.submit",
      args: { challengeId: "chl_1", factor: "recovery", code: "ABCDE-FGHIJ" },
    });
  });

  it("throws a refusal as its stable code, with the detail beside it", async () => {
    const client = new Idenzy(
      new FakeNative(() => ({
        error: {
          code: "rate_limited",
          message: "Slow down.",
          details: { status: 429, requestId: "req_2", retryAfterSeconds: 30 },
        },
      })),
    );
    await expect(client.getToken()).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      requestId: "req_2",
      retryAfterSeconds: 30,
    });
  });

  it("keeps a code newer than this build readable", async () => {
    const client = new Idenzy(
      new FakeNative(() => ({ error: { code: "brand_new_code", message: "No." } })),
    );
    await expect(client.getToken()).rejects.toMatchObject({
      code: "unrecognized",
      rawCode: "brand_new_code",
    });
  });

  it("reports a closed sheet as a cancel, not an error", async () => {
    const client = new Idenzy(
      new FakeNative(() => ({ error: { code: "cancelled", message: "" } })),
    );
    await expect(client.signIn.withApple()).rejects.toBeInstanceOf(IdenzySignInCancelled);
  });

  it("refuses an answer that is not the shape the bridge promises", async () => {
    const client = new Idenzy(
      new FakeNative(() => ({ ok: { status: "authenticated", session: { id: 7 } } })),
    );
    await expect(client.signIn.anonymously()).rejects.toMatchObject({
      transportReason: "unexpectedResponse",
    });
  });

  it("starts loading and follows what the native SDK reports", () => {
    const native = new FakeNative();
    const client = new Idenzy(native);
    const seen: string[] = [];
    client.subscribe((status) => seen.push(status.status));

    expect(client.status.status).toBe("loading");
    native.report({ status: "signedIn", user: userWire });
    native.report({ status: "signedOut" });

    expect(seen).toEqual(["signedIn", "signedOut"]);
    expect(client.status.status).toBe("signedOut");
  });

  it("sends a native sign-in's nonce, never its digest", async () => {
    const native = new FakeNative((method) =>
      method === "idToken.prepare"
        ? { ok: { nonce: "server-nonce", digest: "abc123", expiresAt: 1_791_789_000_000 } }
        : { ok: { status: "authenticated", session: sessionWire } },
    );
    const client = new Idenzy(native);
    const prepared = await client.nativeSignIn.prepare();
    await client.nativeSignIn.exchange({
      provider: "google",
      idToken: "google.id.token",
      nonce: prepared.nonce,
    });
    expect(native.calls.at(-1)?.args).toEqual({
      provider: "google",
      idToken: "google.id.token",
      nonce: "server-nonce",
      displayName: null,
    });
  });

  it("adds a passkey by name and reads it back typed", async () => {
    const native = new FakeNative(() => ({
      ok: {
        id: "pk_1",
        name: "Phone",
        transports: ["internal"],
        backupEligible: true,
        backedUp: true,
        createdAt: 1_791_788_400_000,
        lastUsedAt: null,
      },
    }));
    const passkey = await new Idenzy(native).passkeys.add({ name: "Phone" });
    expect(native.calls.at(-1)).toEqual({ method: "passkey.add", args: { name: "Phone" } });
    expect(passkey.createdAt).toEqual(new Date(Date.UTC(2026, 9, 12, 7)));
    expect(passkey.lastUsedAt).toBeNull();
  });
});
