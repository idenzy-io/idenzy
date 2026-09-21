import { execFileSync } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SnsMessageVerifier, SnsSubscriptionConfirmer } from "../src/aws/sns-message-verifier.js";

const TOPIC = "arn:aws:sns:eu-west-1:123456789012:idenzy-email-events";
const OTHER_TOPIC = "arn:aws:sns:eu-west-1:999999999999:somebody-elses-topic";
const CERT_URL = "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc123.pem";

let privateKey: string;
let certificate: string;
let workDir: string;

/**
 * A real key and a real self-signed certificate, because the thing under test is a real
 * signature check.
 *
 * `createVerify().verify()` takes a certificate rather than a bare public key, so the suite
 * mints one with openssl the way SNS publishes one. A fake verifier would accept whatever
 * this test handed it, which is exactly the failure the cases below exist to catch.
 */
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "sns-verifier-"));
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const keyPath = join(workDir, "key.pem");
  const certPath = join(workDir, "cert.pem");
  writeFileSync(keyPath, privateKey);
  execFileSync("openssl", [
    "req",
    "-new",
    "-x509",
    "-key",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=sns.amazonaws.com",
  ]);
  certificate = readFileSync(certPath, "utf8");
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Serves the certificate, and records every URL the verifier went to. */
function stubCertFetch(body = certificate, status = 200): string[] {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL) => {
      seen.push(String(url));
      return Promise.resolve(new Response(body, { status }));
    }),
  );
  return seen;
}

interface Envelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  SigningCertURL: string;
  Signature?: string;
  Token?: string;
  SubscribeURL?: string;
  Subject?: string;
}

const SIGNED: Readonly<Record<string, readonly string[]>> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
};

/** Builds and signs an envelope the way SNS does, so a case can then break one thing. */
function sign(overrides: Partial<Envelope> = {}): Envelope {
  const envelope: Envelope = {
    Type: "Notification",
    MessageId: "11111111-2222-3333-4444-555555555555",
    TopicArn: TOPIC,
    Message: JSON.stringify({ eventType: "Delivery" }),
    Timestamp: "2026-09-14T10:00:00.000Z",
    SignatureVersion: "1",
    SigningCertURL: CERT_URL,
    ...overrides,
  };

  const fields = SIGNED[envelope.Type] ?? SIGNED["Notification"] ?? [];
  const record = envelope as unknown as Record<string, string | undefined>;
  let canonical = "";
  for (const field of fields) {
    const value = record[field];
    if (value === undefined) continue;
    canonical += `${field}\n${value}\n`;
  }

  const signer = createSign(envelope.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
  signer.update(canonical, "utf8");
  envelope.Signature = signer.sign(privateKey, "base64");
  return envelope;
}

const verifier = () => new SnsMessageVerifier({ topicArns: [TOPIC] });

/**
 * Whether an SNS message is from AWS, and from a topic we asked to hear from.
 *
 * Everything below is an attack that must fail rather than a happy path that must work
 * (PROJECT.md 7.4). The endpoint behind this writes the suppression list and moves the
 * counters a project's sending is stopped on, so the cost of accepting a forgery is a
 * stranger deciding whose mail we refuse to send.
 */
describe("verifying an SNS message", () => {
  it("accepts a message AWS signed, at either signature version", async () => {
    stubCertFetch();
    await expect(verifier().verify(JSON.stringify(sign()))).resolves.toMatchObject({
      TopicArn: TOPIC,
    });
    await expect(
      verifier().verify(JSON.stringify(sign({ SignatureVersion: "2" }))),
    ).resolves.toMatchObject({ TopicArn: TOPIC });
  });

  it("refuses a message whose body was edited after it was signed", async () => {
    stubCertFetch();
    const envelope = sign();
    const tampered = { ...envelope, Message: JSON.stringify({ eventType: "Bounce" }) };
    await expect(verifier().verify(JSON.stringify(tampered))).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  /*
   * The case the ARN allowlist exists for, and the one a signature check alone does not
   * cover. This envelope carries a genuine signature over its own contents — anybody can
   * create a topic, subscribe our URL to it and publish through it — so without the topic
   * check it would be accepted and whatever it claimed bounced would be suppressed.
   */
  it("refuses a validly signed message from a topic it does not subscribe to", async () => {
    stubCertFetch();
    const envelope = sign({ TopicArn: OTHER_TOPIC });
    await expect(verifier().verify(JSON.stringify(envelope))).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  /*
   * And the case that makes signature verification circular. A certificate URL taken at
   * face value means "fetch a key from whoever sent this, then confirm they signed their
   * own message", which every forgery passes.
   */
  it("refuses to fetch a signing certificate from anywhere but SNS", async () => {
    const seen = stubCertFetch();
    const hostile = [
      "https://evil.test/cert.pem",
      "http://sns.eu-west-1.amazonaws.com/cert.pem",
      "https://sns.eu-west-1.amazonaws.com.evil.test/cert.pem",
      "https://evil.test/?u=sns.eu-west-1.amazonaws.com",
    ];

    for (const url of hostile) {
      await expect(
        verifier().verify(JSON.stringify(sign({ SigningCertURL: url }))),
      ).rejects.toMatchObject({ code: "validation_failed" });
    }
    expect(seen, "a refused certificate URL must never be fetched").toEqual([]);
  });

  it("refuses a body that is not an SNS envelope at all", async () => {
    stubCertFetch();
    await expect(verifier().verify("not json")).rejects.toMatchObject({
      code: "validation_failed",
    });
    await expect(verifier().verify(JSON.stringify({ Type: "Notification" }))).rejects.toThrow();
  });

  it("fetches a certificate once and reuses it", async () => {
    const seen = stubCertFetch();
    const one = verifier();
    await one.verify(JSON.stringify(sign()));
    await one.verify(JSON.stringify(sign({ MessageId: "another" })));
    expect(seen).toHaveLength(1);
  });
});

/**
 * Confirming a subscription is an action, and the judgement has to come first.
 *
 * Confirming an unverified message subscribes us to a stranger's topic, after which every
 * message they publish arrives carrying a real AWS signature and passes every check above.
 */
describe("confirming a subscription", () => {
  it("verifies before it confirms, so an unlisted topic never gets subscribed", async () => {
    const seen = stubCertFetch();
    const envelope = sign({
      Type: "SubscriptionConfirmation",
      TopicArn: OTHER_TOPIC,
      Token: "tok",
      SubscribeURL: "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription",
    });

    await expect(verifier().verify(JSON.stringify(envelope))).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(seen, "nothing may be fetched for a topic we do not subscribe to").toEqual([]);
  });

  it("follows the SubscribeURL for a confirmation it did verify", async () => {
    stubCertFetch();
    const envelope = await verifier().verify(
      JSON.stringify(
        sign({
          Type: "SubscriptionConfirmation",
          Token: "tok",
          SubscribeURL: "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription",
        }),
      ),
    );

    const seen = stubCertFetch("<ConfirmSubscriptionResponse/>");
    await new SnsSubscriptionConfirmer().confirm(envelope);
    expect(seen).toEqual(["https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription"]);
  });
});
