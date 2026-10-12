//! Adoption, subscription and sign-out.

use std::sync::Arc;

use serde_json::json;

use super::{challenge_of, signed_in};
use crate::error::IdenzyError;
use crate::mfa::MfaProof;
use crate::protocol::ErrorCode;
use crate::session::{SessionListener, SessionState, SessionStatus, SignOutScope};
use crate::testing::{
    CHALLENGE_ID, FakeTransport, NOW, Recorder, Reply, harness, iso, jwt, run, user,
};
use crate::transport::{HttpMethod, TransportFailure};

const FIRST: &str = "rt_first_000000000000";

#[test]
fn signing_in_stores_the_refresh_token_and_names_the_device() {
    let h = harness();
    let session = signed_in(&h);

    assert_eq!(h.store.get("refresh").as_deref(), Some(FIRST));
    assert_eq!(h.client.state().status, SessionStatus::SignedIn);
    assert_eq!(h.client.state().session_id, Some(session.id));

    let request = &h.transport.sent()[0];
    assert_eq!(request.method, HttpMethod::Post);
    assert_eq!(request.headers["x-idenzy-device-name"], "Ada's%20Pixel");
    assert_eq!(request.headers["x-idenzy-session-transport"], "header");
    assert!(!request.headers.contains_key("authorization"));
}

#[test]
fn the_session_handed_out_never_carries_the_refresh_token() {
    let h = harness();
    let session = signed_in(&h);
    assert!(!format!("{session:?}").contains(FIRST));
    assert!(!format!("{:?}", h.client.state()).contains(FIRST));
}

#[test]
fn listeners_hear_each_change_of_status_once() {
    let h = harness();
    let recorder = Arc::new(Recorder::default());
    let subscription = h.client.subscribe(recorder.clone());
    signed_in(&h);
    run(h.client.get_token()).unwrap();
    h.transport
        .on("POST v1/auth/sign-out", Reply::Raw(204, String::new()));
    run(h.client.sign_out(SignOutScope::Current)).unwrap();

    let statuses: Vec<_> = recorder.states().iter().map(|state| state.status).collect();
    assert_eq!(
        statuses,
        [
            SessionStatus::SignedOut,
            SessionStatus::SignedIn,
            SessionStatus::SignedOut
        ]
    );

    subscription.cancel();
    signed_in(&h);
    assert_eq!(recorder.states().len(), 3);
}

struct Panics;

impl SessionListener for Panics {
    fn on_change(&self, _: SessionState) {
        panic!("a customer's listener has a bug");
    }
}

#[test]
fn a_listener_that_fails_does_not_stop_the_others_being_told() {
    let h = harness();
    let _first = h.client.subscribe(Arc::new(Panics));
    let recorder = Arc::new(Recorder::default());
    let _second = h.client.subscribe(recorder.clone());
    signed_in(&h);
    assert_eq!(
        recorder.states().last().unwrap().status,
        SessionStatus::SignedIn
    );
}

