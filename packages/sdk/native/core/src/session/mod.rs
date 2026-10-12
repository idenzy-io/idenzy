//! The session as an application sees it, and the manager that is the only thing renewing it.

mod manager;
mod renewal;

use std::sync::{Arc, Weak};
use std::time::SystemTime;

pub(crate) use manager::SessionManager;

use crate::protocol::User;

/// The session handed to customer code (`Session` in `@idenzy/js`).
///
/// It carries the access token and deliberately not the refresh token. This is the value that
/// gets logged, put in a state container and printed while debugging; the credential that mints
/// tokens for the life of the session never travels with it.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Session {
    pub id: String,
    pub user: User,
    pub access_token: String,
    /// As the server stated it. Renewal does not trust the device clock against this; it measures
    /// the token's lifetime from its own claims instead (see `renewal`).
    pub access_token_expires_at: SystemTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SessionStatus {
    SignedIn,
    SignedOut,
}

/// What a subscriber is told. The platform layers add `loading` for the window before the first
/// restore answers, as the browser bindings do; the core only knows what it holds.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SessionState {
    pub status: SessionStatus,
    pub user: Option<User>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SignOutScope {
    /// This session only.
    Current,
    /// Every session the user holds, on every device.
    All,
}

impl SignOutScope {
    pub(crate) fn as_wire(self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::All => "all",
        }
    }
}

/// Told about every change of status, session or profile.
///
/// Called on whichever thread finished the work that changed it. A platform layer that drives UI
/// hops to its main thread itself; the core cannot know which one that is.
#[uniffi::export(with_foreign)]
pub trait SessionListener: Send + Sync {
    fn on_change(&self, state: SessionState);
}

/// Ends a subscription when cancelled, and only then. Not on drop: Kotlin frees an object whenever
/// its collector reaches it, so a subscription tied to drop would end at a different moment on
/// each platform, and on one of them at no predictable moment at all.
#[derive(uniffi::Object)]
pub struct Subscription {
    manager: Weak<SessionManager>,
    id: u64,
}

impl Subscription {
    pub(crate) fn new(manager: &Arc<SessionManager>, id: u64) -> Self {
        Self {
            manager: Arc::downgrade(manager),
            id,
        }
    }
}

#[uniffi::export]
impl Subscription {
    pub fn cancel(&self) {
        if let Some(manager) = self.manager.upgrade() {
            manager.unsubscribe(self.id);
        }
    }
}
