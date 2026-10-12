//! What a response has to be before a caller sees it.

use std::sync::Arc;

use serde_json::json;

use crate::client::IdenzyClient;
use crate::config::ClientConfig;
use crate::error::{FieldError, IdenzyError, TransportReason};
use crate::protocol::ErrorCode;
use crate::testing::{FakeStore, FakeTransport, KEY, Reply, harness, run, user};

fn sign_in(h: &crate::testing::Harness) -> Result<crate::flows::AuthResult, IdenzyError> {
    run(h
        .client
        .password()
        .sign_in("ada@example.com".into(), "pw".into()))
}

#[test]
fn a_code_newer_than_this_build_arrives_as_unrecognised_with_its_raw_value() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/sign-in/password",
        Reply::Json(403, json!({ "error": { "code": "brand_new_code", "message": "No.", "requestId": "req_9" } })),
    );
    match sign_in(&h).unwrap_err() {
        IdenzyError::Api {
            code,
            raw_code,
            status,
            request_id,
            ..
        } => {
            assert_eq!(code, ErrorCode::Unrecognized);
            assert_eq!(raw_code, "brand_new_code");
            assert_eq!(status, 403);
            assert_eq!(request_id, "req_9");
        }
        other => panic!("expected an API error, got {other:?}"),
    }
}

#[test]
fn field_errors_and_retry_after_reach_the_caller() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/sign-in/password",
        Reply::Json(
            429,
            json!({ "error": {
                "code": "rate_limited", "message": "Slow down.", "requestId": "req_2",
                "retryAfterSeconds": 30, "fields": [{ "path": "email", "code": "invalid" }]
            } }),
        ),
    );
    match sign_in(&h).unwrap_err() {
        IdenzyError::Api {
            code,
            retry_after_seconds,
            fields,
            ..
        } => {
            assert_eq!(code, ErrorCode::RateLimited);
            assert_eq!(retry_after_seconds, Some(30));
            assert_eq!(
                fields,
                [FieldError {
                    path: "email".into(),
                    code: "invalid".into()
                }]
            );
        }
        other => panic!("expected an API error, got {other:?}"),
    }
}

#[test]
fn an_error_page_that_is_not_our_contract_keeps_its_real_status() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/sign-in/password",
        Reply::Raw(502, "<html>Bad gateway</html>".into()),
    );
    let error = sign_in(&h).unwrap_err();
    assert!(matches!(
        error,
        IdenzyError::Transport {
            reason: TransportReason::UnexpectedResponse,
            status: 502,
            ..
        }
    ));
    assert_eq!(error.code(), ErrorCode::ProviderUnavailable);
}

#[test]
fn a_captive_portal_answering_200_is_not_mistaken_for_a_sign_in() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/sign-in/password",
        Reply::Raw(200, "<html>Log in to Wi-Fi</html>".into()),
    );
    let error = sign_in(&h).unwrap_err();
    assert!(matches!(
        error,
        IdenzyError::Transport {
            reason: TransportReason::UnexpectedResponse,
            status: 200,
            ..
        }
    ));
    assert_eq!(h.store.get("refresh"), None);
}

#[test]
fn custom_metadata_crosses_as_json_text() {
    let h = harness();
    let session = super::signed_in(&h);
    let metadata: serde_json::Value =
        serde_json::from_str(&session.user.metadata_public_json).unwrap();
    assert_eq!(metadata, json!({ "plan": "pro" }));
    assert_eq!(
        serde_json::to_value(&metadata).unwrap(),
        user()["metadataPublic"]
    );
}

#[test]
fn every_request_names_the_project_and_asks_for_json() {
    let h = harness();
    super::signed_in(&h);
    let request = &h.transport.sent()[0];
    assert_eq!(
        request.url,
        "https://auth.example.test/v1/auth/sign-in/password"
    );
    assert_eq!(request.headers["x-idenzy-publishable-key"], KEY);
    assert_eq!(request.headers["accept"], "application/json");
    assert_eq!(request.headers["content-type"], "application/json");
}

#[test]
fn a_secret_key_is_refused_before_anything_is_sent() {
    let transport = Arc::new(FakeTransport::default());
    let outcome = IdenzyClient::new(
        ClientConfig {
            publishable_key: "sk_live_0123456789".into(),
            api_url: "https://auth.example.test".into(),
            device_name: None,
        },
        transport.clone(),
        Arc::new(FakeStore::default()),
    );
    assert!(matches!(outcome, Err(IdenzyError::Configuration { .. })));
    assert!(transport.sent().is_empty());
}
