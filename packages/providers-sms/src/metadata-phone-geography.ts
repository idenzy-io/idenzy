import type { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import type { PhoneGeography, PhonePlacement } from "@idenzy/domain/ports/sms-provider";
import { parsePhoneNumberWithError } from "libphonenumber-js/max";

const UNPLACEABLE: PhonePlacement = { country: null, premiumRate: false };

/**
 * Places a number using libphonenumber's metadata (PROJECT.md 4.8).
 *
 * The `max` metadata is the point of the dependency and not an oversight about size.
 * The `min` set cannot separate the countries that share a calling code, and +1 alone
 * covers twenty of them: a project allowing US would be allowing every Caribbean range
 * on the same prefix, which is where pumping schemes live. Nothing here reaches a
 * browser, so the only cost of the larger set is a few hundred kilobytes in a container.
 *
 * A number we cannot place comes back as a null country and no premium-rate claim. The
 * guard refuses it, which is the honest reading: "unknown" is not "fine".
 */
export class MetadataPhoneGeography implements PhoneGeography {
  place(to: E164PhoneNumber): PhonePlacement {
    try {
      const parsed = parsePhoneNumberWithError(to.value);
      const type = parsed.getType();
      return {
        country: parsed.country ?? null,
        // SHARED_COST is here because it is paid for the same way, and because a range
        // nobody signs in from has nothing to lose by being refused.
        premiumRate: type === "PREMIUM_RATE" || type === "SHARED_COST",
      };
    } catch {
      // The number already passed E.164 parsing, so this is metadata disagreeing with
      // us rather than a malformed input. Unplaceable is the answer either way.
      return UNPLACEABLE;
    }
  }
}
