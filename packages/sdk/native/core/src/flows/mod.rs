//! Every way in, and the ending they share.

pub mod anonymous;
pub mod id_token;
pub mod magic_link;
pub mod oauth;
pub mod otp;
pub mod password;

use std::sync::Arc;
use std::time::SystemTime;

use serde::Deserialize;

use crate::api::{ApiClient, Call};
use crate::error::IdenzyError;
use crate::mfa::MfaChallenge;
use crate::protocol::{AuthOutcome, timestamp};
use crate::session::{Session, SessionManager};

/// What every way in answers with (ADR-0010).
///
/// A union rather than a session with a nullable challenge, so an app whose project turns MFA on
/// finds out at its next build rather than at its users' next sign-in. The flows that cannot
/// currently challenge return it too: which those are is ours to change.
// Crosses the FFI by value, where a boxed variant has no representation; it is built once per
// sign-in, so its size costs nothing.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, uniffi::Enum)]
pub enum AuthResult {
    Authenticated { session: Session },
    MfaRequired { challenge: Arc<MfaChallenge> },
}

/// A code or a link is on its way (`challengeStartedSchema`).
///
/// Answered identically whether or not the address has an account, so there is nothing here to
/// branch on: a screen that said "no such account" would be the enumeration oracle the endpoint
/// is shaped to avoid.
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeStarted {
    pub challenge_id: String,
    #[serde(deserialize_with = "timestamp")]
    pub expires_at: SystemTime,
}

/// The ending every flow that creates a session inherits (`SessionFlow` in `@idenzy/js`).
///
/// Posting credentials and returning the body would look like it worked: the app gets a user,
/// its screen navigates, and the client is still signed out. Adopting is not a step a flow can
/// be trusted to remember, so no flow is given it.
#[derive(Clone)]
pub(crate) struct SessionFlow {
    pub api: Arc<ApiClient>,
    pub sessions: Arc<SessionManager>,
}

impl SessionFlow {
    /// Post, parse, then adopt or challenge. The device name rides here because these are the
    /// calls that create a session and therefore the only ones the server reads it on.
    pub async fn establish(&self, call: Call) -> Result<AuthResult, IdenzyError> {
        match self.api.send::<AuthOutcome>(call.naming_device()).await? {
            AuthOutcome::Authenticated(created) => Ok(AuthResult::Authenticated {
                session: self.sessions.adopt(created),
            }),
            AuthOutcome::MfaRequired(body) => Ok(AuthResult::MfaRequired {
                challenge: Arc::new(MfaChallenge::for_sign_in(body, self.clone())),
            }),
        }
    }

    /// Answers a sign-in challenge, which is the request that finally creates the session.
    ///
    /// A second challenge in reply is not a case for the app to handle: the server issues one
    /// challenge per sign-in, so anything else is this client and the API disagreeing.
    pub async fn complete_mfa(&self, call: Call) -> Result<Session, IdenzyError> {
        match self.api.send::<AuthOutcome>(call.naming_device()).await? {
            AuthOutcome::Authenticated(created) => Ok(self.sessions.adopt(created)),
            AuthOutcome::MfaRequired(_) => Err(IdenzyError::unexpected(
                "A second factor was answered and another was demanded.",
                200,
            )),
        }
    }
}
