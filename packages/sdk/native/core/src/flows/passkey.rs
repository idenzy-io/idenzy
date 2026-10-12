//! Passkeys. The ceremony is the platform's (AuthenticationServices, Credential Manager), the
//! challenge and the verification are the API's, and this is the half between them that is the
//! same on every platform.

use std::time::SystemTime;

use serde::Deserialize;
use serde_json::{Value, json};

use super::{AuthResult, SessionFlow};
use crate::api::Call;
use crate::encoding::percent_encode_component;
use crate::error::IdenzyError;
use crate::protocol::{optional_timestamp, timestamp};

/// One ceremony's options, as the API minted them.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PasskeyCeremony {
    /// Sent back with the response, which spends the challenge it names.
    pub challenge_id: String,
    /// The WebAuthn options, `PublicKeyCredentialCreationOptionsJSON` or
    /// `PublicKeyCredentialRequestOptionsJSON`: what Credential Manager takes as it is, and what
    /// the Swift SDK reads the challenge, the relying party and the user from.
    pub options_json: String,
    pub expires_at: SystemTime,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Minted {
    challenge_id: String,
    #[serde(deserialize_with = "timestamp")]
    expires_at: SystemTime,
    public_key: Value,
}

impl From<Minted> for PasskeyCeremony {
    fn from(minted: Minted) -> Self {
        Self {
            challenge_id: minted.challenge_id,
            options_json: minted.public_key.to_string(),
            expires_at: minted.expires_at,
        }
    }
}

/// A passkey on the user's account as its owner sees it (`passkeySchema`). It carries no
/// credential id: that identifies a physical authenticator, and a list is how one ends up in logs.
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct Passkey {
    pub id: String,
    pub name: Option<String>,
    pub transports: Vec<String>,
    /// The credential can sync to a provider's cloud, from the signed BE flag.
    pub backup_eligible: bool,
    pub backed_up: bool,
    #[serde(deserialize_with = "timestamp")]
    pub created_at: SystemTime,
    #[serde(default, deserialize_with = "optional_timestamp")]
    pub last_used_at: Option<SystemTime>,
}

#[derive(Deserialize)]
struct PasskeyList {
    passkeys: Vec<Passkey>,
}

#[derive(uniffi::Object)]
pub struct PasskeyFlow {
    flow: SessionFlow,
}

impl PasskeyFlow {
    pub(crate) fn new(flow: SessionFlow) -> Self {
        Self { flow }
    }
}

#[uniffi::export]
impl PasskeyFlow {
    /// Options for adding a passkey to the signed-in account. One per attempt.
    pub async fn registration_options(&self) -> Result<PasskeyCeremony, IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let minted: Minted = self
            .flow
            .api
            .send(Call::post("v1/auth/passkeys/registration/options").bearer(token))
            .await?;
        Ok(minted.into())
    }

    /// Adds the passkey the platform created. `response_json` is the `RegistrationResponseJSON`
    /// the ceremony produced, and `name` what the user's own list calls it.
    pub async fn register(
        &self,
        challenge_id: String,
        response_json: String,
        name: Option<String>,
    ) -> Result<Passkey, IdenzyError> {
        let mut body = json!({ "challengeId": challenge_id, "response": parsed(&response_json)? });
        if let Some(name) = name.filter(|name| !name.trim().is_empty()) {
            body["name"] = Value::from(name.trim());
        }
        let token = self.flow.sessions.require_token().await?;
        self.flow
            .api
            .send(
                Call::post("v1/auth/passkeys/registration")
                    .bearer(token)
                    .body(body),
            )
            .await
    }

    /// Options for signing in with a passkey. They name no account and no credential: the
    /// platform offers whichever of the user's passkeys belong to the relying party.
    pub async fn authentication_options(&self) -> Result<PasskeyCeremony, IdenzyError> {
        let minted: Minted = self
            .flow
            .api
            .send(Call::post("v1/auth/passkeys/authentication/options"))
            .await?;
        Ok(minted.into())
    }

    /// Signs in with the assertion the platform produced, `AuthenticationResponseJSON`.
    pub async fn sign_in(
        &self,
        challenge_id: String,
        response_json: String,
    ) -> Result<AuthResult, IdenzyError> {
        let body = json!({ "challengeId": challenge_id, "response": parsed(&response_json)? });
        self.flow
            .establish(Call::post("v1/auth/passkeys/authentication").body(body))
            .await
    }

    /// The signed-in user's passkeys.
    pub async fn list(&self) -> Result<Vec<Passkey>, IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let list: PasskeyList = self
            .flow
            .api
            .send(Call::get("v1/users/me/passkeys").bearer(token))
            .await?;
        Ok(list.passkeys)
    }

    pub async fn remove(&self, id: String) -> Result<(), IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let path = format!("v1/users/me/passkeys/{}", percent_encode_component(&id));
        self.flow
            .api
            .send_void(Call::delete(path).bearer(token))
            .await
    }
}

/// The platform's response, refused here if it is not JSON rather than sent for the API to refuse.
fn parsed(response_json: &str) -> Result<Value, IdenzyError> {
    serde_json::from_str(response_json).map_err(|_| IdenzyError::InvalidInput {
        detail: "The passkey response is not JSON.".into(),
        fields: vec![crate::error::FieldError {
            path: "response".into(),
            code: "invalid".into(),
        }],
    })
}
