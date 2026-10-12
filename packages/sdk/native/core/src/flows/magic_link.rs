//! Magic links, whose two halves happen in different places (PROJECT.md 4.7).

use serde_json::json;

use super::{AuthResult, ChallengeStarted, SessionFlow};
use crate::api::Call;
use crate::error::IdenzyError;
use crate::redirect::code_from_redirect;

/// `start` runs where the form is; the link is opened wherever the mail was read, and lands on
/// the app through a universal link or an app link carrying our code. Nothing is remembered in
/// between, because the device that asked may not be the one that clicks, which is also why this
/// flow carries no PKCE and OAuth does.
///
/// `redirect_uri` must already be registered for the project. It is pinned to the token when the
/// mail is sent, so the destination cannot change between sending and clicking.
#[derive(uniffi::Object)]
pub struct MagicLinkFlow {
    flow: SessionFlow,
}

impl MagicLinkFlow {
    pub(crate) fn new(flow: SessionFlow) -> Self {
        Self { flow }
    }
}

#[uniffi::export]
impl MagicLinkFlow {
    pub async fn start(
        &self,
        email: String,
        redirect_uri: String,
    ) -> Result<ChallengeStarted, IdenzyError> {
        let call = Call::post("v1/auth/magic-link/start")
            .body(json!({ "email": email, "redirectUri": redirect_uri }));
        self.flow.api.send(call).await
    }

    /// Spends the code our redirect delivered.
    pub async fn exchange(&self, code: String) -> Result<AuthResult, IdenzyError> {
        let call = Call::post("v1/auth/magic-link/exchange").body(json!({ "code": code }));
        self.flow.establish(call).await
    }

    /// Finishes from the URL the app was opened with, or answers `None` when it is not ours.
    pub async fn complete(&self, url: String) -> Result<Option<AuthResult>, IdenzyError> {
        match code_from_redirect(&url)? {
            Some(code) => self.exchange(code).await.map(Some),
            None => Ok(None),
        }
    }
}
