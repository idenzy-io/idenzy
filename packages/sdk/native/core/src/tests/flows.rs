//! The ways in, as requests on the wire.

use serde_json::json;
use sha2::{Digest, Sha256};

use super::{challenge_of, session_of, signed_in};
use crate::encoding::base64url_encode;
use crate::error::IdenzyError;
use crate::protocol::{ErrorCode, MfaChallengePurpose, MfaFactorType};
use crate::testing::{
    CHALLENGE_ID, FakeTransport, NOW, Reply, authenticated, harness, iso, mfa_required, run,
    yield_now,
};

const FIRST: &str = "rt_first_000000000000";

fn started() -> Reply {
    Reply::Json(
        200,
        json!({ "challengeId": CHALLENGE_ID, "expiresAt": iso(NOW + 600) }),
    )
}

#[test]
fn sign_up_sends_a_display_name_only_when_there_is_one() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/sign-up/password",
        Reply::Json(200, authenticated(FIRST, NOW)),
    );
    h.transport.on(
        "POST v1/auth/sign-up/password",
        Reply::Json(200, authenticated(FIRST, NOW)),
    );

    run(h
        .client
        .password()
        .sign_up("a@example.com".into(), "pw".into(), None))
    .unwrap();
    run(h
        .client
        .password()
        .sign_up("a@example.com".into(), "pw".into(), Some("Ada".into())))
    .unwrap();

    let sent = h.transport.sent_to("POST v1/auth/sign-up/password");
    assert_eq!(
        FakeTransport::body_of(&sent[0]),
        json!({ "email": "a@example.com", "password": "pw" })
    );
    assert_eq!(
        FakeTransport::body_of(&sent[1])["displayName"],
        json!("Ada")
    );
}

#[test]
fn a_challenge_lists_a_factor_newer_than_this_build_as_unrecognised() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/sign-in/password",
        Reply::Json(200, mfa_required(&["passkey", "totp", "carrier_pigeon"])),
    );
    let challenge = challenge_of(
        run(h
            .client
            .password()
            .sign_in("ada@example.com".into(), "pw".into()))
        .unwrap(),
    );
    assert_eq!(challenge.purpose(), MfaChallengePurpose::SignIn);
    assert_eq!(
        challenge.factors(),
        [
            MfaFactorType::Passkey,
            MfaFactorType::Totp,
            MfaFactorType::Unrecognized
        ]
    );
}

#[test]
fn a_second_challenge_in_reply_to_the_first_is_a_protocol_mismatch() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/sign-in/password",
        Reply::Json(200, mfa_required(&["totp"])),
    );
    h.transport.on(
        "POST v1/auth/mfa/verify",
        Reply::Json(200, mfa_required(&["totp"])),
    );
    let challenge = challenge_of(
        run(h
            .client
            .password()
            .sign_in("ada@example.com".into(), "pw".into()))
        .unwrap(),
    );
    let error = run(challenge.submit(crate::mfa::MfaProof::Totp {
        code: "123456".into(),
    }))
    .unwrap_err();
    assert!(matches!(error, IdenzyError::Transport { status: 200, .. }));
}

#[test]
fn an_otp_is_verified_against_the_challenge_this_client_started() {
    let h = harness();
    h.transport.on("POST v1/auth/otp/start", started());
    h.transport.on(
        "POST v1/auth/otp/verify",
        Reply::Json(200, authenticated(FIRST, NOW)),
    );

    run(h.client.otp().start_email("ada@example.com".into())).unwrap();
    session_of(run(h.client.otp().verify("123456".into(), None)).unwrap());

    let start = &h.transport.sent_to("POST v1/auth/otp/start")[0];
    assert_eq!(
        FakeTransport::body_of(start),
        json!({ "channel": "email", "email": "ada@example.com" })
    );
    let verify = &h.transport.sent_to("POST v1/auth/otp/verify")[0];
    assert_eq!(
        FakeTransport::body_of(verify),
        json!({ "challengeId": CHALLENGE_ID, "code": "123456" })
    );
}

#[test]
fn an_otp_with_no_challenge_is_refused_before_sending() {
    let h = harness();
    let error = run(h.client.otp().verify("123456".into(), None)).unwrap_err();
    assert_eq!(error.code(), ErrorCode::ValidationFailed);
    assert!(h.transport.sent().is_empty());
}

#[test]
fn an_sms_start_carries_its_attestation_exactly_as_issued() {
    let h = harness();
    h.transport.on("POST v1/auth/otp/start", started());
    run(h
        .client
        .otp()
        .start_sms("+905551112233".into(), Some("att+/=token".into())))
    .unwrap();
    let request = &h.transport.sent()[0];
    assert_eq!(request.headers["x-idenzy-attestation"], "att+/=token");
    assert_eq!(FakeTransport::body_of(request)["channel"], json!("sms"));
}

