import { randomUUID } from "node:crypto";
import { InternalError } from "@idenzy/core/errors";
import type { Logger } from "@idenzy/core/logging/logger";
import {
  EmailProvider,
  type OutboundEmail,
  type SuppressionList,
  type UsageMeter,
} from "@idenzy/domain/ports/email-provider";

/**
 * A transport that delivers nothing and prints everything, for local development.
 *
 * Until a real adapter is configured, an OTP has to reach the developer somehow, and the
 * alternative to this is a hardcoded code in a test seam that eventually ships. Here the
 * code is visible only in the process's own output.
 *
 * The mail goes in the log *message*, not in fields, because fields are allowlisted and
 * a recipient address is exactly the kind of thing that allowlist exists to drop
 * (PROJECT.md 4.13.8). Writing it into the message is deliberate, and it is why the
 * constructor refuses to build outside development: this class must be impossible to
 * enable by configuration on a deployed environment.
 */
export class LoggingEmailProvider extends EmailProvider {
  override readonly id = "logging";

  constructor(
    suppression: SuppressionList,
    meter: UsageMeter,
    private readonly logger: Logger,
    environment: string,
  ) {
    super(suppression, meter);
    if (environment !== "development") {
      throw new InternalError({
        detail: {
          reason: "the logging email transport prints message bodies and is development only",
          environment,
        },
      });
    }
  }

  protected override dispatch(message: OutboundEmail): Promise<string> {
    const messageId = `log_${randomUUID()}`;
    this.logger.info(
      [
        "",
        "──── email (development transport, nothing was sent) ────",
        `to:      ${message.to}`,
        `from:    ${message.from}`,
        `subject: ${message.subject}`,
        "",
        message.text,
        "─────────────────────────────────────────────────────────",
      ].join("\n"),
    );
    return Promise.resolve(messageId);
  }
}
