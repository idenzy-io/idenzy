//! The signed-in user's own account.

use serde::Deserialize;
use serde_json::json;

use crate::api::Call;
use crate::error::IdenzyError;
use crate::flows::SessionFlow;
use crate::protocol::User;

/// One half of an email change confirmed (`emailChangeConfirmedSchema`). `applied` stays false
/// until both addresses have confirmed, so a screen can say the other is still outstanding.
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
pub struct EmailChangeConfirmed {
    pub applied: bool,
}

#[derive(uniffi::Object)]
pub struct AccountApi {
    flow: SessionFlow,
}

impl AccountApi {
    pub(crate) fn new(flow: SessionFlow) -> Self {
        Self { flow }
    }
}

#[uniffi::export]
impl AccountApi {
    /// The current profile. Subscribers are told, since a newer profile is what they watch for.
    pub async fn me(&self) -> Result<User, IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let user: User = self
            .flow
            .api
            .send(Call::get("v1/users/me").bearer(token))
            .await?;
        self.flow.sessions.update_user(user.clone());
        Ok(user)
    }

    pub async fn request_email_verification(&self) -> Result<(), IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let call = Call::post("v1/users/me/email/verification").bearer(token);
        self.flow.api.send_void(call).await
    }

    /// Needs no session: the link may be opened on a device that has none.
    pub async fn confirm_email_verification(&self, token: String) -> Result<(), IdenzyError> {
        let call =
            Call::post("v1/users/me/email/verification/confirm").body(json!({ "token": token }));
        self.flow.api.send_void(call).await
    }

    /// Requires a recent second factor, and confirms on both addresses (PROJECT.md 4.5).
    pub async fn request_email_change(&self, new_email: String) -> Result<(), IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let call = Call::post("v1/users/me/email")
            .body(json!({ "newEmail": new_email }))
            .bearer(token);
        self.flow.api.send_void(call).await
    }

    pub async fn confirm_email_change(
        &self,
        token: String,
    ) -> Result<EmailChangeConfirmed, IdenzyError> {
        let call = Call::post("v1/users/me/email/confirm").body(json!({ "token": token }));
        self.flow.api.send(call).await
    }
}
