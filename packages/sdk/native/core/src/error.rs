//! What every call in this library throws.
//!
//! Few variants rather than one per code, for the reason `@idenzy/js` gives: the client already
//! has the status, so a type per code would only be a second list to keep in step with the
//! protocol. A customer branches on [`IdenzyError::code`], never on a message.

use serde::Deserialize;

use crate::protocol::ErrorCode;

/// Field-level detail on `validation_failed`, in the protocol's own shape.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, uniffi::Record)]
pub struct FieldError {
    pub path: String,
    pub code: String,
}

/// Why a request produced no answer this library could use.
///
/// The distinction between the first two is load-bearing for refresh. A request that provably
/// never left the device spent nothing, so its refresh token is still good; one that may have
/// reached the server is a rotation whose answer was not observed, and ADR-0007 forbids
/// presenting that token again.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TransportReason {
    /// No byte of the request reached the server: offline, DNS, refused, a failed TLS handshake.
    NotSent,
    /// The request may have reached the server and the answer was lost: a timeout, a dropped
    /// connection, a cancelled call.
    Interrupted,
    /// Something answered, and it was not the protocol: a captive portal, a proxy's error page,
    /// a mistyped API URL.
    UnexpectedResponse,
}

#[derive(Debug, Clone, PartialEq, thiserror::Error, uniffi::Error)]
pub enum IdenzyError {
    /// The API answered and refused. `raw_code` keeps a code newer than this build, which then
    /// arrives as `ErrorCode::Unrecognized` rather than as a failure to read the refusal.
    #[error("{detail}")]
    Api {
        code: ErrorCode,
        raw_code: String,
        detail: String,
        status: u16,
        request_id: String,
        fields: Vec<FieldError>,
        retry_after_seconds: Option<u32>,
    },
    /// No usable answer. `status` is 0 when nothing came back at all, never a fabricated 503:
    /// "our API refused you" and "your device never reached it" want different screens.
    #[error("{detail}")]
    Transport {
        reason: TransportReason,
        detail: String,
        status: u16,
    },
    /// The call needs a session and there is none. The same code the API would have answered
    /// with, so a handler does not care whether the request was refused or never sent.
    #[error("{detail}")]
    MissingCredentials { detail: String },
    /// The caller passed something the call cannot use, caught before a request was made.
    #[error("{detail}")]
    InvalidInput {
        detail: String,
        fields: Vec<FieldError>,
    },
    /// The client was built wrong, and says so at construction rather than at the first request.
    #[error("{detail}")]
    Configuration { detail: String },
    /// A failure that came back on a redirect (`?error=`), which carries no status or request id.
    #[error("{detail}")]
    Redirect {
        code: ErrorCode,
        raw_code: String,
        detail: String,
    },
    /// The platform's credential store refused. The stored token is left exactly as it was: a
    /// Keychain that cannot be read before first unlock is not a reason to sign anybody out.
    #[error("{detail}")]
    Storage { detail: String },
}

impl IdenzyError {
    /// The stable code for this failure, whichever variant carries it.
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::Api { code, .. } | Self::Redirect { code, .. } => *code,
            Self::Transport { .. } | Self::Storage { .. } => ErrorCode::ProviderUnavailable,
            Self::MissingCredentials { .. } => ErrorCode::MissingCredentials,
            Self::InvalidInput { .. } | Self::Configuration { .. } => ErrorCode::ValidationFailed,
        }
    }

    /// The server looked at the credential and said no. A 429 or a 500 may still pass.
    pub(crate) fn is_refusal(&self) -> bool {
        matches!(
            self,
            Self::Api {
                status: 401 | 403,
                ..
            }
        )
    }

    pub(crate) fn missing_credentials() -> Self {
        Self::MissingCredentials {
            detail: "There is no session. Sign in first.".into(),
        }
    }

    pub(crate) fn unexpected(detail: impl Into<String>, status: u16) -> Self {
        Self::Transport {
            reason: TransportReason::UnexpectedResponse,
            detail: detail.into(),
            status,
        }
    }

    pub(crate) fn configuration(detail: impl Into<String>) -> Self {
        Self::Configuration {
            detail: detail.into(),
        }
    }
}

/// The code of any error this library throws, for a foreign caller that cannot call methods on
/// an error value. Swift and Kotlin wrap it as a `code` property.
#[uniffi::export]
pub fn error_code(error: IdenzyError) -> ErrorCode {
    error.code()
}

/// The code as the API spelled it, for a bridge that passes strings on: the raw value of an
/// answer from the API, which may be newer than this build, and the known code's otherwise.
#[uniffi::export]
pub fn error_raw_code(error: IdenzyError) -> String {
    match error {
        IdenzyError::Api { raw_code, .. } | IdenzyError::Redirect { raw_code, .. } => raw_code,
        other => other.code().as_wire().unwrap_or_default().to_owned(),
    }
}
