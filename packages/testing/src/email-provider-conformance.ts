import { strict as assert } from "node:assert";
import type {
  EmailProvider,
  OutboundEmail,
  SuppressionList,
  UsageMeter,
} from "@idenzy/domain/ports/email-provider";
import type { Channel } from "@idenzy/protocol/enums/delivery";
import { ConformanceSuite } from "./conformance-suite.js";

const PROJECT = "3f2b9c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";

/**
 * An adapter builds one of these from its own transport, and the suite supplies the two
 * collaborators the base class is supposed to consult.
 *
 * A factory rather than an instance, because every case needs a provider wired to a
 * different suppression and quota state, and a shared one would let an earlier case
 * decide a later one.
 */
export type EmailProviderFactory = (
  suppression: SuppressionList,
  meter: UsageMeter,
) => EmailProvider;

class Recorder implements UsageMeter {
  readonly recorded: { channel: Channel; meta: Readonly<Record<string, unknown>> }[] = [];
  constructor(private readonly withinQuota: boolean) {}

  assertWithinQuota(_projectId: string, channel: Channel): Promise<void> {
    if (this.withinQuota) return Promise.resolve();
    return Promise.reject(new QuotaExhausted(channel));
  }

  record(
    _projectId: string,
    channel: Channel,
    meta: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.recorded.push({ channel, meta });
    return Promise.resolve();
  }
}

/**
 * Marker failures, thrown by the doubles rather than by the code under test.
 *
 * They are not IdenzyErrors on purpose: a case asserts that the base propagated the
 * check's own rejection, so it must be able to tell that rejection apart from any error
 * the adapter might raise on its own.
 */
class QuotaExhausted extends Error {
  constructor(readonly channel: Channel) {
    super("quota exhausted");
  }
}

class Suppressed extends Error {
  constructor(readonly target: string) {
    super("suppressed");
  }
}

class Allowing implements SuppressionList {
  assertSendable(): Promise<void> {
    return Promise.resolve();
  }
}

class Refusing implements SuppressionList {
  assertSendable(_projectId: string, target: string): Promise<void> {
    return Promise.reject(new Suppressed(target));
  }
}

function message(to = "recipient@example.test"): OutboundEmail {
  return {
    to,
    from: "no-reply@auth.example.test",
    subject: "Conformance",
    html: "<p>Conformance</p>",
    text: "Conformance",
  };
}

/**
 * The suite every email adapter must pass before it can be registered
 * (PROJECT.md 7.4, 11.1).
 *
 * It does not test transport. It tests that the adapter still inherits the guarantees
 * the base owns, which is the thing a new provider actually breaks: someone overrides
 * `send` instead of `dispatch` to add a header, and a year later an address that
 * hard-bounced in March is being mailed weekly and nobody can work out why the shared
 * domain's reputation collapsed.
 *
 * Run it against a transport that does not leave the process. A sandbox endpoint is
 * fine; production credentials are not, because case three sends successfully.
 */
export class EmailProviderConformanceSuite extends ConformanceSuite<EmailProviderFactory> {
  override readonly familyName = "EmailProvider";

  protected override defineCases() {
    return [
      {
        name: "refuses a suppressed address and spends nothing",
        run: async ({ subject }: { subject: EmailProviderFactory }) => {
          const meter = new Recorder(true);
          const provider = subject(new Refusing(), meter);
          await assert.rejects(
            () => provider.send(PROJECT, message("bounced@example.test")),
            (error: unknown) => error instanceof Suppressed,
            "send resolved for a suppressed address, so the base check was bypassed",
          );
          assert.equal(meter.recorded.length, 0, "a refused send was still metered");
        },
      },
      {
        name: "refuses once the quota is exhausted",
        run: async ({ subject }: { subject: EmailProviderFactory }) => {
          const meter = new Recorder(false);
          const provider = subject(new Allowing(), meter);
          await assert.rejects(
            () => provider.send(PROJECT, message()),
            (error: unknown) => error instanceof QuotaExhausted,
            "send resolved with no quota left",
          );
          assert.equal(meter.recorded.length, 0, "a refused send was still metered");
        },
      },
      {
        name: "returns a message id and meters exactly one email on success",
        run: async ({ subject }: { subject: EmailProviderFactory }) => {
          const meter = new Recorder(true);
          const provider = subject(new Allowing(), meter);
          const messageId = await provider.send(PROJECT, message());

          assert.ok(messageId.length > 0, "an adapter must return a provider message id");
          assert.equal(meter.recorded.length, 1, "a successful send must be metered once");
          const [only] = meter.recorded;
          assert.equal(only?.channel, "email");
          assert.equal(
            only?.meta["provider"],
            provider.id,
            "the usage record must name the provider that sent it",
          );
          assert.equal(
            only?.meta["messageId"],
            messageId,
            "the usage record must carry the id the caller was given",
          );
        },
      },
      {
        /**
         * Suppression is checked before quota, so an address we must never write to
         * again is refused for that reason even on a project that has run out of
         * allowance. The ordering matters because the two errors tell a customer to do
         * completely different things.
         */
        name: "reports suppression rather than quota when both apply",
        run: async ({ subject }: { subject: EmailProviderFactory }) => {
          const provider = subject(new Refusing(), new Recorder(false));
          await assert.rejects(
            () => provider.send(PROJECT, message("bounced@example.test")),
            (error: unknown) => error instanceof Suppressed,
            "quota was checked before suppression",
          );
        },
      },
    ];
  }
}
