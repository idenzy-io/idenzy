import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";

/**
 * The user handle an authenticator stores alongside a discoverable credential.
 *
 * It is the user's public id as bytes, and nothing more. WebAuthn wants an opaque byte
 * string that is stable for the account and carries no personal data, which the public
 * id already is: an encoding of the row's uuid that a support ticket can quote safely.
 * The alternative, a second random identifier stored per user, would be one more column
 * that has to stay in step with the first for no property we do not already have.
 *
 * It is never used to decide who is signing in. The credential id does that, because it
 * is unique within the project and is what the signature is bound to; the handle is
 * checked against the credential's owner and refused on a mismatch.
 */
export function encodeUserHandle(userId: string): string {
  return Buffer.from(PublicId.encode(IdPrefix.User, userId).value, "utf8").toString("base64url");
}

/** Null for anything that is not one of ours, which the caller treats as a mismatch. */
export function decodeUserHandle(handle: string): string | null {
  try {
    const decoded = Buffer.from(handle, "base64url").toString("utf8");
    return PublicId.parse(IdPrefix.User, decoded).uuid;
  } catch {
    return null;
  }
}