#[test]
fn oauth_keeps_the_verifier_before_asking_and_spends_it_on_the_way_back() {
    let h = harness();
    let gate = h.transport.on_later("POST v1/auth/oauth/google/start");
    h.transport.on(
        "POST v1/auth/oauth/exchange",
        Reply::Json(200, authenticated(FIRST, NOW)),
    );

    let answer = async {
        while h.transport.sent().is_empty() {
            yield_now().await;
        }
        let stored_when_sent = h.store.get("pkce");
        gate.send(Reply::Json(
            200,
            json!({ "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?x=1" }),
        ))
        .ok();
        stored_when_sent
    };
    let oauth = h.client.oauth();
    let (url, stored_when_sent) = run(async {
        futures::join!(
            oauth.authorization_url("google".into(), "com.example.app://cb".into()),
            answer
        )
    });

    assert!(url.unwrap().starts_with("https://accounts.google.com/"));
    let verifier = stored_when_sent.expect("the verifier was stored after the request");
    let start = &h.transport.sent()[0];
    let challenge = base64url_encode(&Sha256::digest(verifier.as_bytes()));
    assert_eq!(
        FakeTransport::body_of(start),
        json!({ "redirectUri": "com.example.app://cb", "codeChallenge": challenge })
    );

    let result = run(h
        .client
        .oauth()
        .complete("com.example.app://cb?code=exchange_code_0000000000".into()));
    session_of(result.unwrap().unwrap());
    let exchange = &h.transport.sent_to("POST v1/auth/oauth/exchange")[0];
    assert_eq!(
        FakeTransport::body_of(exchange),
        json!({ "code": "exchange_code_0000000000", "codeVerifier": verifier })
    );
    assert_eq!(
        h.store.get("pkce"),
        None,
        "a single-use verifier outlived its exchange"
    );
}

#[test]
fn an_oauth_return_carrying_an_error_reports_it_and_forgets_the_verifier() {
    let h = harness();
    h.store.put("pkce", "verifier");
    let error = run(h
        .client
        .oauth()
        .complete("com.example.app://cb?error=oauth_state_invalid".into()))
    .unwrap_err();
    assert_eq!(error.code(), ErrorCode::OauthStateInvalid);
    assert_eq!(h.store.get("pkce"), None);
    assert!(h.transport.sent().is_empty());
}

#[test]
fn a_url_that_is_not_a_return_from_us_is_left_alone() {
    let h = harness();
    assert!(
        run(h
            .client
            .oauth()
            .complete("com.example.app://settings".into()))
        .unwrap()
        .is_none()
    );
    assert!(
        run(h
            .client
            .magic_link()
            .complete("https://example.com/".into()))
        .unwrap()
        .is_none()
    );
    assert!(h.transport.sent().is_empty());
}

#[test]
fn linking_a_provider_needs_a_session_and_presents_it() {
    let h = harness();
    let refused = run(h
        .client
        .oauth()
        .link_url("github".into(), "app://cb".into()))
    .unwrap_err();
    assert_eq!(refused.code(), ErrorCode::MissingCredentials);

    let session = signed_in(&h);
    h.transport.on(
        "POST v1/auth/oauth/github/link",
        Reply::Json(
            200,
            json!({ "authorizationUrl": "https://github.com/login/oauth/authorize" }),
        ),
    );
    run(h
        .client
        .oauth()
        .link_url("github".into(), "app://cb".into()))
    .unwrap();
    let request = &h.transport.sent_to("POST v1/auth/oauth/github/link")[0];
    assert_eq!(
        request.headers["authorization"],
        format!("Bearer {}", session.access_token)
    );
}

#[test]
fn a_magic_link_finishes_from_the_url_the_app_was_opened_with() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/magic-link/exchange",
        Reply::Json(200, authenticated(FIRST, NOW)),
    );
    let result = run(h
        .client
        .magic_link()
        .complete("https://app.example.com/auth?code=ml_code_000000000000000".into()));
    session_of(result.unwrap().unwrap());
    let request = &h.transport.sent()[0];
    assert_eq!(
        FakeTransport::body_of(request),
        json!({ "code": "ml_code_000000000000000" })
    );
}

#[test]
fn an_anonymous_upgrade_presents_the_anonymous_session() {
    let h = harness();
    h.transport.on(
        "POST v1/auth/anonymous",
        Reply::Json(200, authenticated(FIRST, NOW)),
    );
    h.transport.on(
        "POST v1/auth/anonymous/upgrade",
        Reply::Json(200, authenticated("rt_upgraded_0000000000", NOW)),
    );

    let anonymous = session_of(run(h.client.anonymous().sign_in()).unwrap());
    run(h
        .client
        .anonymous()
        .upgrade("ada@example.com".into(), "pw".into()))
    .unwrap();

    let request = &h.transport.sent_to("POST v1/auth/anonymous/upgrade")[0];
    assert_eq!(
        request.headers["authorization"],
        format!("Bearer {}", anonymous.access_token)
    );
    assert_eq!(
        h.store.get("refresh").as_deref(),
        Some("rt_upgraded_0000000000")
    );
}

