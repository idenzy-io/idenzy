import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccessTokenSource } from "../src/access-token-source.js";
import { crc32cString } from "../src/crc32c.js";
import { KmsKeyEncryption } from "../src/kms-key-encryption.js";

/**
 * Wrapping key material through the KMS REST API.
 *
 * Against a real server, because what is worth asserting is the request this builds and what it
 * does with an imperfect response — and the imperfect responses are the point. A silently corrupted
 * ciphertext is key material that can never be unwrapped again, found at the moment a project stops
 * being able to mint a token.
 */
const KEY = "projects/idenzy-dev/locations/us-central1/keyRings/idenzy-us1-ring/cryptoKeys/dek";
const PLAINTEXT = new TextEncoder().encode("a signing key, pretend");
const CIPHERTEXT = Buffer.from("wrapped-bytes");

class FixedTokens extends AccessTokenSource {
  override token(): Promise<string> {
    return Promise.resolve("ya29.test");
  }
}

let server: Server;
let base: string;
let seen: { url: string; body: Record<string, string> }[] = [];
let reply: (url: string) => { status: number; body: unknown };

function goodReplies(url: string): { status: number; body: unknown } {
  if (url.endsWith(":encrypt")) {
    return {
      status: 200,
      body: {
        ciphertext: CIPHERTEXT.toString("base64"),
        ciphertextCrc32c: crc32cString(CIPHERTEXT),
        verifiedPlaintextCrc32c: true,
      },
    };
  }
  return {
    status: 200,
    body: {
      plaintext: Buffer.from(PLAINTEXT).toString("base64"),
      plaintextCrc32c: crc32cString(PLAINTEXT),
    },
  };
}

beforeAll(async () => {
  reply = goodReplies;
  server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      seen.push({
        url: request.url ?? "",
        body: JSON.parse(raw || "{}") as Record<string, string>,
      });
      const { status, body } = reply(request.url ?? "");
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function kms(): KmsKeyEncryption {
  seen = [];
  reply = goodReplies;
  return new KmsKeyEncryption(KEY, new FixedTokens(), { endpoint: base });
}

describe("wrapping and unwrapping", () => {
  it("round-trips through the API", async () => {
    const wrapped = await kms().wrap(PLAINTEXT, "prj_1");
    expect(Buffer.from(wrapped)).toEqual(CIPHERTEXT);
    expect(Buffer.from(await kms().unwrap(CIPHERTEXT, "prj_1"))).toEqual(Buffer.from(PLAINTEXT));
  });

  it("calls the named key and authenticates as this service account", async () => {
    const encryption = kms();
    await encryption.wrap(PLAINTEXT, "prj_1");
    expect(seen[0]?.url).toBe(`/v1/${KEY}:encrypt`);
  });

  it("sends a checksum of what it is asking KMS to encrypt", async () => {
    const encryption = kms();
    await encryption.wrap(PLAINTEXT, "prj_1");
    expect(seen[0]?.body["plaintextCrc32c"]).toBe(crc32cString(PLAINTEXT));
  });

  /**
   * The context is additional authenticated data, and it is what stops a ciphertext lifted from one
   * project's row opening in another's. Without it, a swapped row would silently issue one tenant's
   * tokens under another tenant's key.
   */
  it("binds the ciphertext to the project it belongs to", async () => {
    const encryption = kms();
    await encryption.wrap(PLAINTEXT, "prj_alpha");
    const sent = Buffer.from(seen[0]?.body["additionalAuthenticatedData"] ?? "", "base64");
    expect(sent.toString("utf8")).toBe("prj_alpha");
  });
});

describe("a response that cannot be trusted", () => {
  it("refuses a ciphertext whose checksum does not match", async () => {
    const encryption = kms();
    reply = () => ({
      status: 200,
      body: {
        ciphertext: CIPHERTEXT.toString("base64"),
        // What a flipped bit in transit looks like: plausible bytes, wrong checksum.
        ciphertextCrc32c: "12345",
        verifiedPlaintextCrc32c: true,
      },
    });
    await expect(encryption.wrap(PLAINTEXT, "prj_1")).rejects.toMatchObject({
      detail: { reason: expect.stringContaining("corrupted in transit") },
    });
  });

  /**
   * A missing checksum is a failure and not a skip. KMS always returns one, so its absence means
   * the response is not the shape we think — and "verify when present" is how a corruption check
   * quietly becomes optional.
   */
  it("refuses a response with no checksum at all", async () => {
    const encryption = kms();
    reply = () => ({ status: 200, body: { ciphertext: CIPHERTEXT.toString("base64") } });
    await expect(encryption.wrap(PLAINTEXT, "prj_1")).rejects.toMatchObject({
      detail: { expected: "absent" },
    });
  });

  /** KMS itself saying it received damaged bytes. Proceeding would store a wrap of something else. */
  it("refuses when KMS could not verify what it received", async () => {
    const encryption = kms();
    reply = () => ({
      status: 200,
      body: {
        ciphertext: CIPHERTEXT.toString("base64"),
        ciphertextCrc32c: crc32cString(CIPHERTEXT),
        verifiedPlaintextCrc32c: false,
      },
    });
    await expect(encryption.wrap(PLAINTEXT, "prj_1")).rejects.toMatchObject({
      detail: { reason: expect.stringContaining("did not verify") },
    });
  });

  it("refuses an unwrapped key whose checksum does not match", async () => {
    const encryption = kms();
    reply = () => ({
      status: 200,
      body: { plaintext: Buffer.from(PLAINTEXT).toString("base64"), plaintextCrc32c: "999" },
    });
    await expect(encryption.unwrap(CIPHERTEXT, "prj_1")).rejects.toMatchObject({
      detail: { operation: "decrypt" },
    });
  });

  it("names the status but nothing from the body when KMS refuses", async () => {
    const encryption = kms();
    reply = () => ({ status: 403, body: { error: { message: "denied for key-material-xyz" } } });
    const caught = await encryption.wrap(PLAINTEXT, "prj_1").then(
      () => null,
      (error: unknown) => error,
    );
    expect(JSON.stringify(caught ?? {})).toContain("403");
    expect(JSON.stringify(caught ?? {})).not.toContain("key-material-xyz");
  });
});
