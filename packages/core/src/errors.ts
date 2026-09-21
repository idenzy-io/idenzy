import { ErrorCode } from "@idenzy/protocol/errors/codes";
import type { ErrorOptions } from "./errors/idenzy-error.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PaymentRequiredError,
  ServerError,
  TooManyRequestsError,
  UnauthorizedError,
  UpstreamError,
} from "./errors/status-errors.js";

export class ValidationFailedError extends BadRequestError {
  override readonly code = ErrorCode.ValidationFailed;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The request body failed validation.", options);
  }
}

export class UnknownProjectError extends NotFoundError {
  override readonly code = ErrorCode.UnknownProject;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "No project matches this host or key.", options);
  }
}

export class ResourceNotFoundError extends NotFoundError {
  override readonly code = ErrorCode.NotFound;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Not found.", options);
  }
}

export class ResourceConflictError extends ConflictError {
  override readonly code = ErrorCode.Conflict;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That resource already exists.", options);
  }
}

export class MissingCredentialsError extends UnauthorizedError {
  override readonly code = ErrorCode.MissingCredentials;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "No credentials were presented.", options);
  }
}

export class InvalidApiKeyError extends UnauthorizedError {
  override readonly code = ErrorCode.InvalidApiKey;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The API key is invalid or revoked.", options);
  }
}

export class InsufficientScopeError extends ForbiddenError {
  override readonly code = ErrorCode.InsufficientScope;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This key lacks the required scope.", options);
  }
}

/**
 * A secret key arrived on the browser-facing header.
 *
 * 403 rather than 401, which matters to the SDK: a 401 invites it to refresh and retry, and
 * there is nothing here to retry. Identity was established and the placement is what is
 * refused. Thrown on the prefix alone, before any lookup, so a real secret key and a
 * fabricated one are indistinguishable in both body and timing.
 */
export class SecretKeyNotPermittedError extends ForbiddenError {
  override readonly code = ErrorCode.SecretKeyNotPermitted;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "A secret key cannot be used from a browser.", options);
  }
}

/** The request's Origin is not on the project's allowlist (PROJECT.md 4.3). */
export class OriginNotAllowedError extends ForbiddenError {
  override readonly code = ErrorCode.OriginNotAllowed;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That origin is not registered for this project.", options);
  }
}

/**
 * Double-submit, Origin or Fetch-Metadata refused a cookie-mode request.
 *
 * Thrown before anything is consumed, which is the property worth having: a CSRF attempt must
 * not burn the victim's refresh token, because that would trip reuse detection and hand an
 * attacker a way to sign someone out by forging a single request.
 */
export class CsrfCheckFailedError extends ForbiddenError {
  override readonly code = ErrorCode.CsrfCheckFailed;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This request failed its cross-site checks.", options);
  }
}

/**
 * Cookie mode was asked for where it cannot work.
 *
 * Said plainly rather than honoured, because a `__Host-` cookie the browser will drop looks
 * to the customer exactly like a sign-in that silently does nothing. The SDK reads this and
 * falls back to header mode.
 */
export class SessionTransportUnavailableError extends BadRequestError {
  override readonly code = ErrorCode.SessionTransportUnavailable;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Cookie mode is not available for this project.", options);
  }
}

/**
 * Deliberately identical for "no such user" and "wrong password", and thrown after the
 * same amount of work in both cases (PROJECT.md 4.5). Do not add a distinguishing
 * message or a fast path.
 */
export class InvalidCredentialsError extends UnauthorizedError {
  override readonly code = ErrorCode.InvalidCredentials;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Invalid email or password.", options);
  }
}

/**
 * A ban is a deliberate state, so unlike InvalidCredentials it says so: the account
 * holder needs to know why they cannot get in, and an attacker learns nothing they
 * could not learn by trying a correct password.
 */
export class AccountBannedError extends ForbiddenError {
  override readonly code = ErrorCode.AccountBanned;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This account is suspended.", options);
  }
}

