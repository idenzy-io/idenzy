//! One-time codes, the passwordless path documented first (PROJECT.md 4.7). It needs no deep
//! link and no browser, which on a phone makes it the shortest way in by a distance.

use std::sync::Mutex;

use serde_json::json;

use super::{AuthResult, ChallengeStarted, SessionFlow};
use crate::api::Call;
use crate::error::{FieldError, IdenzyError};
use crate::locked;
use crate::protocol::channel;

/// Remembers the challenge it started, so the second call takes only the code. The challenge id
/// is otherwise something an app carries through its own state, and every place it is carried is
/// a place it can be logged. One entry point per channel and none per sign-in or sign-up: the
/// endpoint creates the account when the target has none.
#[derive(uniffi::Object)]
pub struct OtpFlow {
    flow: SessionFlow,
    challenge_id: Mutex<Option<String>>,
}

impl OtpFlow {
    pub(crate) fn new(flow: SessionFlow) -> Self {
        Self {
            flow,
            challenge_id: Mutex::new(None),
        }
    }

    async fn start(
        &self,
        body: serde_json::Value,
        attestation: Option<String>,
    ) -> Result<ChallengeStarted, IdenzyError> {
        let call = Call::post("v1/auth/otp/start")
            .body(body)
            .attestation(attestation);
        let started: ChallengeStarted = self.flow.api.send(call).await?;
        *locked(&self.challenge_id) = Some(started.challenge_id.clone());
        Ok(started)
    }
}

#[uniffi::export]
impl OtpFlow {
    /// Answers the same way for an address with an account and one without.
    pub async fn start_email(&self, email: String) -> Result<ChallengeStarted, IdenzyError> {
        self.start(json!({ "channel": channel::EMAIL, "email": email }), None)
            .await
    }

    /// Refused rather than sent where the project does not serve the country, has spent its
    /// daily cap, or requires an attestation this call did not carry: `country_not_allowed`,
    /// `spend_cap_reached` and `attestation_required`. The attestation is per call because it is
    /// single use (PROJECT.md 4.8).
    pub async fn start_sms(
        &self,
        phone: String,
        attestation: Option<String>,
    ) -> Result<ChallengeStarted, IdenzyError> {
        self.start(
            json!({ "channel": channel::SMS, "phone": phone }),
            attestation,
        )
        .await
    }

    /// Completes the last challenge started here, or an explicit one carried across a restart.
    pub async fn verify(
        &self,
        code: String,
        challenge_id: Option<String>,
    ) -> Result<AuthResult, IdenzyError> {
        let challenge_id = challenge_id
            .or_else(|| locked(&self.challenge_id).clone())
            .ok_or_else(|| IdenzyError::InvalidInput {
                detail: "No code has been sent yet. Start a challenge first, or pass its id."
                    .into(),
                fields: vec![FieldError {
                    path: "challengeId".into(),
                    code: "missing".into(),
                }],
            })?;
        let call = Call::post("v1/auth/otp/verify")
            .body(json!({ "challengeId": challenge_id, "code": code }));
        self.flow.establish(call).await
    }
}
