//! Reads what our redirect left on the app's own URL (`redirect-result.ts` in `@idenzy/js`).
//!
//! Every flow that leaves the app comes back the same way: `?code=` with a single-use code, or
//! `?error=` with one of the stable codes. On a phone that URL arrives through a custom scheme or
//! an app link, from wherever the system decided to deliver it, so it is parsed as untrusted.

use crate::encoding::form_decode;
use crate::error::IdenzyError;
use crate::protocol::ErrorCode;

/// The code, `None` when the URL is not a return from us, or the failure it reports.
///
/// The error is checked against the enum rather than trusted, because anything can open an app
/// link with any query. An unknown value becomes `oauth_provider_error`, which is what an
/// unexplained failure on the way back from a provider is.
pub(crate) fn code_from_redirect(url: &str) -> Result<Option<String>, IdenzyError> {
    let mut code = None;
    for (key, value) in query_pairs(url) {
        match key.as_str() {
            "error" => {
                let parsed = ErrorCode::from_wire(&value);
                let code = match parsed {
                    ErrorCode::Unrecognized => ErrorCode::OauthProviderError,
                    known => known,
                };
                let raw_code = code.as_wire().unwrap_or_default().to_owned();
                return Err(IdenzyError::Redirect {
                    detail: format!("The sign-in did not complete: {raw_code}."),
                    code,
                    raw_code,
                });
            }
            "code" if code.is_none() && !value.is_empty() => code = Some(value),
            _ => {}
        }
    }
    Ok(code)
}

fn query_pairs(url: &str) -> Vec<(String, String)> {
    let without_fragment = url.split('#').next().unwrap_or_default();
    let Some((_, query)) = without_fragment.split_once('?') else {
        return Vec::new();
    };
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            (form_decode(key), form_decode(value))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_code_from_a_custom_scheme() {
        let code =
            code_from_redirect("com.example.app://auth/callback?code=abc%2Bdef&x=1").unwrap();
        assert_eq!(code.as_deref(), Some("abc+def"));
    }

    #[test]
    fn ignores_a_url_that_is_not_a_return_from_us() {
        assert_eq!(
            code_from_redirect("https://example.com/home").unwrap(),
            None
        );
        assert_eq!(
            code_from_redirect("https://example.com/cb?state=x#code=y").unwrap(),
            None
        );
    }

    #[test]
    fn reports_a_known_error_as_itself() {
        let error = code_from_redirect("app://cb?error=redirect_uri_not_allowed").unwrap_err();
        assert_eq!(error.code(), ErrorCode::RedirectUriNotAllowed);
    }

    #[test]
    fn reports_an_unknown_error_as_a_provider_error() {
        let error = code_from_redirect("app://cb?error=%3Cscript%3E&code=abc").unwrap_err();
        assert_eq!(error.code(), ErrorCode::OauthProviderError);
        assert!(!error.to_string().contains("script"));
    }
}