/** Thrown only where the project requires verification before a session, never at sign-up. */
export class EmailNotVerifiedError extends ForbiddenError {
  override readonly code = ErrorCode.EmailNotVerified;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This email address is not verified.", options);
  }
}

/**
 * The password appears in a known breach corpus (PROJECT.md 4.5). Raised at sign-up and
 * reset, never at sign-in: refusing an existing password at the door locks the user out
 * of their own account without giving them a way back in.
 */
export class PasswordBreachedError extends BadRequestError {
  override readonly code = ErrorCode.PasswordBreached;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This password has appeared in a data breach.", options);
  }
}

/**
 * The bearer token is malformed, unsigned by us, or for another issuer or audience.
 *
 * Separate from SessionExpired because the client's response differs: an expired token
 * is refreshed, an invalid one means start again. Never says which check failed.
 */
export class AccessTokenInvalidError extends UnauthorizedError {
  override readonly code = ErrorCode.AccessTokenInvalid;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The access token is not valid.", options);
  }
}

export class SessionExpiredError extends UnauthorizedError {
  override readonly code = ErrorCode.SessionExpired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The session has expired.", options);
  }
}

export class RefreshTokenInvalidError extends UnauthorizedError {
  override readonly code = ErrorCode.RefreshTokenInvalid;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The refresh token is not valid.", options);
  }
}

/**
 * Reuse of an already-rotated refresh token. Throwing this must also revoke the whole
 * family and emit a security event; the error alone is not the mitigation
 * (PROJECT.md 4.2).
 */
export class RefreshTokenReusedError extends UnauthorizedError {
  override readonly code = ErrorCode.RefreshTokenReused;
  constructor(options: ErrorOptions = {}) {
    super(
      options.message ?? "This refresh token was already used. The session is revoked.",
      options,
    );
  }
}

export class SessionRevokedError extends UnauthorizedError {
  override readonly code = ErrorCode.SessionRevoked;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The session was revoked.", options);
  }
}

export class ReauthenticationRequiredError extends ForbiddenError {
  override readonly code = ErrorCode.ReauthenticationRequired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Re-authenticate to perform this action.", options);
  }
}

/**
 * A second factor is owed and no challenge could stand in for it.
 *
 * The ordinary case is not an error at all: a flow that owes a factor answers with a
 * challenge (PROJECT.md 4.5). This is what is left over, which is a project that demands
 * a second factor from a user who has enrolled none, and there is nothing the client can
 * submit to get past it.
 */
export class MfaRequiredError extends ForbiddenError {
  override readonly code = ErrorCode.MfaRequired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "A second factor is required.", options);
  }
}

/**
 * A factor did not verify.
 *
 * One error for a wrong code, a code from the wrong time step, a code already spent, and
 * a factor the user never enrolled. The last is the one worth stating: a challenge that
 * answered differently for "you do not have that factor" would enumerate what somebody
 * holds to anyone who got past a first factor, which is exactly the position a stolen
 * password puts an attacker in.
 */
export class MfaFactorInvalidError extends BadRequestError {
  override readonly code = ErrorCode.MfaFactorInvalid;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That code is not correct.", options);
  }
}

/**
 * The user already has this factor, and enrolling a second would be ambiguous rather
 * than useful. Says so plainly: it is the caller's own account and they can see the list.
 */
export class MfaFactorAlreadyEnrolledError extends ConflictError {
  override readonly code = ErrorCode.MfaFactorAlreadyEnrolled;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That factor is already enrolled.", options);
  }
}

export class ChallengeExpiredError extends BadRequestError {
  override readonly code = ErrorCode.ChallengeExpired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This challenge has expired.", options);
  }
}

export class ChallengeInvalidError extends BadRequestError {
  override readonly code = ErrorCode.ChallengeInvalid;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That code is not correct.", options);
  }
}

/**
 * The attempt cap is reached, so the challenge is dead even though the code may still
 * be within its lifetime. Distinct from ChallengeInvalid because the client must stop
 * retrying and start a new challenge (PROJECT.md 4.7).
 */
export class ChallengeAttemptsExhaustedError extends BadRequestError {
  override readonly code = ErrorCode.ChallengeAttemptsExhausted;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Too many incorrect attempts. Request a new code.", options);
  }
}

