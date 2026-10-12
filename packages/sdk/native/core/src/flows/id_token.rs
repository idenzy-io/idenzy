//! Native Sign in with Apple and Google: the platform's own sheet, then an ID-token exchange
//! (PROJECT.md 4.4).

use std::time::SystemTime;

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::{AuthResult, SessionFlow};
use crate::api::Call;
use crate::error::IdenzyError;
use crate::protocol::timestamp;

/// The providers with a platform sign-in sheet. Everything else goes through the browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum NativeProvider {
    Apple,
    Google,
}

impl NativeProvider {
    fn as_wire(self) -> &'static str {
        match self {
            Self::Apple => "apple",
            Self::Google => "google",
        }
    }
}

/// A nonce for one native sign-in, issued by the API.
///
/// `digest` goes to the platform sheet, which signs it into the ID token; `nonce` goes back to
/// the API with the token. Keep them apart: a token copied off the device carries only the
/// digest, which is what makes it worthless to whoever copied it.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct IdTokenNonce {
    pub nonce: String,
    /// Lowercase hex SHA-256 of `nonce`: `request.nonce` for Apple, `setNonce` for Google.
    pub digest: String,
    pub expires_at: SystemTime,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NonceIssued {
    nonce: String,
    #[serde(deserialize_with = "timestamp")]
    expires_at: SystemTime,
}

/// Exchanging a platform ID token for a session. The sheets themselves are the platform SDK's;
/// this is the half that is the same on every platform.
#[derive(uniffi::Object)]
pub struct IdTokenFlow {
    flow: SessionFlow,
}

impl IdTokenFlow {
    pub(crate) fn new(flow: SessionFlow) -> Self {
        Self { flow }
    }
}

#[uniffi::export]
impl IdTokenFlow {
    /// A fresh nonce and its digest, before the sheet is shown. One per attempt: the exchange
    /// spends it whether or not the token it arrives with is accepted.
    pub async fn prepare(&self) -> Result<IdTokenNonce, IdenzyError> {
        let issued: NonceIssued = self
            .flow
            .api
            .send(Call::post("v1/auth/id-token/nonce"))
            .await?;
        Ok(IdTokenNonce {
            digest: sha256_hex(&issued.nonce),
            nonce: issued.nonce,
            expires_at: issued.expires_at,
        })
    }

    /// Exchanges the sheet's ID token, with the nonce `prepare` returned.
    ///
    /// `display_name` is for Apple, which shows the app the user's name on the first sign-in
    /// and never puts it in the token. It names an account being created and nothing else.
    pub async fn exchange(
        &self,
        provider: NativeProvider,
        id_token: String,
        nonce: String,
        display_name: Option<String>,
    ) -> Result<AuthResult, IdenzyError> {
        let mut body =
            json!({ "provider": provider.as_wire(), "idToken": id_token, "nonce": nonce });
        if let Some(name) = display_name.filter(|name| !name.trim().is_empty()) {
            body["displayName"] = Value::from(name.trim());
        }
        self.flow
            .establish(Call::post("v1/auth/id-token").body(body))
            .await
    }
}

fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digests_as_lowercase_hex_sha256() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
