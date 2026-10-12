//! The composition root: one object graph, every collaborator passed in.

use std::sync::Arc;

use crate::account::AccountApi;
use crate::api::ApiClient;
use crate::clock::{Clock, SystemClock};
use crate::config::{ClientConfig, Config};
use crate::error::IdenzyError;
use crate::flows::SessionFlow;
use crate::flows::anonymous::AnonymousFlow;
use crate::flows::id_token::IdTokenFlow;
use crate::flows::magic_link::MagicLinkFlow;
use crate::flows::oauth::OAuthFlow;
use crate::flows::otp::OtpFlow;
use crate::flows::password::PasswordFlow;
use crate::mfa::MfaApi;
use crate::protocol::User;
use crate::session::{
    Session, SessionListener, SessionManager, SessionState, SignOutScope, Subscription,
};
use crate::sessions::SessionsApi;
use crate::store::{SecureStore, StoredValue};
use crate::transport::HttpTransport;

/// The client a platform SDK wraps.
///
/// Nothing in this library reaches for a singleton, which is what lets two clients for two
/// projects exist in one app and lets a test build the whole graph with no network. The opposite
/// rule holds for the app: **one client per project per process.** Two clients over one store
/// would rotate the same refresh token independently, and the second rotation revokes the
/// session (ADR-0007).
#[derive(uniffi::Object)]
pub struct IdenzyClient {
    sessions: Arc<SessionManager>,
    password: Arc<PasswordFlow>,
    otp: Arc<OtpFlow>,
    magic_link: Arc<MagicLinkFlow>,
    oauth: Arc<OAuthFlow>,
    anonymous: Arc<AnonymousFlow>,
    id_token: Arc<IdTokenFlow>,
    account: Arc<AccountApi>,
    session_list: Arc<SessionsApi>,
    mfa: Arc<MfaApi>,
}

impl IdenzyClient {
    pub(crate) fn build(
        config: ClientConfig,
        transport: Arc<dyn HttpTransport>,
        store: Arc<dyn SecureStore>,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, IdenzyError> {
        let config = Config::parse(config)?;
        let stored = |name: &str| StoredValue::new(store.clone(), config.storage_key(name));
        let api = Arc::new(ApiClient::new(config.clone(), transport));
        let sessions = Arc::new(SessionManager::new(
            api.clone(),
            stored("refresh"),
            stored("rotation"),
            clock,
        ));
        let flow = SessionFlow {
            api,
            sessions: sessions.clone(),
        };
        Ok(Self {
            password: Arc::new(PasswordFlow::new(flow.clone())),
            otp: Arc::new(OtpFlow::new(flow.clone())),
            magic_link: Arc::new(MagicLinkFlow::new(flow.clone())),
            oauth: Arc::new(OAuthFlow::new(flow.clone(), stored("pkce"))),
            anonymous: Arc::new(AnonymousFlow::new(flow.clone())),
            id_token: Arc::new(IdTokenFlow::new(flow.clone())),
            account: Arc::new(AccountApi::new(flow.clone())),
            session_list: Arc::new(SessionsApi::new(flow.clone())),
            mfa: Arc::new(MfaApi::new(flow)),
            sessions,
        })
    }
}

#[uniffi::export]
impl IdenzyClient {
    /// Validates the configuration before anything is sent: a secret key or plain http to a real
    /// host is refused here, where the mistake is still the developer's and not yet published.
    #[uniffi::constructor]
    pub fn new(
        config: ClientConfig,
        transport: Arc<dyn HttpTransport>,
        store: Arc<dyn SecureStore>,
    ) -> Result<Arc<Self>, IdenzyError> {
        Self::build(config, transport, store, Arc::new(SystemClock)).map(Arc::new)
    }

    pub fn password(&self) -> Arc<PasswordFlow> {
        self.password.clone()
    }

    pub fn otp(&self) -> Arc<OtpFlow> {
        self.otp.clone()
    }

    pub fn magic_link(&self) -> Arc<MagicLinkFlow> {
        self.magic_link.clone()
    }

    pub fn oauth(&self) -> Arc<OAuthFlow> {
        self.oauth.clone()
    }

    pub fn anonymous(&self) -> Arc<AnonymousFlow> {
        self.anonymous.clone()
    }

    /// Native Sign in with Apple and Google, after the platform sheet has produced a token.
    pub fn id_token(&self) -> Arc<IdTokenFlow> {
        self.id_token.clone()
    }

    pub fn account(&self) -> Arc<AccountApi> {
        self.account.clone()
    }

    pub fn sessions(&self) -> Arc<SessionsApi> {
        self.session_list.clone()
    }

    pub fn mfa(&self) -> Arc<MfaApi> {
        self.mfa.clone()
    }

    pub fn session(&self) -> Option<Session> {
        self.sessions.session()
    }

    pub fn user(&self) -> Option<User> {
        self.sessions.session().map(|session| session.user)
    }

    pub fn state(&self) -> SessionState {
        self.sessions.state()
    }

    /// Picks up the session a previous launch stored. Call once, at start-up.
    pub async fn restore(&self) -> Result<Option<Session>, IdenzyError> {
        self.sessions.restore().await
    }

    /// A token for the app's own API calls, renewed first if it is close to expiry.
    pub async fn get_token(&self) -> Result<Option<String>, IdenzyError> {
        self.sessions.get_token().await
    }

    pub async fn sign_out(&self, scope: SignOutScope) -> Result<(), IdenzyError> {
        self.sessions.sign_out(scope).await
    }

    /// Called at once with the current state, then on every change, until cancelled.
    pub fn subscribe(&self, listener: Arc<dyn SessionListener>) -> Arc<Subscription> {
        let id = self.sessions.subscribe(listener);
        Arc::new(Subscription::new(&self.sessions, id))
    }
}