#[test]
fn a_newer_profile_reaches_subscribers_without_touching_the_tokens() {
    let h = harness();
    signed_in(&h);
    let recorder = Arc::new(Recorder::default());
    let _subscription = h.client.subscribe(recorder.clone());
    let mut renamed = user();
    renamed["displayName"] = json!("Ada Lovelace");
    h.transport.on("GET v1/users/me", Reply::Json(200, renamed));

    let me = run(h.client.account().me()).unwrap();

    assert_eq!(me.display_name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(
        h.client.user().unwrap().display_name.as_deref(),
        Some("Ada Lovelace")
    );
    assert_eq!(recorder.states().len(), 2);
    assert_eq!(h.store.get("refresh").as_deref(), Some(FIRST));
}

#[test]
fn sign_out_presents_both_tokens_and_ends_the_session_even_when_the_request_fails() {
    let h = harness();
    let session = signed_in(&h);
    h.transport.on(
        "POST v1/auth/sign-out",
        Reply::Fail(TransportFailure::NotSent {
            detail: "offline".into(),
        }),
    );

    let outcome = run(h.client.sign_out(SignOutScope::All));

    assert!(matches!(outcome, Err(IdenzyError::Transport { .. })));
    assert_eq!(h.client.state().status, SessionStatus::SignedOut);
    assert_eq!(h.store.get("refresh"), None);
    let request = &h.transport.sent_to("POST v1/auth/sign-out")[0];
    assert_eq!(
        FakeTransport::body_of(request),
        json!({ "scope": "all", "refreshToken": FIRST })
    );
    assert_eq!(
        request.headers["authorization"],
        format!("Bearer {}", session.access_token)
    );
}

#[test]
fn a_step_up_replaces_the_access_token_without_rotating_or_announcing() {
    let h = harness();
    signed_in(&h);
    let recorder = Arc::new(Recorder::default());
    let _subscription = h.client.subscribe(recorder.clone());
    h.transport.on(
        "POST v1/auth/mfa/step-up",
        Reply::Json(
            200,
            json!({
                "challengeId": CHALLENGE_ID,
                "purpose": "step_up",
                "factors": ["totp"],
                "expiresAt": iso(NOW + 600),
            }),
        ),
    );
    let stepped = jwt(NOW + 10, NOW + 310);
    h.transport.on(
        "POST v1/auth/mfa/step-up/verify",
        Reply::Json(
            200,
            json!({
                "accessToken": stepped,
                "accessTokenExpiresAt": iso(NOW + 310),
                "factorVerifiedAt": iso(NOW + 10),
            }),
        ),
    );

    let challenge = run(h.client.mfa().start_step_up()).unwrap().unwrap();
    let session = run(challenge.submit(MfaProof::Totp {
        code: "123456".into(),
    }))
    .unwrap();

    assert_eq!(session.access_token, stepped);
    assert_eq!(run(h.client.get_token()).unwrap(), Some(stepped));
    assert!(h.transport.sent_to("POST v1/auth/refresh").is_empty());
    assert_eq!(h.store.get("refresh").as_deref(), Some(FIRST));
    assert_eq!(
        recorder.states().len(),
        1,
        "a step-up was announced as a change"
    );
}

#[test]
fn no_step_up_is_owed_when_the_server_answers_204() {
    let h = harness();
    signed_in(&h);
    h.transport
        .on("POST v1/auth/mfa/step-up", Reply::Raw(204, String::new()));
    assert!(run(h.client.mfa().start_step_up()).unwrap().is_none());
}

#[test]
fn calls_on_an_account_without_a_session_are_refused_before_sending() {
    let h = harness();
    let error = run(h.client.sessions().list()).unwrap_err();
    assert_eq!(error.code(), ErrorCode::MissingCredentials);
    assert!(h.transport.sent().is_empty());
}

#[test]
fn revoking_this_devices_own_session_signs_it_out_here() {
    let h = harness();
    let session = signed_in(&h);
    h.transport.on(
        &format!("DELETE v1/sessions/{}", session.id),
        Reply::Raw(204, String::new()),
    );
    run(h.client.sessions().revoke(session.id)).unwrap();
    assert_eq!(h.client.state().status, SessionStatus::SignedOut);
    assert_eq!(h.store.get("refresh"), None);
}

#[test]
fn a_sign_in_challenge_finishes_through_the_challenge_itself() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/sign-in/password",
        Reply::Json(200, crate::testing::mfa_required(&["totp", "recovery"])),
    );
    h.transport.on(
        "POST v1/auth/mfa/verify",
        Reply::Json(200, crate::testing::authenticated(FIRST, NOW)),
    );

    let result = run(h
        .client
        .password()
        .sign_in("ada@example.com".into(), "pw".into()))
    .unwrap();
    assert_eq!(h.client.state().status, SessionStatus::SignedOut);
    let challenge = challenge_of(result);
    run(challenge.submit(MfaProof::RecoveryCode {
        code: "ABCDE-FGHIJ".into(),
    }))
    .unwrap();

    assert_eq!(h.client.state().status, SessionStatus::SignedIn);
    let request = &h.transport.sent_to("POST v1/auth/mfa/verify")[0];
    assert_eq!(
        FakeTransport::body_of(request),
        json!({ "challengeId": CHALLENGE_ID, "factor": "recovery", "code": "ABCDE-FGHIJ" })
    );
    assert_eq!(request.headers["x-idenzy-device-name"], "Ada's%20Pixel");
}