#[test]
fn a_native_sign_in_hands_the_sheet_a_digest_and_the_api_the_nonce() {
    use crate::flows::id_token::NativeProvider;

    let h = harness();
    h.transport.on(
        "POST v1/auth/id-token/nonce",
        Reply::Json(
            200,
            json!({ "nonce": "server-nonce", "expiresAt": iso(NOW + 600) }),
        ),
    );
    h.transport.on(
        "POST v1/auth/id-token",
        Reply::Json(200, authenticated(FIRST, NOW)),
    );

    let prepared = run(h.client.id_token().prepare()).unwrap();
    assert_eq!(prepared.nonce, "server-nonce");
    assert_eq!(prepared.digest, base16(&Sha256::digest(b"server-nonce")));

    let result = run(h.client.id_token().exchange(
        NativeProvider::Apple,
        "apple.id.token".into(),
        prepared.nonce,
        Some("  Ada Lovelace ".into()),
    ));
    session_of(result.unwrap());

    let request = &h.transport.sent_to("POST v1/auth/id-token")[0];
    assert_eq!(
        FakeTransport::body_of(request),
        json!({ "provider": "apple", "idToken": "apple.id.token", "nonce": "server-nonce", "displayName": "Ada Lovelace" })
    );
    assert_eq!(request.headers["x-idenzy-device-name"], "Ada's%20Pixel");
    assert_eq!(h.store.get("refresh").as_deref(), Some(FIRST));
}

#[test]
fn a_passkey_sign_in_hands_the_platform_the_options_and_the_api_its_response_as_json() {
    let h = harness();
    let options = json!({ "challenge": "Y2hhbGxlbmdl", "rpId": "example.com", "userVerification": "required" });
    h.transport.on(
        "POST v1/auth/passkeys/authentication/options",
        Reply::Json(
            200,
            json!({ "challengeId": CHALLENGE_ID, "expiresAt": iso(NOW + 300), "publicKey": options }),
        ),
    );
    h.transport.on(
        "POST v1/auth/passkeys/authentication",
        Reply::Json(200, authenticated(FIRST, NOW)),
    );

    let ceremony = run(h.client.passkeys().authentication_options()).unwrap();
    assert_eq!(ceremony.challenge_id, CHALLENGE_ID);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&ceremony.options_json).unwrap(),
        options
    );

    let assertion = json!({ "id": "Y3JlZA", "rawId": "Y3JlZA", "type": "public-key", "response": { "clientDataJSON": "e30" } });
    session_of(
        run(h
            .client
            .passkeys()
            .sign_in(ceremony.challenge_id, assertion.to_string()))
        .unwrap(),
    );
    let request = &h.transport.sent_to("POST v1/auth/passkeys/authentication")[0];
    assert_eq!(
        FakeTransport::body_of(request),
        json!({ "challengeId": CHALLENGE_ID, "response": assertion })
    );
    assert_eq!(h.store.get("refresh").as_deref(), Some(FIRST));
}

#[test]
fn adding_a_passkey_needs_a_session_and_presents_it() {
    let h = harness();
    let refused = run(h.client.passkeys().registration_options()).unwrap_err();
    assert_eq!(refused.code(), ErrorCode::MissingCredentials);
    assert!(h.transport.sent().is_empty());

    let session = signed_in(&h);
    h.transport.on(
        "POST v1/auth/passkeys/registration",
        Reply::Json(
            201,
            json!({ "id": "pk_1", "name": "Phone", "transports": ["internal"], "backupEligible": true, "backedUp": true, "createdAt": iso(NOW), "lastUsedAt": null }),
        ),
    );
    let passkey = run(h.client.passkeys().register(
        CHALLENGE_ID.into(),
        r#"{"id":"Y3JlZA","type":"public-key"}"#.into(),
        Some("  Phone ".into()),
    ))
    .unwrap();
    assert_eq!(passkey.name.as_deref(), Some("Phone"));
    assert!(passkey.last_used_at.is_none());

    let request = &h.transport.sent_to("POST v1/auth/passkeys/registration")[0];
    assert_eq!(
        request.headers["authorization"],
        format!("Bearer {}", session.access_token)
    );
    assert_eq!(
        FakeTransport::body_of(request),
        json!({ "challengeId": CHALLENGE_ID, "response": { "id": "Y3JlZA", "type": "public-key" }, "name": "Phone" })
    );
}

#[test]
fn a_passkey_response_that_is_not_json_is_refused_before_sending() {
    let h = harness();
    let refused = run(h
        .client
        .passkeys()
        .sign_in(CHALLENGE_ID.into(), "not json".into()))
    .unwrap_err();
    assert_eq!(refused.code(), ErrorCode::ValidationFailed);
    assert!(h.transport.sent().is_empty());
}

fn base16(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
