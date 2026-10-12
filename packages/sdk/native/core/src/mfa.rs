//! Second factors: answering a challenge, enrolling one, and stepping up an existing session.

use std::sync::Arc;
use std::time::SystemTime;

use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::api::Call;
use crate::encoding::percent_encode_component;
use crate::error::IdenzyError;
use crate::flows::SessionFlow;
use crate::protocol::{
    MfaChallengeBody, MfaChallengePurpose, MfaFactorType, StepUpCompleted, optional_timestamp,
    timestamp,
};
use crate::session::Session;

/// What proves a factor (`mfaProofSchema`), without the challenge it answers.
///
/// A passkey proof is not here yet: it is a platform ceremony between two round trips, and it
/// arrives with the platform passkey support rather than as a shape a caller could fill in.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum MfaProof {
    Totp { code: String },
    RecoveryCode { code: String },
}

impl MfaProof {
    fn fields(&self) -> (MfaFactorType, &str) {
        match self {
            Self::Totp { code } => (MfaFactorType::Totp, code),
            Self::RecoveryCode { code } => (MfaFactorType::RecoveryCode, code),
        }
    }
}

enum Completion {
    SignIn,
    StepUp,
}

/// A sign-in that stopped at a second factor, or a step-up waiting for one.
///
/// It carries `submit` rather than leaving the app to find the right call, because the challenge
/// id and the device name have to travel with the answer, and an app assembling that request
/// itself is an app that can get one of them wrong.
#[derive(uniffi::Object)]
pub struct MfaChallenge {
    body: MfaChallengeBody,
    completion: Completion,
    flow: SessionFlow,
}

impl std::fmt::Debug for MfaChallenge {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_tuple("MfaChallenge")
            .field(&self.body)
            .finish()
    }
}

impl MfaChallenge {
    pub(crate) fn for_sign_in(body: MfaChallengeBody, flow: SessionFlow) -> Self {
        Self {
            body,
            completion: Completion::SignIn,
            flow,
        }
    }

    fn for_step_up(body: MfaChallengeBody, flow: SessionFlow) -> Self {
        Self {
            body,
            completion: Completion::StepUp,
            flow,
        }
    }
}

#[uniffi::export]
impl MfaChallenge {
    pub fn challenge_id(&self) -> String {
        self.body.challenge_id.clone()
    }

    pub fn purpose(&self) -> MfaChallengePurpose {
        self.body.purpose
    }

    /// Strongest first: the first is what to ask for, the rest belong behind "try another way".
    /// A factor newer than this build is `Unrecognized` and is simply not offered.
    pub fn factors(&self) -> Vec<MfaFactorType> {
        self.body.factors.clone()
    }

    pub fn expires_at(&self) -> SystemTime {
        self.body.expires_at
    }

    /// Answers the challenge. A sign-in ends in a new session; a step-up ends in a fresher token
    /// on the same one, and the refresh token is not rotated for it.
    pub async fn submit(&self, proof: MfaProof) -> Result<Session, IdenzyError> {
        let (factor, code) = proof.fields();
        let mut body = Map::new();
        body.insert(
            "challengeId".into(),
            Value::from(self.body.challenge_id.clone()),
        );
        body.insert(
            "factor".into(),
            Value::from(factor.as_wire().unwrap_or_default()),
        );
        body.insert("code".into(), Value::from(code));
        match self.completion {
            Completion::SignIn => {
                let call = Call::post("v1/auth/mfa/verify").body(Value::Object(body));
                self.flow.complete_mfa(call).await
            }
            Completion::StepUp => {
                let token = self.flow.sessions.require_token().await?;
                let call = Call::post("v1/auth/mfa/step-up/verify")
                    .body(Value::Object(body))
                    .bearer(token);
                let completed: StepUpCompleted = self.flow.api.send(call).await?;
                self.flow
                    .sessions
                    .replace_token(completed.access_token, completed.access_token_expires_at)
            }
        }
    }
}

