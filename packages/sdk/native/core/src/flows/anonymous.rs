//! Anonymous sessions, and the upgrade that keeps the account (PROJECT.md 3.1).

use serde_json::json;

use super::{AuthResult, SessionFlow};
use crate::api::Call;
use crate::error::IdenzyError;

/// The upgrade answers with a new session rather than reusing the current one, so `amr` stops
/// saying `anon` for an account that now has a password. The user id and everything hanging off
/// it survive; the credential is what changes.
#[derive(uniffi::Object)]
pub struct AnonymousFlow {
    flow: SessionFlow,
}

impl AnonymousFlow {
    pub(crate) fn new(flow: SessionFlow) -> Self {
        Self { flow }
    }
}

#[uniffi::export]
impl AnonymousFlow {
    pub async fn sign_in(&self) -> Result<AuthResult, IdenzyError> {
        self.flow.establish(Call::post("v1/auth/anonymous")).await
    }

    pub async fn upgrade(
        &self,
        email: String,
        password: String,
    ) -> Result<AuthResult, IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let call = Call::post("v1/auth/anonymous/upgrade")
            .body(json!({ "email": email, "password": password }))
            .bearer(token);
        self.flow.establish(call).await
    }
}
