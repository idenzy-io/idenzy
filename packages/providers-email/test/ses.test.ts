import { DeliveryFailedError } from "@idenzy/core/errors";
import type { Clock } from "@idenzy/core/time/clock";
import { EmailProviderConformanceSuite } from "@idenzy/testing/email-provider-conformance";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SesEmailProvider } from "../src/ses-email-provider.js";

const AT = new Date("2026-09-13T15:12:00.000Z");

const clock: Clock = {
  now: () => AT,
  nowMs: () => AT.getTime(),
} as Clock;

const credentials = () =>
  Promise.resolve({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" });

const OPTIONS = { region: "us-east-1", credentials, configurationSet: "idenzy-default" };

const allowing = { assertSendable: () => Promise.resolve() };
const metering = { assertWithinQuota: () => Promise.resolve(), record: () => Promise.resolve() };

/** A `fetch` that answers once with whatever a case needs, and records what it was given. */
function stubFetch(status: number, body: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = vi.fn((url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(
      new Response(body, { status, headers: { "content-type": "application/json" } }),
    );
  });
  vi.stubGlobal("fetch", fake);
  return calls;
}

const provider = () => new SesEmailProvider(allowing, metering, clock, OPTIONS);

const message = {
  to: "recipient@example.test",
  from: "no-reply@auth.idenzy.dev",
  subject: "Your code",
  html: "<p>123456</p>",
  text: "123456",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the SES transport", () => {
  beforeEach(() => {
    stubFetch(200, JSON.stringify({ MessageId: "0100018f-aaaa" }));
  });

  /**
   * The suite tests inherited guarantees rather than transport, and it is the thing that
   * stops an adapter quietly overriding `send` to add a header and taking the suppression
   * check out with it.
   */
  it("satisfies the email provider family contract", async () => {
    const failures = await new EmailProviderConformanceSuite().run({
      name: "SesEmailProvider",
      subject: (suppression, meter) => new SesEmailProvider(suppression, meter, clock, OPTIONS),
    });
    expect(failures).toEqual([]);
  });

  it("posts a signed request to the region's SES endpoint", async () => {
    const calls = stubFetch(200, JSON.stringify({ MessageId: "0100018f-bbbb" }));
    await provider().send("proj", message);

    const [call] = calls;
    expect(call?.url).toBe("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toContain("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/");
    expect(headers["authorization"]).toContain("/us-east-1/ses/aws4_request");
    expect(headers["x-amz-date"]).toBe("20260913T151200Z");
  });

  /**
   * The configuration set is how a bounce gets back to us at all, so a message sent
   * outside one is a message whose hard bounce we never hear about (PROJECT.md 4.7).
   */
  it("sends every message through the configuration set", async () => {
    const calls = stubFetch(200, JSON.stringify({ MessageId: "0100018f-cccc" }));
    await provider().send("proj", message);

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body["ConfigurationSetName"]).toBe("idenzy-default");
    expect(body["FromEmailAddress"]).toBe(message.from);
    expect((body["Destination"] as { ToAddresses: string[] }).ToAddresses).toEqual([message.to]);
  });

  it("returns the provider's own message id", async () => {
    stubFetch(200, JSON.stringify({ MessageId: "0100018f-dddd" }));
    await expect(provider().send("proj", message)).resolves.toBe("0100018f-dddd");
  });

  /**
   * A 200 with no id is not a success we can record: the base is about to meter this send
   * against a customer's bill and hand the id back as the receipt for it.
   */
  it("refuses a success that carries no message id", async () => {
    stubFetch(200, JSON.stringify({}));
    await expect(provider().send("proj", message)).rejects.toBeInstanceOf(DeliveryFailedError);
  });

  it("fails on a refusal, and keeps the upstream reason out of the public message", async () => {
    stubFetch(
      400,
      JSON.stringify({ message: "Email address is not verified in region US-EAST-1" }),
    );

    const error = await provider()
      .send("proj", message)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DeliveryFailedError);
    const failure = error as DeliveryFailedError;
    expect(failure.message).not.toContain("US-EAST-1");
    expect(JSON.stringify(failure.detail)).toContain("not verified");
  });

  it("reports a request that never completed as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("socket hang up"))),
    );
    await expect(provider().send("proj", message)).rejects.toBeInstanceOf(DeliveryFailedError);
  });
});
