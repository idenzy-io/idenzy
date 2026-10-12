//! "Your devices": the user's sessions, and ending one of them.

use std::time::SystemTime;

use serde::Deserialize;

use crate::api::Call;
use crate::encoding::percent_encode_component;
use crate::error::IdenzyError;
use crate::flows::SessionFlow;
use crate::protocol::{AuthMethod, SessionRevokeReason, optional_timestamp, timestamp};

/// A session as the device list shows it (`sessionSummarySchema`). It carries no token material.
#[derive(Debug, Clone, PartialEq, Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub device_name: Option<String>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub amr: Vec<AuthMethod>,
    #[serde(deserialize_with = "timestamp")]
    pub created_at: SystemTime,
    #[serde(deserialize_with = "timestamp")]
    pub last_active_at: SystemTime,
    #[serde(deserialize_with = "timestamp")]
    pub absolute_expires_at: SystemTime,
    #[serde(default, deserialize_with = "optional_timestamp")]
    pub revoked_at: Option<SystemTime>,
    pub revoke_reason: Option<SessionRevokeReason>,
    /// The one making this request.
    pub current: bool,
}

#[derive(Deserialize)]
struct SessionList {
    sessions: Vec<SessionSummary>,
}

#[derive(uniffi::Object)]
pub struct SessionsApi {
    flow: SessionFlow,
}

impl SessionsApi {
    pub(crate) fn new(flow: SessionFlow) -> Self {
        Self { flow }
    }
}

#[uniffi::export]
impl SessionsApi {
    /// Most recently active first, with this device's own marked `current`.
    pub async fn list(&self) -> Result<Vec<SessionSummary>, IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let list: SessionList = self
            .flow
            .api
            .send(Call::get("v1/sessions").bearer(token))
            .await?;
        Ok(list.sessions)
    }

    /// Ends one session. Ending this device's own signs it out here too.
    pub async fn revoke(&self, id: String) -> Result<(), IdenzyError> {
        let token = self.flow.sessions.require_token().await?;
        let path = format!("v1/sessions/{}", percent_encode_component(&id));
        self.flow
            .api
            .send_void(Call::delete(path).bearer(token))
            .await?;
        if self
            .flow
            .sessions
            .session()
            .is_some_and(|session| session.id == id)
        {
            self.flow.sessions.clear()?;
        }
        Ok(())
    }
}