/** The provider account already belongs to a different user in this project. */
export class IdentityAlreadyLinkedError extends ConflictError {
  override readonly code = ErrorCode.IdentityAlreadyLinked;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That account is already linked to another user.", options);
  }
}

/**
 * An unverified provider email matched an existing account (PROJECT.md 4.6). Linking on
 * that alone is the classic IdP account-takeover, so the customer's UI must send the
 * user through an email OTP first.
 */
export class LinkingRequiresVerificationError extends ForbiddenError {
  override readonly code = ErrorCode.LinkingRequiresVerification;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Verify this email address before linking the account.", options);
  }
}

/**
 * The callback carried a `state` we did not issue, or one already spent.
 *
 * Both are the same answer on purpose. A forged callback and a replayed one are the same
 * attack from our side, and telling them apart would confirm that a state was once real
 * (PROJECT.md 4.6).
 */
export class OauthStateInvalidError extends BadRequestError {
  override readonly code = ErrorCode.OauthStateInvalid;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This sign-in attempt is no longer valid.", options);
  }
}

/**
 * The provider refused, or answered with something we cannot use.
 *
 * Its own error code stays in `detail` and never reaches the response: a prober who can
 * read `invalid_client` back from us has been told something about our configuration
 * that they could not otherwise find out.
 */
export class OauthProviderError extends UpstreamError {
  override readonly code = ErrorCode.OauthProviderError;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The identity provider could not complete this sign-in.", options);
  }
}

/**
 * A WebAuthn ceremony did not verify.
 *
 * One error for every way it can fail: an unknown credential, a bad signature, a stale
 * challenge, an origin we do not serve, a sign counter that went backwards. The reason
 * lives in `detail` and is never returned, because the differences are exactly what an
 * attacker probing with forged assertions wants to learn, and none of them is something
 * a legitimate user can act on differently.
 */
export class WebauthnAssertionInvalidError extends BadRequestError {
  override readonly code = ErrorCode.WebauthnAssertionInvalid;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That passkey could not be verified.", options);
  }
}

/** Exact-match allowlist failure. Never echo the offending URI back (open-redirect bait). */
export class RedirectUriNotAllowedError extends BadRequestError {
  override readonly code = ErrorCode.RedirectUriNotAllowed;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That redirect URI is not registered for this project.", options);
  }
}

export class RateLimitedError extends TooManyRequestsError {
  override readonly code = ErrorCode.RateLimited;
  constructor(retryAfterSeconds: number, options: ErrorOptions = {}) {
    super(options.message ?? "Too many requests.", { ...options, retryAfterSeconds });
  }
}

/**
 * A human has not been proven to be behind this send (PROJECT.md 4.8).
 *
 * SMS is the one channel where a request costs us money before it reaches anybody, so a
 * project sending to it is asked for a CAPTCHA or an attestation first. The client can
 * recover: solve the challenge and send it again, which is why this is not RateLimited.
 */
export class AttestationRequiredError extends ForbiddenError {
  override readonly code = ErrorCode.AttestationRequired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This request needs a CAPTCHA or attestation token.", options);
  }
}

/**
 * The destination is outside the project's allowlist (PROJECT.md 4.8).
 *
 * A default-deny list, because the countries a product does not serve are exactly the
 * ones a pumping scheme sends to: the attacker picks the destination, and an allowlist
 * is the only control where they cannot.
 */
export class CountryNotAllowedError extends ForbiddenError {
  override readonly code = ErrorCode.CountryNotAllowed;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This project does not send to that destination.", options);
  }
}

/**
 * The project has switched this way in off.
 *
 * Forbidden rather than not-found: the endpoint exists and the request was well formed, and
 * a customer debugging their integration needs to be told the difference between "you are
 * calling the wrong thing" and "your own configuration refuses this".
 */
