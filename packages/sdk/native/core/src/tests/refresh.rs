//! Rotation: once at a time, never twice with one token, and never after an answer was lost.

use futures::FutureExt;
use serde_json::json;

use super::signed_in;
use crate::error::{IdenzyError, TransportReason};
use crate::session::SessionStatus;
use crate::testing::{FakeTransport, NOW, Reply, error, harness, refreshed, run, yield_now};
use crate::transport::TransportFailure;

const REFRESH: &str = "POST v1/auth/refresh";
const FIRST: &str = "rt_first_000000000000";
const SECOND: &str = "rt_second_00000000000";

fn presented(request: &crate::transport::HttpRequest) -> String {
    FakeTransport::body_of(request)["refreshToken"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn interrupted() -> Reply {
    Reply::Fail(TransportFailure::Interrupted {
        detail: "timed out".into(),
    })
}

fn not_sent() -> Reply {
    Reply::Fail(TransportFailure::NotSent {
        detail: "offline".into(),
    })
}

#[test]
fn a_fresh_token_is_returned_without_a_request() {
    let h = harness();
    let session = signed_in(&h);
    h.clock.advance(269);
    assert_eq!(
        run(h.client.get_token()).unwrap(),
        Some(session.access_token)
    );
    assert!(h.transport.sent_to(REFRESH).is_empty());
}

#[test]
fn a_token_near_expiry_is_rotated_and_the_successor_stored() {
    let h = harness();
    signed_in(&h);
    h.clock.advance(270);
    h.transport.on(
        REFRESH,
        Reply::Json(200, refreshed(SECOND, NOW + 270, false)),
    );

    let token = run(h.client.get_token()).unwrap().unwrap();

    let sent = h.transport.sent_to(REFRESH);
    assert_eq!(sent.len(), 1);
    assert_eq!(
        FakeTransport::body_of(&sent[0]),
        json!({ "refreshToken": FIRST, "includeUser": false })
    );
    assert_eq!(h.client.session().unwrap().access_token, token);
    assert_eq!(h.store.get("refresh").as_deref(), Some(SECOND));
    assert_eq!(
        h.store.get("rotation"),
        None,
        "the marker outlived an observed answer"
    );
}

#[test]
fn concurrent_callers_share_one_rotation() {
    let h = harness();
    signed_in(&h);
    h.clock.advance(300);
    let gate = h.transport.on_later(REFRESH);

    let release = async {
        while h.transport.sent_to(REFRESH).is_empty() {
            yield_now().await;
        }
        for _ in 0..5 {
            yield_now().await;
        }
        gate.send(Reply::Json(200, refreshed(SECOND, NOW + 300, false)))
            .ok();
    };
    let (a, b, c, ()) = run(async {
        futures::join!(
            h.client.get_token(),
            h.client.get_token(),
            h.client.get_token(),
            release
        )
    });

    assert_eq!(
        h.transport.sent_to(REFRESH).len(),
        1,
        "one token was presented twice"
    );
    let (a, b, c) = (
        a.unwrap().unwrap(),
        b.unwrap().unwrap(),
        c.unwrap().unwrap(),
    );
    assert_eq!(a, b);
    assert_eq!(b, c);
}

#[test]
fn concurrent_callers_share_a_failure_rather_than_sending_their_own() {
    let h = harness();
    signed_in(&h);
    h.clock.advance(300);
    let gate = h.transport.on_later(REFRESH);

    let release = async {
        while h.transport.sent_to(REFRESH).is_empty() {
            yield_now().await;
        }
        for _ in 0..5 {
            yield_now().await;
        }
        gate.send(interrupted()).ok();
    };
    let (a, b, ()) =
        run(async { futures::join!(h.client.get_token(), h.client.get_token(), release) });

    assert_eq!(h.transport.sent_to(REFRESH).len(), 1);
    for outcome in [a, b] {
        assert!(matches!(
            outcome,
            Err(IdenzyError::Transport {
                reason: TransportReason::Interrupted,
                ..
            })
        ));
    }
}

#[test]
fn a_refused_rotation_signs_out_and_answers_none() {
    let h = harness();
    signed_in(&h);
    h.clock.advance(300);
    h.transport
        .on(REFRESH, Reply::Json(401, error("refresh_token_reused")));

    assert_eq!(run(h.client.get_token()).unwrap(), None);
    assert_eq!(h.client.state().status, SessionStatus::SignedOut);
    assert_eq!(h.store.get("refresh"), None);

    // Signed out is now known, so the next caller does not ask the server again.
    assert_eq!(run(h.client.get_token()).unwrap(), None);
    assert_eq!(h.transport.sent_to(REFRESH).len(), 1);
}

#[test]
fn an_answer_lost_in_transit_ends_the_session_rather_than_presenting_the_token_again() {
    let h = harness();
    signed_in(&h);
    h.clock.advance(300);
    h.transport.on(REFRESH, interrupted());

    let error = run(h.client.get_token()).unwrap_err();

    assert!(matches!(
        error,
        IdenzyError::Transport {
            reason: TransportReason::Interrupted,
            ..
        }
    ));
    assert_eq!(h.client.state().status, SessionStatus::SignedOut);
    assert_eq!(
        h.store.get("refresh"),
        None,
        "a possibly spent token stayed presentable"
    );
    assert_eq!(run(h.client.restore()).unwrap(), None);
    assert_eq!(h.transport.sent_to(REFRESH).len(), 1);
}

#[test]
fn a_rotation_that_never_left_the_device_keeps_the_token_for_the_next_attempt() {
    let h = harness();
    signed_in(&h);
    h.clock.advance(300);
    h.transport.on(REFRESH, not_sent());
    h.transport.on(
        REFRESH,
        Reply::Json(200, refreshed(SECOND, NOW + 300, false)),
    );

    let error = run(h.client.get_token()).unwrap_err();
    assert!(matches!(
        error,
        IdenzyError::Transport {
            reason: TransportReason::NotSent,
            ..
        }
    ));
    assert_eq!(h.client.state().status, SessionStatus::SignedIn);
    assert_eq!(h.store.get("refresh").as_deref(), Some(FIRST));
    assert_eq!(h.store.get("rotation"), None);

    assert!(run(h.client.get_token()).unwrap().is_some());
    let sent = h.transport.sent_to(REFRESH);
    assert_eq!(
        sent.iter().map(presented).collect::<Vec<_>>(),
        [FIRST, FIRST]
    );
}

#[test]
fn a_rotation_abandoned_by_its_caller_is_never_followed_by_another() {
    let h = harness();
    signed_in(&h);
    h.clock.advance(300);
    let _gate = h.transport.on_later(REFRESH);

    // Polled until the request is out, then dropped: what a cancelled coroutine does to it.
    assert!(h.client.get_token().now_or_never().is_none());
    assert_eq!(h.transport.sent_to(REFRESH).len(), 1);

    let error = run(h.client.get_token()).unwrap_err();
    assert!(matches!(
        error,
        IdenzyError::Transport {
            reason: TransportReason::Interrupted,
            ..
        }
    ));
    assert_eq!(
        h.transport.sent_to(REFRESH).len(),
        1,
        "the abandoned token was presented again"
    );
    assert_eq!(h.store.get("refresh"), None);
}

#[test]
fn an_abandoned_rotation_is_remembered_even_when_the_store_refuses_the_marker() {
    let h = harness();
    signed_in(&h);
    h.store
        .refuse_writes
        .store(true, std::sync::atomic::Ordering::SeqCst);
    h.clock.advance(300);
    let _gate = h.transport.on_later(REFRESH);

    assert!(h.client.get_token().now_or_never().is_none());
    assert!(run(h.client.get_token()).is_err());
    assert_eq!(
        h.transport.sent_to(REFRESH).len(),
        1,
        "the abandoned token was presented again"
    );
}

#[test]
fn a_marker_left_by_a_process_that_died_mid_rotation_stops_the_token_being_presented() {
    let h = harness();
    h.store.put("refresh", FIRST);
    h.store.put("rotation", "in-flight");

    let error = run(h.client.restore()).unwrap_err();

    assert!(matches!(
        error,
        IdenzyError::Transport {
            reason: TransportReason::Interrupted,
            ..
        }
    ));
    assert!(h.transport.sent().is_empty());
    assert_eq!(h.store.get("refresh"), None);
    assert_eq!(h.store.get("rotation"), None);
}

#[test]
fn a_successor_the_store_refuses_is_kept_in_memory_and_the_spent_token_removed() {
    let h = harness();
    signed_in(&h);
    h.store
        .refuse_writes
        .store(true, std::sync::atomic::Ordering::SeqCst);
    h.clock.advance(300);
    h.transport.on(
        REFRESH,
        Reply::Json(200, refreshed(SECOND, NOW + 300, false)),
    );
    h.transport.on(
        REFRESH,
        Reply::Json(200, refreshed("rt_third_000000000000", NOW + 600, false)),
    );

    assert!(run(h.client.get_token()).unwrap().is_some());
    assert_eq!(
        h.store.get("refresh"),
        None,
        "the spent token would be presented on next launch"
    );

    h.clock.advance(300);
    assert!(run(h.client.get_token()).unwrap().is_some());
    let sent = h.transport.sent_to(REFRESH);
    assert_eq!(presented(&sent[1]), SECOND);
}

#[test]
fn a_rotation_finishing_after_a_new_sign_in_is_discarded() {
    let h = harness();
    signed_in(&h);
    h.clock.advance(300);
    let gate = h.transport.on_later(REFRESH);
    h.transport.on(
        "POST v1/auth/sign-in/password",
        Reply::Json(
            200,
            crate::testing::authenticated("rt_newer_000000000000", NOW + 300),
        ),
    );

    let sign_in_then_release = async {
        while h.transport.sent_to(REFRESH).is_empty() {
            yield_now().await;
        }
        let result = h
            .client
            .password()
            .sign_in("ada@example.com".into(), "pw".into())
            .await;
        gate.send(Reply::Json(200, refreshed(SECOND, NOW + 300, false)))
            .ok();
        result
    };
    let (_, signed) = run(async { futures::join!(h.client.get_token(), sign_in_then_release) });

    assert!(signed.is_ok());
    assert_eq!(
        h.store.get("refresh").as_deref(),
        Some("rt_newer_000000000000")
    );
    assert_eq!(h.client.state().status, SessionStatus::SignedIn);
}

#[test]
fn a_device_clock_running_ahead_does_not_rotate_on_every_call() {
    let h = harness();
    h.clock.advance(3_600);
    signed_in(&h);

    assert!(run(h.client.get_token()).unwrap().is_some());
    assert!(h.transport.sent_to(REFRESH).is_empty());

    h.clock.advance(270);
    h.transport.on(
        REFRESH,
        Reply::Json(200, refreshed(SECOND, NOW + 270, false)),
    );
    assert!(run(h.client.get_token()).unwrap().is_some());
    assert_eq!(h.transport.sent_to(REFRESH).len(), 1);
}

#[test]
fn restore_without_a_stored_token_answers_none_without_a_request() {
    let h = harness();
    assert_eq!(run(h.client.restore()).unwrap(), None);
    assert!(h.transport.sent().is_empty());
}

#[test]
fn restore_rotates_the_stored_token_and_asks_for_the_profile_in_the_same_trip() {
    let h = harness();
    h.store.put("refresh", FIRST);
    h.transport
        .on(REFRESH, Reply::Json(200, refreshed(SECOND, NOW, true)));

    let session = run(h.client.restore()).unwrap().unwrap();

    assert_eq!(session.user.email.as_deref(), Some("ada@example.com"));
    let sent = h.transport.sent_to(REFRESH);
    assert_eq!(FakeTransport::body_of(&sent[0])["includeUser"], json!(true));
    assert_eq!(h.store.get("refresh").as_deref(), Some(SECOND));
}

#[test]
fn restore_leaves_the_token_alone_when_the_store_cannot_be_read() {
    let h = harness();
    h.store.put("refresh", FIRST);
    h.store
        .refuse_reads
        .store(true, std::sync::atomic::Ordering::SeqCst);

    assert!(matches!(
        run(h.client.restore()),
        Err(IdenzyError::Storage { .. })
    ));

    h.store
        .refuse_reads
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(h.store.get("refresh").as_deref(), Some(FIRST));
    assert!(h.transport.sent().is_empty());
}

#[test]
fn sign_out_waits_for_a_rotation_in_flight_and_presents_its_successor() {
    let h = harness();
    signed_in(&h);
    h.clock.advance(300);
    let gate = h.transport.on_later(REFRESH);
    h.transport
        .on("POST v1/auth/sign-out", Reply::Raw(204, String::new()));

    let release = async {
        while h.transport.sent_to(REFRESH).is_empty() {
            yield_now().await;
        }
        for _ in 0..5 {
            yield_now().await;
        }
        gate.send(Reply::Json(200, refreshed(SECOND, NOW + 300, false)))
            .ok();
    };
    let (_, signed_out, ()) = run(async {
        futures::join!(
            h.client.get_token(),
            h.client.sign_out(crate::session::SignOutScope::Current),
            release
        )
    });

    signed_out.unwrap();
    let sign_out = &h.transport.sent_to("POST v1/auth/sign-out")[0];
    assert_eq!(
        presented(sign_out),
        SECOND,
        "sign-out presented a token a rotation had spent"
    );
}
