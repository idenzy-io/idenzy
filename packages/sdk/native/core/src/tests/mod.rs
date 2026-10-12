//! Scenarios through the public client, against the fakes in `testing`.
//!
//! The refresh tests in `refresh` are the ones ADR-0007 makes a requirement rather than an
//! optimisation. Several assert that an attack-shaped outcome does not happen (a second
//! presentation of one refresh token), not only that the happy path works (PROJECT.md 7.4).

mod api;
mod flows;
mod refresh;
mod session;

use std::sync::Arc;

use crate::flows::AuthResult;
use crate::mfa::MfaChallenge;
use crate::session::Session;
use crate::testing::{Harness, NOW, Reply, authenticated, run};

/// Signs in with a password, leaving `rt_first_000000000000` stored.
fn signed_in(harness: &Harness) -> Session {
    harness.transport.on(
        "POST v1/auth/sign-in/password",
        Reply::Json(200, authenticated("rt_first_000000000000", NOW)),
    );
    let result = run(harness
        .client
        .password()
        .sign_in("ada@example.com".into(), "pw".into()));
    session_of(result.unwrap())
}

fn session_of(result: AuthResult) -> Session {
    match result {
        AuthResult::Authenticated { session } => session,
        AuthResult::MfaRequired { challenge } => panic!("expected a session, got {challenge:?}"),
    }
}

fn challenge_of(result: AuthResult) -> Arc<MfaChallenge> {
    match result {
        AuthResult::MfaRequired { challenge } => challenge,
        AuthResult::Authenticated { session } => panic!("expected a challenge, got {session:?}"),
    }
}
