import { describe, expect, it } from "vitest";
import { Idenzy } from "../src/idenzy-native-js.js";
import { type JsonCarrier, jsonBridge } from "../src/json-bridge.js";

/** The native JSON bridge as it answers, recording what JavaScript sent. */
class FakeCarrier implements JsonCarrier {
  readonly sent: { method: string; argumentsJson: string }[] = [];
  readonly reports = new Set<(json: string) => void>();

  constructor(private readonly answer: (method: string) => string = () => '{"ok":null}') {}

  call(method: string, argumentsJson: string, done: (json: string) => void): void {
    this.sent.push({ method, argumentsJson });
    done(this.answer(method));
  }

  watchStatus(report: (json: string) => void): () => void {
    this.reports.add(report);
    return () => this.reports.delete(report);
  }

  send(json: string): void {
    for (const report of this.reports) report(json);
  }
}

const options = { publishableKey: "pk_test_1", apiUrl: "https://auth.example.test" };

const configure = (opts: typeof options, carrier: JsonCarrier) =>
  Idenzy.configure(opts, jsonBridge(carrier));

describe("a JSON carrier", () => {
  it("sends the arguments as JSON, nulls included", async () => {
    const carrier = new FakeCarrier();
    await configure(options, carrier);
    expect(carrier.sent).toEqual([
      {
        method: "configure",
        argumentsJson:
          '{"publishableKey":"pk_test_1","apiUrl":"https://auth.example.test","deviceName":null}',
      },
    ]);
  });

  it("reads a refusal out of the JSON with its details", async () => {
    const client = await configure(
      options,
      new FakeCarrier((method) =>
        method === "configure"
          ? '{"ok":null}'
          : '{"error":{"code":"rate_limited","message":"Slow down.","details":{"status":429,"retryAfterSeconds":30}}}',
      ),
    );
    await expect(client.getToken()).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it("reports an answer that is not JSON as an unexpected response, not a crash", async () => {
    const client = await configure(
      options,
      new FakeCarrier((method) => (method === "configure" ? '{"ok":null}' : "<html>")),
    );
    await expect(client.getToken()).rejects.toMatchObject({
      code: "provider_unavailable",
      transportReason: "unexpectedResponse",
    });
  });

  it("follows the status the native side reports, and skips one that does not parse", async () => {
    const carrier = new FakeCarrier();
    const client = await configure(options, carrier);
    carrier.send('{"status":"signedOut"}');
    carrier.send("not json");
    expect(client.status.status).toBe("signedOut");
  });
});
