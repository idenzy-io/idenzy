//! The wire shapes of `@idenzy/protocol`, as this core reads them.
//!
//! The enums and header names are generated from the protocol package and checked in CI
//! (`pnpm native:check`). The structs are written by hand, because there are a dozen of them and
//! each is a direct transcription of one zod schema whose name its docstring gives; the tests in
//! this crate parse the responses those schemas describe.
//!
//! Deserialising here is the parse PROJECT.md 7.1 requires at a trust boundary. Unknown fields are
//! ignored, as zod strips them, so an additive change to the API never breaks a shipped app.

use std::time::SystemTime;

use serde::{Deserialize, Deserializer};

use crate::encoding::parse_rfc3339;

#[rustfmt::skip]
#[allow(dead_code)]
mod generated;

pub use generated::{
    AuthMethod, ErrorCode, MfaChallengePurpose, MfaFactorType, SessionRevokeReason,
};
pub(crate) use generated::{api_key_prefix, channel, header, session_transport};

/// The user as an application sees it (`publicUserSchema`).
///
/// `metadataPrivate` is absent because the API never sends it to a client. `metadataPublic` is
/// whatever the customer stored, so it crosses as JSON text rather than as a shape this library
/// would have to guess.
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: Option<String>,
    pub email_verified: bool,
    pub phone: Option<String>,
    pub phone_verified: bool,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(rename = "metadataPublic", deserialize_with = "json_text")]
    pub metadata_public_json: String,
    #[serde(deserialize_with = "timestamp")]
    pub created_at: SystemTime,
    #[serde(default, deserialize_with = "optional_timestamp")]
    pub last_sign_in_at: Option<SystemTime>,
}

/// `sessionCreatedSchema`, the session half of an authentication outcome.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionCreated {
    pub user: User,
    pub session_id: String,
    pub access_token: String,
    #[serde(deserialize_with = "timestamp")]
    pub access_token_expires_at: SystemTime,
    pub refresh_token: Option<String>,
}

/// `sessionRefreshedSchema`. The profile is present only when the rotation asked for it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRefreshed {
    pub session_id: String,
    pub access_token: String,
    #[serde(deserialize_with = "timestamp")]
    pub access_token_expires_at: SystemTime,
    pub refresh_token: Option<String>,
    pub user: Option<User>,
}

/// `mfaChallengeSchema`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MfaChallengeBody {
    pub challenge_id: String,
    pub purpose: MfaChallengePurpose,
    pub factors: Vec<MfaFactorType>,
    #[serde(deserialize_with = "timestamp")]
    pub expires_at: SystemTime,
}

/// `authOutcomeSchema`: a session or a challenge, never an error (ADR-0010).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "status")]
pub(crate) enum AuthOutcome {
    #[serde(rename = "authenticated")]
    Authenticated(SessionCreated),
    #[serde(rename = "mfa_required")]
    MfaRequired(MfaChallengeBody),
}

/// `authorizationStartedSchema`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorizationStarted {
    pub authorization_url: String,
}

/// `stepUpCompletedSchema`: a fresher access token on the same session, and nothing else.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StepUpCompleted {
    pub access_token: String,
    #[serde(deserialize_with = "timestamp")]
    pub access_token_expires_at: SystemTime,
}

/// `errorBodySchema`. The code stays a string here so an unknown one survives to the caller.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ErrorBody {
    pub error: ErrorPayload,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub fields: Vec<crate::error::FieldError>,
    pub request_id: String,
    pub retry_after_seconds: Option<u32>,
}

pub(crate) fn timestamp<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<SystemTime, D::Error> {
    let text = String::deserialize(deserializer)?;
    parse_rfc3339(&text)
        .ok_or_else(|| serde::de::Error::custom(format!("not an RFC 3339 timestamp: {text}")))
}

pub(crate) fn optional_timestamp<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<SystemTime>, D::Error> {
    match Option::<String>::deserialize(deserializer)? {
        None => Ok(None),
        Some(text) => parse_rfc3339(&text)
            .map(Some)
            .ok_or_else(|| serde::de::Error::custom(format!("not an RFC 3339 timestamp: {text}"))),
    }
}

fn json_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    if !value.is_object() {
        return Err(serde::de::Error::custom("metadataPublic is not an object"));
    }
    Ok(value.to_string())
}
