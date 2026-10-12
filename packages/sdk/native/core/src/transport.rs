//! How a request leaves the device, implemented by the platform SDK.
//!
//! A port rather than an HTTP client of our own, so the request goes through the stack the
//! operating system already configures: the user's proxy, App Transport Security, a customer's
//! certificate pinning, the network inspector a developer is already using. It also keeps a TLS
//! implementation out of this library, which is the largest dependency it does not have.

use std::collections::HashMap;

use crate::error::{IdenzyError, TransportReason};

/// The methods the core sends. No `PATCH`: nothing uses it, and Android's `HttpURLConnection`
/// cannot send it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum HttpMethod {
    Get,
    Post,
    Delete,
}

impl HttpMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Delete => "DELETE",
        }
    }
}

/// One request, already encoded. The core owns the bytes; the transport only sends them.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HttpRequest {
    pub url: String,
    pub method: HttpMethod,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

/// Why a request got no response, as precisely as the platform can tell.
///
/// Report `NotSent` only when the platform can prove no byte reached the server: the device is
/// offline, the name did not resolve, the connection was refused, the TLS handshake failed. When
/// in doubt it is `Interrupted`. Calling a lost answer `NotSent` lets the core present a refresh
/// token that may already have been rotated, which revokes the whole session (ADR-0007).
#[derive(Debug, Clone, PartialEq, thiserror::Error, uniffi::Error)]
pub enum TransportFailure {
    #[error("{detail}")]
    NotSent { detail: String },
    #[error("{detail}")]
    Interrupted { detail: String },
}

impl From<uniffi::UnexpectedUniFFICallbackError> for TransportFailure {
    /// A transport that threw something undeclared may have sent the request first.
    fn from(error: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::Interrupted {
            detail: format!("The transport failed unexpectedly: {}", error.reason),
        }
    }
}

impl TransportFailure {
    pub(crate) fn into_error(self, url: &str) -> IdenzyError {
        let (reason, detail) = match self {
            Self::NotSent { detail } => (TransportReason::NotSent, detail),
            Self::Interrupted { detail } => (TransportReason::Interrupted, detail),
        };
        IdenzyError::Transport {
            reason,
            detail: format!("The request to {url} did not complete: {detail}"),
            status: 0,
        }
    }
}

/// Sends one request and answers with whatever status came back, 4xx and 5xx included.
///
/// Implementations must not follow redirects, store cookies, or retry. The API answers JSON only;
/// a redirect is a misconfiguration to surface, a cookie jar would carry a session the header
/// mode never asked for, and a retry is exactly the second presentation of a refresh token that
/// the core exists to prevent.
#[uniffi::export(with_foreign)]
#[async_trait::async_trait]
pub trait HttpTransport: Send + Sync {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportFailure>;
}
