import type { JsonCarrier } from "@idenzy/native-js/json-bridge";
import { describe, expect, it } from "vitest";
import { configure } from "../src/idenzy-nativescript.js";

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

describe("the NativeScript carrier", () => {
  it("configures the native SDK through the carrier, in JSON", async () => {
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
});
