/**
 * GSM 03.38, the alphabet a carrier can pack seven bits to a character.
 *
 * A message made entirely of these characters fits 160 of them in one segment. One
 * character outside it drops the whole message to UCS-2 and 70, which is why a curly
 * apostrophe in a template is a costing decision and not a typographic one.
 */
const GSM7_BASIC = new Set(
  [
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?",
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ]
    .join("")
    .split(""),
);

/** Characters that exist in GSM-7 only as an escape pair, so they cost two septets. */
const GSM7_EXTENDED = new Set(["\f", "^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

const GSM7_SINGLE = 160;
const GSM7_CONCATENATED = 153;
const UCS2_SINGLE = 70;
const UCS2_CONCATENATED = 67;

export type SmsEncoding = "gsm-7" | "ucs-2";

export interface SmsLength {
  readonly encoding: SmsEncoding;
  /** Billable units: septets for GSM-7, UTF-16 code units for UCS-2. */
  readonly units: number;
  readonly segments: number;
}

/**
 * What a body will cost to send (PROJECT.md 11.4).
 *
 * Segments are the billing unit, not characters, and the two do not move together: 161
 * plain characters cost twice as much as 160, and a single emoji costs the same as 90
 * extra letters because it forces the whole message into UCS-2. A template that gained a
 * word in translation and quietly doubled every OTP is the failure this exists to make
 * visible, so the number is computed at render time and carried on the result rather
 * than checked in a review.
 *
 * Nothing here throws. Refusing to deliver a sign-in code because the copy is long is a
 * worse outcome than paying for two segments; the caller meters what it is told.
 */
export function measure(body: string): SmsLength {
  let units = 0;
  let gsm7 = true;

  for (const character of body) {
    if (GSM7_BASIC.has(character)) {
      units += 1;
      continue;
    }
    if (GSM7_EXTENDED.has(character)) {
      units += 2;
      continue;
    }
    gsm7 = false;
    break;
  }

  if (!gsm7) {
    // Surrogate pairs count as two, which is what a carrier counts, so the length of
    // the string in UTF-16 code units is exactly right here.
    const units16 = body.length;
    return {
      encoding: "ucs-2",
      units: units16,
      segments: segmentsFor(units16, UCS2_SINGLE, UCS2_CONCATENATED),
    };
  }

  return {
    encoding: "gsm-7",
    units,
    segments: segmentsFor(units, GSM7_SINGLE, GSM7_CONCATENATED),
  };
}

/**
 * A concatenated message spends part of every segment on the header that says how the
 * parts reassemble, which is why the second segment does not double the first's capacity.
 */
function segmentsFor(units: number, single: number, concatenated: number): number {
  if (units === 0) return 0;
  if (units <= single) return 1;
  return Math.ceil(units / concatenated);
}