/**
 * The shared development sender has been used as though it were a production one.
 *
 * A 403 rather than a 429, and the distinction is the whole point of having its own code: a
 * rate limit says "try again later", which is true and useless. What this says is "go and
 * verify a sending domain", which is a thing the reader can do and the only thing that
 * makes the send work. The message is the entire teaching mechanism for the rule, so it
 * carries the instruction rather than the symptom.
 */
export class SendingDomainRequiredError extends ForbiddenError {
  override readonly code = ErrorCode.SendingDomainRequired;
  constructor(options: ErrorOptions = {}) {
    super(
      options.message ??
        "This project has no verified sending domain, so it is using the shared development sender. That sender is limited and is not for production traffic — verify a sending domain of your own to send without it.",
      options,
    );
  }
}

/**
 * This project's mail is stopped because its bounce or complaint rate is too high.
 *
 * A 403 for the same reason as the refusal above, and not a 429 for a sharper version of the
 * same one: waiting does not fix this. The rate is over a rolling window, so it only comes
 * down when the mail that is bouncing stops being sent — which means the remedy is the list,
 * not the clock.
 *
 * It applies to a project sending from its own verified domain as well, which surprises
 * people. The reputation being protected is not only the domain's: every message leaves
 * through one SES account, AWS reviews bounce and complaint rates per account, and a review
 * takes mail down for every customer at once — including the ones whose lists are clean.
 */
export class SendingPausedError extends ForbiddenError {
  override readonly code = ErrorCode.SendingPaused;
  constructor(options: ErrorOptions = {}) {
    super(
      options.message ??
        "Sending is paused for this project because too many of its recent messages bounced or were marked as spam. Clean the addresses you are sending to; sending resumes once the recent rate falls back under the threshold.",
      options,
    );
  }
}

/**
 * Out of credit, and past the tolerance that would have carried it.
 *
 * A 402 and not a 403: this is about money rather than about permission, and the caller's
 * remedy is to top up rather than to ask somebody for access. The detail names the channel
 * because only some of them stop — authentication, the dashboard, the API and mail on the
 * shared domain keep working whatever is owed (ADR-0014).
 */
export class WalletEmptyError extends PaymentRequiredError {
  override readonly code = ErrorCode.WalletEmpty;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This organisation has no credit left for that.", options);
  }
}

/**
 * This installation takes no payments, so there is nothing to charge.
 *
 * A 409 rather than a 500 or a 503: nothing is broken and nothing will recover on a retry.
 * The deployment is configured not to do this, the wallet says so through `provider: null`
 * before anybody presses anything, and a caller reaching the route anyway has asked for
 * something that is not on offer here.
 */
export class PaymentsUnavailableError extends ConflictError {
  override readonly code = ErrorCode.PaymentsUnavailable;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This deployment cannot take payments.", options);
  }
}

/** An automatic top-up with no card is a rule that cannot fire, which is worse than none. */
export class PaymentMethodRequiredError extends ConflictError {
  override readonly code = ErrorCode.PaymentMethodRequired;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "An automatic top-up needs a card on file.", options);
  }
}

export class SignInMethodDisabledError extends ForbiddenError {
  override readonly code = ErrorCode.SignInMethodDisabled;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This project does not allow that way of signing in.", options);
  }
}

/** Signing in with this method is allowed; creating an account with it is not. */
export class SignUpDisabledError extends ForbiddenError {
  override readonly code = ErrorCode.SignUpDisabled;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This project is not accepting new accounts here.", options);
  }
}

/**
 * Shorter than the project's own minimum.
 *
 * Distinct from the protocol's own floor, which `passwordSchema` enforces before anything
 * here runs: that one is what the product will ever accept, this one is what a customer has
 * chosen to demand.
 *
 * The number is in the *message*, which is the half of an error that reaches a client —
 * `detail` never does, deliberately, and a form that cannot say the minimum makes the user
 * guess at it. So this is one of the few places where the message carries a fact rather
 * than only a sentence, and `detail` repeats it for our own logs.
 */
export class PasswordTooShortError extends BadRequestError {
  override readonly code = ErrorCode.PasswordTooShort;
  constructor(minLength: number, options: ErrorOptions = {}) {
    super(options.message ?? `That password is shorter than ${String(minLength)} characters.`, {
      ...options,
      detail: { ...(options.detail ?? {}), minLength },
    });
  }
}