/// An enrolled factor as a security screen shows it (`mfaFactorSummarySchema`). No secret.
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct MfaFactorSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub factor_type: MfaFactorType,
    pub label: Option<String>,
    #[serde(deserialize_with = "timestamp")]
    pub created_at: SystemTime,
    #[serde(default, deserialize_with = "optional_timestamp")]
    pub last_used_at: Option<SystemTime>,
}

/// Everything the user holds. Recovery codes are a count: the list exists only in the reply that
/// generated it.
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct MfaFactorList {
    pub factors: Vec<MfaFactorSummary>,
    pub recovery_codes_remaining: u32,
}

/// The shared secret, once. `uri` is what a QR code encodes and `secret` is what somebody types
/// when they cannot scan one. Rendering the code is the app's (ADR-0002).
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct TotpEnrolment {
    pub factor_id: String,
    pub secret: String,
    pub uri: String,
}

/// Returned once and never again: only digests are kept, so an app that does not show these has
/// lost them for the user.
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCodes {
    pub codes: Vec<String>,
    #[serde(deserialize_with = "timestamp")]
    pub generated_at: SystemTime,
}

/// A confirmed enrolment. `recovery_codes` is present the first time a user gets a second factor
/// and absent after that, because reissuing would invalidate a sheet somebody already printed.
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct MfaEnrolmentConfirmed {
    pub factor: MfaFactorSummary,
    pub recovery_codes: Option<RecoveryCodes>,
}

/// Managing the signed-in user's factors.
#[derive(uniffi::Object)]
pub struct MfaApi {
    flow: SessionFlow,
}

impl MfaApi {
    pub(crate) fn new(flow: SessionFlow) -> Self {
        Self { flow }
    }

    async fn authorised(&self, call: Call) -> Result<Call, IdenzyError> {
        Ok(call.bearer(self.flow.sessions.require_token().await?))
    }
}

#[uniffi::export]
impl MfaApi {
    pub async fn factors(&self) -> Result<MfaFactorList, IdenzyError> {
        let call = self.authorised(Call::get("v1/auth/mfa/factors")).await?;
        self.flow.api.send(call).await
    }

    /// Begins TOTP enrolment. The factor satisfies nothing until `confirm_totp` proves the secret
    /// arrived intact.
    pub async fn enroll_totp(&self, label: Option<String>) -> Result<TotpEnrolment, IdenzyError> {
        let body = match label {
            Some(label) => json!({ "label": label }),
            None => json!({}),
        };
        let call = self
            .authorised(Call::post("v1/auth/mfa/totp").body(body))
            .await?;
        self.flow.api.send(call).await
    }

    pub async fn confirm_totp(
        &self,
        factor_id: String,
        code: String,
    ) -> Result<MfaEnrolmentConfirmed, IdenzyError> {
        let body = json!({ "factorId": factor_id, "code": code });
        let call = self
            .authorised(Call::post("v1/auth/mfa/totp/confirm").body(body))
            .await?;
        self.flow.api.send(call).await
    }

    /// Invalidates every earlier code.
    pub async fn regenerate_recovery_codes(&self) -> Result<RecoveryCodes, IdenzyError> {
        let call = self
            .authorised(Call::post("v1/auth/mfa/recovery-codes"))
            .await?;
        self.flow.api.send(call).await
    }

    pub async fn remove_factor(&self, factor_id: String) -> Result<(), IdenzyError> {
        let path = format!(
            "v1/auth/mfa/factors/{}",
            percent_encode_component(&factor_id)
        );
        let call = self.authorised(Call::delete(path)).await?;
        self.flow.api.send_void(call).await
    }

    /// A challenge to raise this session's assurance, or `None` when it is already recent enough
    /// or the user has nothing enrolled to prove.
    pub async fn start_step_up(&self) -> Result<Option<Arc<MfaChallenge>>, IdenzyError> {
        let call = self.authorised(Call::post("v1/auth/mfa/step-up")).await?;
        let body: Option<MfaChallengeBody> = self.flow.api.send_optional(call).await?;
        Ok(body.map(|body| Arc::new(MfaChallenge::for_step_up(body, self.flow.clone()))))
    }
}
