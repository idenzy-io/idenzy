//! The protocol and session core of every native Idenzy SDK (ADR-0022).
//!
//! What lives here is the part that has to behave identically on every platform and is
//! expensive to get subtly wrong: holding the session, rotating the refresh token exactly once,
//! refusing to re-present one whose rotation went unobserved (ADR-0007), the session-or-challenge
//! union every way in answers with (ADR-0010), PKCE, and the stable error codes a customer's own
//! screens are built from.
//!
//! What does not live here is any I/O. The network is [`HttpTransport`] and the credential store
//! is [`SecureStore`], both implemented by the platform SDK over its own stack: URLSession and the
//! Keychain on Apple platforms, the Android Keystore and an HTTP client there. That keeps proxies,
//! certificate policy and storage protection where the operating system already enforces them,
//! and keeps a TLS stack out of this library entirely.
//!
//! There is no UI in it and there never will be (ADR-0002).

uniffi::setup_scaffolding!();

mod account;
mod api;
mod client;
mod clock;
mod config;
mod encoding;
mod error;
mod flows;
mod mfa;
mod pkce;
mod protocol;
mod redirect;
mod session;
mod sessions;
mod store;
mod transport;

pub use account::{AccountApi, EmailChangeConfirmed};
pub use client::IdenzyClient;
pub use config::ClientConfig;
pub use error::{FieldError, IdenzyError, TransportReason};
pub use flows::anonymous::AnonymousFlow;
pub use flows::id_token::{IdTokenFlow, IdTokenNonce, NativeProvider};
pub use flows::magic_link::MagicLinkFlow;
pub use flows::oauth::OAuthFlow;
pub use flows::otp::OtpFlow;
pub use flows::password::PasswordFlow;
pub use flows::{AuthResult, ChallengeStarted};
pub use mfa::{
    MfaApi, MfaChallenge, MfaEnrolmentConfirmed, MfaFactorList, MfaFactorSummary, MfaProof,
    RecoveryCodes, TotpEnrolment,
};
pub use protocol::{
    AuthMethod, ErrorCode, MfaChallengePurpose, MfaFactorType, SessionRevokeReason, User,
};
pub use session::{
    Session, SessionListener, SessionState, SessionStatus, SignOutScope, Subscription,
};
pub use sessions::{SessionSummary, SessionsApi};
pub use store::{SecureStore, StoreFailure};
pub use transport::{HttpMethod, HttpRequest, HttpResponse, HttpTransport, TransportFailure};

/// Takes a lock whether or not a panic poisoned it. Every guarded value here is consistent between
/// statements, so a panic elsewhere is no reason to turn every later call into a second one.
pub(crate) fn locked<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod testing;
#[cfg(test)]
mod tests;
