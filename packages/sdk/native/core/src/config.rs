//! The client's settings, validated once at construction (PROJECT.md 7.2.9).

use crate::error::IdenzyError;
use crate::protocol::api_key_prefix;

/// Whether a host is this machine, where plain http is accepted because a developer has no
/// certificate. A transcription of `isLoopbackHost` in `@idenzy/protocol/http/loopback`, tested
/// against the same cases, because a host one reader counts and another does not is a development
/// setup that fails at the second step for no stated reason.
///
/// An Android emulator reaches its host's loopback through `adb reverse`, which keeps this rule
/// the protocol's rather than widening it by the emulator's alias address.
fn is_loopback_host(hostname: &str) -> bool {
    let host = hostname.trim().to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return host.split('.').all(is_dns_label);
    }
    matches!(host.as_str(), "127.0.0.1" | "[::1]" | "::1")
}

/// Letters, digits and inner hyphens, so `evil.com/.localhost` is not a host.
fn is_dns_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    let alphanumeric = |byte: &u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    match (bytes.first(), bytes.last()) {
        (Some(first), Some(last)) => {
            bytes.len() <= 63
                && alphanumeric(first)
                && alphanumeric(last)
                && bytes.iter().all(|byte| alphanumeric(byte) || *byte == b'-')
        }
        _ => false,
    }
}

/// What 200 is: the length the server stores for a device name.
const DEVICE_NAME_MAX_CHARS: usize = 200;

/// What a platform SDK passes in.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ClientConfig {
    /// The project's publishable key. A secret key is refused before any request is made.
    pub publishable_key: String,
    /// The auth API: a custom auth domain, or the shared host.
    pub api_url: String,
    /// What to call this device in the user's own session list. Display text only; leave it
    /// unset rather than guess, because a wrong name on a security screen is worse than none.
    pub device_name: Option<String>,
}

/// The same settings, proven usable.
#[derive(Debug, Clone)]
pub(crate) struct Config {
    pub publishable_key: String,
    base_url: String,
    pub device_name: Option<String>,
}

impl Config {
    /// Refuses the two mistakes that otherwise work perfectly until they matter.
    ///
    /// A secret key in an app binary authenticates every request until somebody unzips the
    /// binary, and nothing after that unpublishes it. Plain http to a real host carries the key
    /// and every token in clear while looking exactly like the working thing.
    pub fn parse(input: ClientConfig) -> Result<Self, IdenzyError> {
        Ok(Self {
            publishable_key: publishable(input.publishable_key)?,
            base_url: secure_base(&input.api_url)?,
            device_name: device_name(input.device_name),
        })
    }

    /// An absolute URL for a path relative to the API base, which always ends in a slash.
    pub fn url_for(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// The namespace this project's values are stored under, so two projects or two
    /// environments in one app never resume each other's sessions (ADR-0008).
    pub fn storage_key(&self, name: &str) -> String {
        format!("idenzy.{}.{}", self.publishable_key, name)
    }
}

fn publishable(key: String) -> Result<String, IdenzyError> {
    if key.starts_with(api_key_prefix::SECRET) {
        return Err(IdenzyError::configuration(format!(
            "A secret key was passed to a client SDK. Use the {} key: an {} key must never ship in an app.",
            api_key_prefix::PUBLISHABLE,
            api_key_prefix::SECRET,
        )));
    }
    if !key.starts_with(api_key_prefix::PUBLISHABLE) {
        return Err(IdenzyError::configuration(format!(
            "publishableKey must start with {}.",
            api_key_prefix::PUBLISHABLE
        )));
    }
    Ok(key)
}

fn secure_base(api_url: &str) -> Result<String, IdenzyError> {
    let not_a_url =
        || IdenzyError::configuration(format!("apiUrl is not an absolute URL: {api_url}"));
    let (scheme, rest) = api_url.split_once("://").ok_or_else(not_a_url)?;
    let scheme = scheme.to_ascii_lowercase();
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return Err(not_a_url());
    }
    if rest.contains(['?', '#']) {
        return Err(IdenzyError::configuration(format!(
            "apiUrl must not carry a query or a fragment: {api_url}"
        )));
    }
    let host = host_of(authority).to_ascii_lowercase();
    let secure = match scheme.as_str() {
        "https" => true,
        "http" => is_loopback_host(&host),
        _ => return Err(not_a_url()),
    };
    if !secure {
        return Err(IdenzyError::configuration(format!(
            "apiUrl must be https outside loopback: {api_url}"
        )));
    }
    // A trailing slash, so every path resolves under the whole base: without it a base of
    // https://auth.example.com/api would drop `/api` from every request.
    let base = format!("{scheme}://{rest}");
    Ok(if base.ends_with('/') {
        base
    } else {
        format!("{base}/")
    })
}

