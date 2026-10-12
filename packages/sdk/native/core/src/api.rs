//! Everything this library knows about talking to the auth API: which project, how the session
//! is carried, and what an answer must look like before a caller sees it.

use std::collections::HashMap;
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::config::Config;
use crate::encoding::percent_encode_component;
use crate::error::IdenzyError;
use crate::protocol::{ErrorBody, ErrorCode, header, session_transport};
use crate::transport::{HttpMethod, HttpRequest, HttpResponse, HttpTransport};

/// One call, described. Built by the flows and nowhere else.
#[derive(Debug, Clone)]
pub(crate) struct Call {
    method: HttpMethod,
    path: String,
    body: Option<Value>,
    access_token: Option<String>,
    names_device: bool,
    attestation: Option<String>,
}

impl Call {
    pub fn get(path: impl Into<String>) -> Self {
        Self::new(HttpMethod::Get, path)
    }

    pub fn post(path: impl Into<String>) -> Self {
        Self::new(HttpMethod::Post, path)
    }

    pub fn delete(path: impl Into<String>) -> Self {
        Self::new(HttpMethod::Delete, path)
    }

    fn new(method: HttpMethod, path: impl Into<String>) -> Self {
        Self {
            method,
            path: path.into(),
            body: None,
            access_token: None,
            names_device: false,
            attestation: None,
        }
    }

    pub fn body(mut self, body: Value) -> Self {
        self.body = Some(body);
        self
    }

    pub fn bearer(mut self, token: String) -> Self {
        self.access_token = Some(token);
        self
    }

    pub fn bearer_if(mut self, token: Option<String>) -> Self {
        self.access_token = token;
        self
    }

    /// Carries the device name. Only the calls that create a session set it, because that is
    /// the only place the server reads it (`SessionFlow.establish` in `@idenzy/js`).
    pub fn naming_device(mut self) -> Self {
        self.names_device = true;
        self
    }

    /// A CAPTCHA or app-attestation token, per call because it is single use (PROJECT.md 4.8).
    pub fn attestation(mut self, token: Option<String>) -> Self {
        self.attestation = token;
        self
    }
}

pub(crate) struct ApiClient {
    config: Config,
    transport: Arc<dyn HttpTransport>,
}

impl ApiClient {
    pub fn new(config: Config, transport: Arc<dyn HttpTransport>) -> Self {
        Self { config, transport }
    }

    /// Sends, then parses the answer against the endpoint's schema. Never cast: a proxy or a
    /// captive portal answers 200 with something shaped nothing like us.
    pub async fn send<T: DeserializeOwned>(&self, call: Call) -> Result<T, IdenzyError> {
        let path = call.path.clone();
        let response = self.exchange(call).await?;
        parse(&path, &response)
    }

    /// For the routes that answer 202 or 204 and mean it.
    pub async fn send_void(&self, call: Call) -> Result<(), IdenzyError> {
        self.exchange(call).await.map(|_| ())
    }

    /// For the routes whose honest answer is "nothing here", which they say with 204.
    pub async fn send_optional<T: DeserializeOwned>(
        &self,
        call: Call,
    ) -> Result<Option<T>, IdenzyError> {
        let path = call.path.clone();
        let response = self.exchange(call).await?;
        if response.status == 204 {
            return Ok(None);
        }
        parse(&path, &response).map(Some)
    }

    /// One attempt, always. Header mode has nothing to negotiate, so unlike the browser client
    /// there is no refusal here that is safe to retry, and no retry at all.
    async fn exchange(&self, call: Call) -> Result<HttpResponse, IdenzyError> {
        let url = self.config.url_for(&call.path);
        let body = call.body.as_ref().map(Value::to_string);
        let request = HttpRequest {
            url: url.clone(),
            method: call.method,
            headers: self.headers_for(&call, body.is_some()),
            body,
        };
        let response = self
            .transport
            .send(request)
            .await
            .map_err(|failure| failure.into_error(&url))?;
        if response.status >= 400 {
            return Err(error_from_response(&response));
        }
        Ok(response)
    }

    /// The publishable key goes on every request, signed in or not, so a request always names
    /// its project rather than resolving through whatever host it reached.
    fn headers_for(&self, call: &Call, has_body: bool) -> HashMap<String, String> {
        let mut headers = HashMap::from([
            ("accept".to_owned(), "application/json".to_owned()),
            (
                header::PUBLISHABLE_KEY.to_owned(),
                self.config.publishable_key.clone(),
            ),
            (
                header::SESSION_TRANSPORT.to_owned(),
                session_transport::HEADER.to_owned(),
            ),
        ]);
        if has_body {
            headers.insert("content-type".into(), "application/json".into());
        }
        if call.names_device {
            if let Some(name) = &self.config.device_name {
                // Percent-encoded: a header carries bytes, and a name in most languages is not
                // ASCII. The server decodes it the way the browser SDK's encoding requires.
                headers.insert(header::DEVICE_NAME.into(), percent_encode_component(name));
            }
        }
        if let Some(token) = &call.attestation {
            // Exactly as the platform issued it: the server compares it byte for byte.
            headers.insert(header::ATTESTATION.into(), token.clone());
        }
        if let Some(token) = &call.access_token {
            headers.insert("authorization".into(), format!("Bearer {token}"));
        }
        headers
    }
}

fn parse<T: DeserializeOwned>(path: &str, response: &HttpResponse) -> Result<T, IdenzyError> {
    serde_json::from_str(&response.body).map_err(|error| {
        IdenzyError::unexpected(
            format!("The answer from {path} was not the shape this endpoint promises: {error}"),
            response.status,
        )
    })
}

/// A failed response, parsed rather than trusted: a load balancer's 502 page arrives on the same
/// path as our own error contract, and a caller must never be handed a code we did not send.
fn error_from_response(response: &HttpResponse) -> IdenzyError {
    match serde_json::from_str::<ErrorBody>(&response.body) {
        Ok(ErrorBody { error }) => IdenzyError::Api {
            code: ErrorCode::from_wire(&error.code),
            raw_code: error.code,
            detail: error.message,
            status: response.status,
            request_id: error.request_id,
            fields: error.fields,
            retry_after_seconds: error.retry_after_seconds,
        },
        Err(_) => IdenzyError::unexpected(
            format!(
                "The API answered {} with an unrecognised body.",
                response.status
            ),
            response.status,
        ),
    }
}
