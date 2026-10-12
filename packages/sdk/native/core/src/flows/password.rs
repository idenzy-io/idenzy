//! Email and password (PROJECT.md 4.5).

use serde_json::json;

use super::{AuthResult, SessionFlow};
use crate::api::Call;
use crate::error::IdenzyError;

/// Both halves of a reset are here and neither signs anybody in. Requesting one succeeds for an
/// address with an account and one without, so there is nothing to tell the user either way.
#[derive(uniffi::Object)]
pub struct PasswordFlow {
    flow: SessionFlow,
}

impl PasswordFlow {
    pub(crate) fn new(flow: SessionFlow) -> Self {
        Self { flow }
    }
}

#[uniffi::export]
impl PasswordFlow {
    pub async fn sign_up(
        &self,
        email: String,
        password: String,
        display_name: Option<String>,
    ) -> Result<AuthResult, IdenzyError> {
        let mut body = json!({ "email": email, "password": password });
        if let Some(name) = display_name {
            body["displayName"] = name.into();
        }
        self.flow
            .establish(Call::post("v1/auth/sign-up/password").body(body))
            .await
    }

    pub async fn sign_in(
        &self,
        email: String,
        password: String,
    ) -> Result<AuthResult, IdenzyError> {
        let body = json!({ "email": email, "password": password });
        self.flow
            .establish(Call::post("v1/auth/sign-in/password").body(body))
            .await
    }

    pub async fn request_reset(&self, email: String) -> Result<(), IdenzyError> {
        let call = Call::post("v1/auth/password/reset").body(json!({ "email": email }));
        self.flow.api.send_void(call).await
    }

    /// Does not sign in, deliberately: whoever holds the link is not yet known to own the
    /// account, and the password just set is what proves it at the next sign-in.
    pub async fn confirm_reset(&self, token: String, password: String) -> Result<(), IdenzyError> {
        let call = Call::post("v1/auth/password/reset/confirm")
            .body(json!({ "token": token, "password": password }));
        self.flow.api.send_void(call).await
    }
}
