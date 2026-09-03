import { strict as assert } from "node:assert";
import { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import type {
  FraudGuard,
  Money,
  SendContext,
  SmsProvider,
  SpendCap,
} from "@idenzy/domain/ports/sms-provider";
import { ConformanceSuite } from "./conformance-suite.js";

const CONTEXT: SendContext = {
  projectId: "3f2b9c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b",
  requestId: "req_conformance",
  ip: "203.0.113.7",
  attestation: null,
};

const TO = E164PhoneNumber.parse("+14155550123");

/**
 * An adapter builds one of these from its own transport, and the suite supplies the two
 * collaborators the base class is supposed to consult.
 *
 * A factory rather than an instance, because every case needs a provider wired to a
 * different guard and cap, and a shared one would let an earlier case decide a later one.
 */
export type SmsProviderFactory = (fraudGuard: FraudGuard, spendCap: SpendCap) => SmsProvider;

/**
 * Marker failures, thrown by the doubles rather than by the code under test.
 *
 * They are not IdenzyErrors on purpose: a case asserts that the base propagated the
 * check's own rejection, so it must be able to tell that rejection apart from any error
 * the adapter might raise on its own.
 */
class Refused extends Error {
  constructor() {
    super("fraud guard refused");
  }
}

class CapReached extends Error {
  constructor() {
    super("spend cap reached");
  }
}

class Allowing implements FraudGuard {
  assertAllowed(): Promise<void> {
    return Promise.resolve();
  }
}

class Refusing implements FraudGuard {
  assertAllowed(): Promise<void> {
    return Promise.reject(new Refused());
  }
}

class Ledger implements SpendCap {
  readonly reserved: Money[] = [];
  readonly settled: { reserved: Money; actual: Money }[] = [];
  constructor(private readonly capacity: boolean) {}

  reserve(_projectId: string, cost: Money): Promise<void> {
    if (!this.capacity) return Promise.reject(new CapReached());
    this.reserved.push(cost);
    return Promise.resolve();
  }

  settle(_projectId: string, reserved: Money, actual: Money): Promise<void> {
    this.settled.push({ reserved, actual });
    return Promise.resolve();
  }
}

/**
 * The suite every SMS adapter must pass before it can be registered
 * (PROJECT.md 7.4, 11.1).
 *
 * It does not test transport, and it is not really about the adapter: it is about the
 * ordering in `SmsProvider.send`, which is the only thing standing between a pumping
 * scheme and our bill. The way that ordering is lost is always the same, an adapter
 * overriding `send` instead of `dispatch` to add a header, and the cost of losing it is
 * not a broken feature but an invoice nobody notices until the month closes.
 *
 * Run it against a transport that does not leave the process. Case three dispatches.
 */
export class SmsProviderConformanceSuite extends ConformanceSuite<SmsProviderFactory> {
  override readonly familyName = "SmsProvider";

  protected override defineCases() {
    return [
      {
        name: "refuses what the fraud guard refuses, and reserves nothing",
        run: async ({ subject }: { subject: SmsProviderFactory }) => {
          const ledger = new Ledger(true);
          const provider = subject(new Refusing(), ledger);
          await assert.rejects(
            () => provider.send(CONTEXT, TO, "Your code is 123456", "Idenzy"),
            (error: unknown) => error instanceof Refused,
            "send resolved past a refusing fraud guard, so the base check was bypassed",
          );
          assert.equal(ledger.reserved.length, 0, "a refused send still reserved spend");
        },
      },
      {
        name: "refuses once the spend cap is reached",
        run: async ({ subject }: { subject: SmsProviderFactory }) => {
          const ledger = new Ledger(false);
          const provider = subject(new Allowing(), ledger);
          await assert.rejects(
            () => provider.send(CONTEXT, TO, "Your code is 123456", "Idenzy"),
            (error: unknown) => error instanceof CapReached,
            "send resolved with no spend left",
          );
          assert.equal(ledger.settled.length, 0, "a send that never happened was settled");
        },
      },
      {
        /**
         * The reservation has to be quoted before the message goes out, not after. An
         * adapter that dispatches first and reserves afterwards passes every other case
         * here and still spends unbounded money on the day the cap matters.
         */
        name: "quotes and reserves before it dispatches, and settles after",
        run: async ({ subject }: { subject: SmsProviderFactory }) => {
          const ledger = new Ledger(true);
          const provider = subject(new Allowing(), ledger);
          const messageId = await provider.send(CONTEXT, TO, "Your code is 123456", "Idenzy");

          assert.ok(messageId.length > 0, "an adapter must return a provider message id");
          assert.equal(ledger.reserved.length, 1, "a successful send must reserve exactly once");
          assert.equal(ledger.settled.length, 1, "a successful send must settle exactly once");

          const [settlement] = ledger.settled;
          const [reserved] = ledger.reserved;
          assert.deepEqual(
            settlement?.reserved,
            reserved,
            "settle must be told which reservation it corrects",
          );
          assert.equal(
            settlement?.actual.currency,
            reserved?.currency,
            "an adapter must settle in the currency it quoted",
          );
        },
      },
      {
        /**
         * A quote is what the cap is checked against, so it has to be answerable without
         * sending anything. An adapter that quotes by asking the provider to price a
         * message it has already accepted has no quote at all.
         */
        name: "quotes a destination without sending to it",
        run: async ({ subject }: { subject: SmsProviderFactory }) => {
          const ledger = new Ledger(true);
          const provider = subject(new Allowing(), ledger);
          const cost = await provider.quoteCost(TO);

          assert.ok(Number.isFinite(cost.amountMicros), "a quote must be a finite amount");
          assert.ok(cost.amountMicros >= 0, "a quote must not be negative");
          assert.equal(cost.currency.length, 3, "a quote must name an ISO 4217 currency");
          assert.equal(ledger.reserved.length, 0, "quoting reserved spend");
        },
      },
      {
        /**
         * Fraud is checked before the quote, so a destination the project does not serve
         * is refused for that reason rather than priced first. The ordering is what stops
         * a quote endpoint becoming the unmetered half of the send path.
         */
        name: "reports the fraud refusal rather than the cap when both apply",
        run: async ({ subject }: { subject: SmsProviderFactory }) => {
          const provider = subject(new Refusing(), new Ledger(false));
          await assert.rejects(
            () => provider.send(CONTEXT, TO, "Your code is 123456", "Idenzy"),
            (error: unknown) => error instanceof Refused,
            "the spend cap was consulted before the fraud guard",
          );
        },
      },
    ];
  }
}