export class SpendCapReachedError extends ForbiddenError {
  override readonly code = ErrorCode.SpendCapReached;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The project spend cap for this channel is reached.", options);
  }
}

/**
 * A plan or per-project ceiling, not a burst. Distinct from RateLimited because there is
 * no retry-after that helps: the caller has to raise the quota or wait for the period.
 */
export class QuotaExceededError extends ForbiddenError {
  override readonly code = ErrorCode.QuotaExceeded;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The project quota for this channel is exhausted.", options);
  }
}

/**
 * The target hard-bounced or complained, so we will never send to it again
 * (PROJECT.md 11.1).
 *
 * Enforced in the `EmailProvider` base before any transport runs. Sending anyway is how
 * a shared sending domain's reputation is destroyed, and reputation is shared across
 * every project on it, so this is not a per-project decision to override.
 */
export class DeliverySuppressedError extends ForbiddenError {
  override readonly code = ErrorCode.DeliverySuppressed;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This address is suppressed and cannot be sent to.", options);
  }
}

/** The transport refused or failed. Retryable, unlike suppression. */
export class DeliveryFailedError extends UpstreamError {
  override readonly code = ErrorCode.DeliveryFailed;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "The message could not be delivered.", options);
  }
}

/**
 * The analytics store could not answer (ADR-0013).
 *
 * Its own code rather than `ProviderUnavailable`, because the two call for different behaviour on
 * a screen. A provider being down means a sign-in or a message did not happen; this means a chart
 * has no numbers while everything the customer is billed for carried on regardless — the figures a
 * bill rests on are in Postgres. A panel that treated them alike would report an outage for a
 * store nothing on the authentication path reads.
 */
export class AnalyticsUnavailableError extends UpstreamError {
  override readonly code = ErrorCode.AnalyticsUnavailable;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "Analytics are temporarily unavailable.", options);
  }
}

export class ProviderUnavailableError extends UpstreamError {
  override readonly code = ErrorCode.ProviderUnavailable;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "An upstream provider is unavailable.", options);
  }
}

/**
 * A token could not be issued as the project's claim template asks.
 *
 * A required claim resolved to nothing, or the rendered claims were larger than a token
 * may carry. Failing is the point: a claim a customer's authorisation code branches on is
 * one where absent and false read the same, so emitting the token without it would let a
 * sign-in through a check that never ran.
 *
 * 500 because nothing the end user did is wrong and nothing they can do will fix it. The
 * detail names the claim and reaches the customer's logs, never the response.
 */
export class ClaimTemplateUnsatisfiedError extends ServerError {
  override readonly code = ErrorCode.ClaimTemplateUnsatisfied;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "This project's token configuration could not be applied.", options);
  }
}

/**
 * A webhook delivery could not be verified, raised in a receiver's process and never by us.
 *
 * The only error in this file that our API cannot answer with: a delivery is a request we make, so
 * this is what the server SDK's verifier throws when the signature does not match, the timestamp
 * is outside the tolerance, or the body is not an event envelope. Those are one answer for the
 * receiver — 400 and do nothing — which is why they are one class rather than three.
 *
 * The reason is on `detail`, for the receiver's own logs. It is deliberately not offered as
 * separate codes: a receiver branching on "stale" versus "wrong digest" would be building retry
 * logic for a delivery it must simply refuse, and we retry it ourselves anyway.
 */
export class WebhookSignatureInvalidError extends BadRequestError {
  override readonly code = ErrorCode.WebhookSignatureInvalid;
  constructor(options: ErrorOptions = {}) {
    super(options.message ?? "That webhook delivery could not be verified.", options);
  }
}

/** The catch-all. Its message is fixed so nothing internal leaks through the filter. */
export class InternalError extends ServerError {
  override readonly code = ErrorCode.Internal;
  constructor(options: ErrorOptions = {}) {
    super("An internal error occurred.", options);
  }
}