fn host_of(authority: &str) -> &str {
    if authority.starts_with('[') {
        return authority.split_inclusive(']').next().unwrap_or(authority);
    }
    authority.split(':').next().unwrap_or(authority)
}

/// A blank name is no name, and a long one is cut here rather than on arrival. A name is never a
/// reason to refuse a configuration.
fn device_name(value: Option<String>) -> Option<String> {
    let trimmed = value.as_deref().map(str::trim).unwrap_or_default();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(DEVICE_NAME_MAX_CHARS).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(key: &str, url: &str) -> Result<Config, IdenzyError> {
        Config::parse(ClientConfig {
            publishable_key: key.into(),
            api_url: url.into(),
            device_name: None,
        })
    }

    #[test]
    fn refuses_a_secret_key_on_its_prefix() {
        let error = config("sk_live_abc", "https://auth.example.com").unwrap_err();
        assert!(matches!(error, IdenzyError::Configuration { .. }));
        assert!(error.to_string().contains("secret key"));
    }

    #[test]
    fn refuses_a_key_that_is_not_publishable() {
        assert!(config("prj_abc", "https://auth.example.com").is_err());
    }

    #[test]
    fn refuses_plain_http_to_a_real_host() {
        assert!(config("pk_test_x", "http://auth.example.com").is_err());
        assert!(config("pk_test_x", "http://10.0.2.2:3000").is_err());
    }

    #[test]
    fn accepts_plain_http_on_loopback() {
        for url in [
            "http://localhost:3000",
            "http://auth.app.localhost:3000",
            "http://127.0.0.1",
            "http://[::1]:8080",
        ] {
            assert!(config("pk_test_x", url).is_ok(), "{url}");
        }
    }

    /// The cases of `packages/protocol/test/loopback.test.ts`, verbatim.
    #[test]
    fn loopback_is_the_protocols_rule() {
        for host in [
            "localhost",
            "LOCALHOST",
            "app.localhost",
            "auth.app.localhost",
        ] {
            assert!(is_loopback_host(host), "{host}");
        }
        for host in ["127.0.0.1", "[::1]", "::1"] {
            assert!(is_loopback_host(host), "{host}");
        }
        for host in [
            "localhost.example.com",
            "notlocalhost",
            "evil.com/.localhost",
            "a..localhost",
            "-a.localhost",
            "127.0.0.2",
            "",
        ] {
            assert!(!is_loopback_host(host), "{host}");
        }
    }

    #[test]
    fn refuses_what_is_not_a_url() {
        for url in [
            "auth.example.com",
            "ftp://auth.example.com",
            "https://",
            "https://u:p@h.com",
        ] {
            assert!(config("pk_test_x", url).is_err(), "{url}");
        }
        assert!(config("pk_test_x", "https://auth.example.com/?x=1").is_err());
    }

    #[test]
    fn keeps_the_base_path_when_resolving() {
        let parsed = config("pk_test_x", "https://example.com/api").unwrap();
        assert_eq!(
            parsed.url_for("v1/auth/refresh"),
            "https://example.com/api/v1/auth/refresh"
        );
        let parsed = config("pk_test_x", "https://auth.example.com/").unwrap();
        assert_eq!(
            parsed.url_for("v1/sessions"),
            "https://auth.example.com/v1/sessions"
        );
    }

    #[test]
    fn trims_and_caps_the_device_name() {
        assert_eq!(device_name(Some("   ".into())), None);
        assert_eq!(
            device_name(Some("  Pixel 9 ".into())),
            Some("Pixel 9".into())
        );
        assert_eq!(
            device_name(Some("ı".repeat(300))).unwrap().chars().count(),
            200
        );
    }

    #[test]
    fn namespaces_storage_by_project() {
        let parsed = config("pk_test_x", "https://auth.example.com").unwrap();
        assert_eq!(parsed.storage_key("refresh"), "idenzy.pk_test_x.refresh");
    }
}
