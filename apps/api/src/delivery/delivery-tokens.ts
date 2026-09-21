/**
 * Injection tokens for the delivery ports that are interfaces rather than classes.
 *
 * Same reason as `flow-tokens.ts`: neither `PhoneGeography` nor `AttestationVerifier`
 * has shared logic that would justify an abstract class (PROJECT.md 7.2.6), and an
 * interface erases at runtime and cannot be a Nest token on its own.
 */
export const PHONE_GEOGRAPHY = Symbol.for("idenzy:phone-geography");
export const ATTESTATION_VERIFIER = Symbol.for("idenzy:attestation-verifier");
export const SMS_SENDER = Symbol.for("idenzy:sms-sender");
