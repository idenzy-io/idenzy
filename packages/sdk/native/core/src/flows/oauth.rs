//! Social sign-in through the system browser (PROJECT.md 4.4, 4.6).

use serde_json::{Value, json};

use super::{AuthResult, SessionFlow};
use crate::api::Call;
use crate::encoding::percent_encode_component;
use crate::error::IdenzyError;
use crate::pkce::Pkce;
use crate::protocol::AuthorizationStarted;
use crate::redirect::code_from_redirect;
use crate::store::StoredValue;

/// The URL is asked for over JSON and the browser is the platform's: `ASWebAuthenticationSession`
/// or a Custom Tab, never an embedded web view (PROJECT.md 4.4). This flow only produces the URL
/// and spends the code that comes back; opening one and catching the other is the platform SDK's
/// job, because that is where the system APIs are.
///
/// The verifier is kept in the secure store rather than in memory. Android may end the app's
/// process while the browser is in front, and a verifier held in memory would make that return
/// fail every time.
#[derive(uniffi::Object)]
pub struct OAuthFlow {
    flow: SessionFlow,
    verifier: StoredValue,
}

impl OAuthFlow {
    pub(crate) fn new(flow: SessionFlow, verifier: StoredValue) -> Self {
        Self { flow, verifier }
    }

    async fn authorize(
        &self,
        path: String,
        redirect_uri: String,
        access_token: Option<String>,
    ) -> Result<String, IdenzyError> {
        let pkce = Pkce::generate()?;
        // Saved before the request, not after. The flow the server records is bound to this
        // challenge from the moment it answers.
        self.verifier.write(pkce.verifier);
        let call = Call::post(path)
            .body(json!({ "redirectUri": redirect_uri, "codeChallenge": pkce.challenge }))
            .bearer_if(access_token);
        let started: AuthorizationStarted = self.flow.api.send(call).await?;
        Ok(started.authorization_url)
    }
}

#[uniffi::export]
impl OAuthFlow {
    /// Where to send the system browser. `redirect_uri` must be registered for the project.
    pub async fn authorization_url(
        &self,
        provider: String,
        redirect_uri: String,
    ) -> Result<String, IdenzyError> {
        let path = format!(
            "v1/auth/oauth/{}/start",
            percent_encode_component(&provider)
        );
        self.authorize(path, redirect_uri, None).await
    }

    /// The same, for attaching a provider to the account signed in here. The user is taken from
    /// the token, so the callback links to this account and not to whoever the provider says.
    pub async fn link_url(
        &self,
        provider: String,
        redirect_uri: String,
    ) -> Result<String, IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let path = format!("v1/auth/oauth/{}/link", percent_encode_component(&provider));
        self.authorize(path, redirect_uri, Some(token)).await
    }

    /// Finishes from the URL the browser returned to, or answers `None` when it is not ours.
    pub async fn complete(&self, url: String) -> Result<Option<AuthResult>, IdenzyError> {
        match code_from_redirect(&url) {
            Ok(Some(code)) => self.exchange(code).await.map(Some),
            Ok(None) => Ok(None),
            Err(error) => {
                // The flow is over either way, and its verifier is single use.
                let _ = self.verifier.take();
                Err(error)
            }
        }
    }

    /// Spends the single-use code with the verifier this app kept.
    pub async fn exchange(&self, code: String) -> Result<AuthResult, IdenzyError> {
        let mut body = json!({ "code": code });
        if let Some(verifier) = self.verifier.take()? {
            body["codeVerifier"] = Value::from(verifier);
        }
        self.flow
            .establish(Call::post("v1/auth/oauth/exchange").body(body))
            .await
    }
}
