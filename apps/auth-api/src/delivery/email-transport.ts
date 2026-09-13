import { AppConfig } from "@idenzy/config/app-config";
import { InternalError } from "@idenzy/core/errors";
import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  EmailProvider,
  SuppressionList,
  UsageMeter,
} from "@idenzy/domain/ports/email-provider";
import { LoggingEmailProvider } from "@idenzy/providers-email/logging-email-provider";
import { SesEmailProvider } from "@idenzy/providers-email/ses-email-provider";

/** The four that make an SES deployment, named once so the check and the build agree. */
const SES_KEYS = [
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "SES_CONFIGURATION_SET",
] as const;

/**
 * Which transport this deployment sends through (PROJECT.md 11.1).
 *
 * A factory in its own file rather than a lambda in the module, because the rule it
 * enforces is worth reading: **all four SES variables or none.** Three of the four does
 * not fail on its own — it falls through to the development logger, which then refuses to
 * construct outside development, and the operator sees a boot crash whose message is about
 * logging rather than about the variable they missed. Naming the missing ones is the
 * difference between a five-minute fix and an afternoon.
 *
 * The same pairing rule the webhook queue and the analytics store already use, for the same
 * reason: a partially configured integration is a mistake, never an intention.
 */
export function emailProviderFor(
  suppression: SuppressionList,
  meter: UsageMeter,
  logger: Logger,
  config: AppConfig,
  clock: Clock,
): EmailProvider {
  const present = SES_KEYS.filter((key) => config.get(key) !== undefined);

  if (present.length === SES_KEYS.length) {
    const accessKeyId = config.get("AWS_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = config.get("AWS_SECRET_ACCESS_KEY") ?? "";
    return new SesEmailProvider(suppression, meter, clock, {
      region: config.get("AWS_REGION") ?? "",
      configurationSet: config.get("SES_CONFIGURATION_SET") ?? "",
      // Static for now, and read once at boot. When federation lands this becomes a call
      // that refreshes, which is why the port is a function and not a value.
      credentials: () => Promise.resolve({ accessKeyId, secretAccessKey }),
    });
  }

  if (present.length > 0) {
    throw new InternalError({
      detail: {
        reason: "SES is partly configured",
        missing: SES_KEYS.filter((key) => config.get(key) === undefined),
        rule: "all four SES variables or none (PROJECT.md 11.1)",
      },
    });
  }

  return new LoggingEmailProvider(suppression, meter, logger, config.get("IDENZY_ENV"));
}
