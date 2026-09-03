import { z } from "zod";
import { challengeIdSchema, isoDateTimeSchema } from "./common.js";

/**
 * The WebAuthn wire types, declared here rather than imported from a library.
 *
 * `@idenzy/protocol` is the only true leaf in the tree (PROJECT.md 8.3) and it is what
 * every SDK generates from, so the shapes a browser posts to us have to be described in
 * the same Zod dialect as everything else. The server's verifier is a separate concern
 * and its types never reach the wire.
 *
 * The field names are the W3C ones verbatim, because these objects are handed to and
 * returned from `navigator.credentials` with no translation step in between. A
 * friendlier name here would mean every SDK owning a mapping that can drift.
 */

/** Base64url as the browser encodes it. No padding, and never empty. */
const base64Url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

/** 1023 bytes is the credential id ceiling in the spec; base64url of that is 1364. */
export const credentialIdSchema = base64Url(1364);

/**
 * Generous on purpose: a packed attestation carrying a certificate chain is the largest
 * thing a browser will post here, and rejecting a legitimate authenticator for being
 * verbose is a worse failure than accepting a few kilobytes we then refuse to parse.
 */
const attestationObjectSchema = base64Url(16_384);
const signedBlobSchema = base64Url(4096);

/**
 * Transport hints, kept as free strings.
 *
 * The registry grows (hybrid and smart-card postdate the first passkey shipments), and
 * a hint we do not recognise is still worth storing and echoing back: it costs nothing
 * and an enum here would reject tomorrow's authenticator for no security benefit.
 */
const transportSchema = z.array(z.string().max(32)).max(8);

const credentialDescriptorSchema = z.object({
  id: credentialIdSchema,
  type: z.literal("public-key"),
  transports: transportSchema.optional(),
});

/** COSE algorithm identifiers are negative integers (ES256 is -7). */
const credentialParametersSchema = z.object({
  type: z.literal("public-key"),
  alg: z.number().int(),
});

export const authenticatorSelectionSchema = z.object({
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  residentKey: z.enum(["discouraged", "preferred", "required"]).optional(),
  requireResidentKey: z.boolean().optional(),
  userVerification: z.enum(["discouraged", "preferred", "required"]).optional(),
});

/** What `navigator.credentials.create()` takes, as JSON. */
export const publicKeyCredentialCreationOptionsSchema = z.object({
  rp: z.object({ id: z.string().max(253), name: z.string().max(200) }),
  user: z.object({
    id: base64Url(256),
    name: z.string().max(320),
    displayName: z.string().max(320),
  }),
  challenge: base64Url(512),
  pubKeyCredParams: z.array(credentialParametersSchema).min(1),
  timeout: z.number().int().positive().optional(),
  excludeCredentials: z.array(credentialDescriptorSchema).max(100).optional(),
  authenticatorSelection: authenticatorSelectionSchema.optional(),
  attestation: z.enum(["none", "indirect", "direct", "enterprise"]).optional(),
});

/** What `navigator.credentials.get()` takes, as JSON. */
export const publicKeyCredentialRequestOptionsSchema = z.object({
  challenge: base64Url(512),
  timeout: z.number().int().positive().optional(),
  rpId: z.string().max(253),
  allowCredentials: z.array(credentialDescriptorSchema).max(100).optional(),
  userVerification: z.enum(["discouraged", "preferred", "required"]).optional(),
});

/**
 * The attestation a browser posts back after `create()`.
 *
 * `clientExtensionResults` is deliberately absent. The browser fills it in, nothing in
 * it is authenticated by the authenticator's signature, and the one field anybody wants
 * from it (`credProps.rk`) is answered more honestly by the backup-eligibility flag in
 * the signed authenticator data. Accepting a field we would have to ignore invites
 * somebody to trust it later.
 */
export const registrationResponseSchema = z.object({
  id: credentialIdSchema,
  rawId: credentialIdSchema,
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  response: z.object({
    clientDataJSON: base64Url(4096),
    attestationObject: attestationObjectSchema,
    transports: transportSchema.optional(),
  }),
});

/** The assertion a browser posts back after `get()`. */
export const authenticationResponseSchema = z.object({
  id: credentialIdSchema,
  rawId: credentialIdSchema,
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  response: z.object({
    clientDataJSON: base64Url(4096),
    authenticatorData: signedBlobSchema,
    signature: signedBlobSchema,
    /**
     * Present when the authenticator used a discoverable credential, which for us is
     * always: it is the user handle we chose at registration, and the server checks it
     * against the credential's owner rather than trusting it to name one.
     */
    userHandle: base64Url(256).optional(),
  }),
});

export const finishPasskeyRegistrationSchema = z.object({
  challengeId: challengeIdSchema,
  response: registrationResponseSchema,
  name: z.string().min(1).max(100).optional(),
});

/**
 * Finishing a passkey sign-in.
 *
 * There is no schema for starting one, because starting one carries nothing: an options
 * request that accepted an email would have to answer differently for an address with
 * passkeys and one without, which is an account-enumeration oracle sitting in front of
 * the flow we promote as the default. Requiring discoverable credentials costs us
 * `allowCredentials` and buys back both silence and conditional UI (PROJECT.md 4.7).
 */
export const finishPasskeyAuthenticationSchema = z.object({
  challengeId: challengeIdSchema,
  response: authenticationResponseSchema,
});

export const passkeyRegistrationOptionsSchema = z.object({
  challengeId: challengeIdSchema,
  expiresAt: isoDateTimeSchema,
  publicKey: publicKeyCredentialCreationOptionsSchema,
});

export const passkeyAuthenticationOptionsSchema = z.object({
  challengeId: challengeIdSchema,
  expiresAt: isoDateTimeSchema,
  publicKey: publicKeyCredentialRequestOptionsSchema,
});

/**
 * An enrolled passkey as its owner sees it.
 *
 * The credential id is not included. It identifies a physical authenticator, the owner
 * cannot do anything with it that our own id does not do, and putting it in a list
 * response is how it ends up in a customer's logs.
 */
export const passkeySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  transports: z.array(z.string()),
  /** True when the credential syncs to a provider's cloud, from the signed BE flag. */
  backupEligible: z.boolean(),
  backedUp: z.boolean(),
  createdAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
});

export const passkeyListSchema = z.object({
  passkeys: z.array(passkeySchema),
});

export const renamePasskeySchema = z.object({
  name: z.string().min(1).max(100),
});

export type PublicKeyCredentialCreationOptions = z.infer<
  typeof publicKeyCredentialCreationOptionsSchema
>;
export type PublicKeyCredentialRequestOptions = z.infer<
  typeof publicKeyCredentialRequestOptionsSchema
>;
export type RegistrationResponse = z.infer<typeof registrationResponseSchema>;
export type AuthenticationResponse = z.infer<typeof authenticationResponseSchema>;
export type FinishPasskeyRegistration = z.infer<typeof finishPasskeyRegistrationSchema>;
export type FinishPasskeyAuthentication = z.infer<typeof finishPasskeyAuthenticationSchema>;
export type PasskeyRegistrationOptions = z.infer<typeof passkeyRegistrationOptionsSchema>;
export type PasskeyAuthenticationOptions = z.infer<typeof passkeyAuthenticationOptionsSchema>;
export type Passkey = z.infer<typeof passkeySchema>;
export type PasskeyList = z.infer<typeof passkeyListSchema>;
export type RenamePasskey = z.infer<typeof renamePasskeySchema>;
