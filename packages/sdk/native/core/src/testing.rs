//! Fakes for the two ports and the clock, and the protocol's responses as fixtures.
//!
//! The fixtures are written to the zod schemas in `@idenzy/protocol` they name, field for field,
//! so a test that parses one is a test that this crate reads what the server sends.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::channel::oneshot;
use serde_json::{Value, json};

use crate::client::IdenzyClient;
use crate::clock::Clock;
use crate::config::ClientConfig;
use crate::encoding::base64url_encode;
use crate::locked;
use crate::session::{SessionListener, SessionState};
use crate::store::{SecureStore, StoreFailure};
use crate::transport::{HttpRequest, HttpResponse, HttpTransport, TransportFailure};

pub const API: &str = "https://auth.example.test/";
pub const KEY: &str = "pk_test_0123456789";
pub const USER_ID: &str = "usr_00000000000000000001";
pub const SESSION_ID: &str = "ses_00000000000000000001";
pub const CHALLENGE_ID: &str = "chl_00000000000000000001";
/// When every test begins, in server and device time alike unless a test says otherwise.
pub const NOW: u64 = 1_791_788_400;

pub fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

pub fn iso(seconds: u64) -> String {
    let days = seconds / 86_400;
    let rest = seconds % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        rest / 3600,
        rest / 60 % 60,
        rest % 60
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// An ES256-shaped token whose claims are readable and whose signature is not a signature.
pub fn jwt(iat: u64, exp: u64) -> String {
    let header = base64url_encode(br#"{"alg":"ES256","typ":"JWT"}"#);
    let claims = json!({ "sub": USER_ID, "sid": SESSION_ID, "iat": iat, "exp": exp });
    let payload = base64url_encode(claims.to_string().as_bytes());
    format!("{header}.{payload}.c2ln")
}

/// `publicUserSchema`.
pub fn user() -> Value {
    json!({
        "id": USER_ID,
        "email": "ada@example.com",
        "emailVerified": true,
        "phone": null,
        "phoneVerified": false,
        "displayName": "Ada",
        "avatarUrl": null,
        "metadataPublic": { "plan": "pro" },
        "createdAt": iso(NOW - 86_400),
        "lastSignInAt": null,
    })
}

/// `authOutcomeSchema`, the authenticated half: a five-minute token issued at `issued`.
pub fn authenticated(refresh_token: &str, issued: u64) -> Value {
    json!({
        "status": "authenticated",
        "user": user(),
        "sessionId": SESSION_ID,
        "accessToken": jwt(issued, issued + 300),
        "accessTokenExpiresAt": iso(issued + 300),
        "refreshToken": refresh_token,
    })
}

/// `authOutcomeSchema`, the challenge half.
pub fn mfa_required(factors: &[&str]) -> Value {
    json!({
        "status": "mfa_required",
        "challengeId": CHALLENGE_ID,
        "purpose": "sign_in",
        "factors": factors,
        "expiresAt": iso(NOW + 600),
    })
}

/// `sessionRefreshedSchema`.
pub fn refreshed(refresh_token: &str, issued: u64, with_user: bool) -> Value {
    let mut body = json!({
        "sessionId": SESSION_ID,
        "accessToken": jwt(issued, issued + 300),
        "accessTokenExpiresAt": iso(issued + 300),
        "refreshToken": refresh_token,
    });
    if with_user {
        body["user"] = user();
    }
    body
}

/// `errorBodySchema`.
pub fn error(code: &str) -> Value {
    json!({ "error": { "code": code, "message": "Refused.", "requestId": "req_1" } })
}

pub enum Reply {
    Json(u16, Value),
    Raw(u16, String),
    Fail(TransportFailure),
    /// Answers when the test sends one, so concurrent callers can be made to overlap.
    Wait(oneshot::Receiver<Reply>),
}

/// Answers each route from a queue, in order, and records every request it was sent.
#[derive(Default)]
pub struct FakeTransport {
    replies: Mutex<HashMap<String, VecDeque<Reply>>>,
    sent: Mutex<Vec<HttpRequest>>,
}

impl FakeTransport {
    /// Queues a reply for `"POST v1/auth/refresh"` and the like.
    pub fn on(&self, route: &str, reply: Reply) {
        locked(&self.replies)
            .entry(route.to_owned())
            .or_default()
            .push_back(reply);
    }

    /// A reply the test releases later, through the returned sender.
    pub fn on_later(&self, route: &str) -> oneshot::Sender<Reply> {
        let (sender, receiver) = oneshot::channel();
        self.on(route, Reply::Wait(receiver));
        sender
    }

    pub fn sent(&self) -> Vec<HttpRequest> {
        locked(&self.sent).clone()
    }

    pub fn sent_to(&self, route: &str) -> Vec<HttpRequest> {
        self.sent()
            .into_iter()
            .filter(|request| route_of(request) == route)
            .collect()
    }

    pub fn body_of(request: &HttpRequest) -> Value {
        serde_json::from_str(request.body.as_deref().unwrap_or("null")).unwrap()
    }
}

fn route_of(request: &HttpRequest) -> String {
    let path = request.url.strip_prefix(API).unwrap_or(&request.url);
    format!("{} {}", request.method.as_str(), path)
}

#[async_trait::async_trait]
impl HttpTransport for FakeTransport {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportFailure> {
        let route = route_of(&request);
        locked(&self.sent).push(request);
        let mut reply = locked(&self.replies)
            .get_mut(&route)
            .and_then(VecDeque::pop_front)
            .unwrap_or_else(|| panic!("no reply queued for {route}"));
        loop {
            return match reply {
                Reply::Json(status, body) => Ok(HttpResponse {
                    status,
                    body: body.to_string(),
                }),
                Reply::Raw(status, body) => Ok(HttpResponse { status, body }),
                Reply::Fail(failure) => Err(failure),
                Reply::Wait(receiver) => {
                    reply = receiver.await.expect("the test dropped a pending reply");
                    continue;
                }
            };
        }
    }
}

/// A store that can be told to refuse.
#[derive(Default)]
pub struct FakeStore {
    values: Mutex<HashMap<String, String>>,
    pub refuse_reads: AtomicBool,
    pub refuse_writes: AtomicBool,
}

impl FakeStore {
    pub fn get(&self, name: &str) -> Option<String> {
        locked(&self.values)
            .get(&format!("idenzy.{KEY}.{name}"))
            .cloned()
    }

    pub fn put(&self, name: &str, value: &str) {
        locked(&self.values).insert(format!("idenzy.{KEY}.{name}"), value.to_owned());
    }
}

impl SecureStore for FakeStore {
    fn read(&self, key: String) -> Result<Option<String>, StoreFailure> {
        if self.refuse_reads.load(Ordering::SeqCst) {
            return Err(StoreFailure::Unavailable {
                detail: "locked".into(),
            });
        }
        Ok(locked(&self.values).get(&key).cloned())
    }

    fn write(&self, key: String, value: String) -> Result<(), StoreFailure> {
        if self.refuse_writes.load(Ordering::SeqCst) {
            return Err(StoreFailure::Unavailable {
                detail: "locked".into(),
            });
        }
        locked(&self.values).insert(key, value);
        Ok(())
    }

    fn remove(&self, key: String) -> Result<(), StoreFailure> {
        locked(&self.values).remove(&key);
        Ok(())
    }
}

pub struct FakeClock(Mutex<SystemTime>);

impl FakeClock {
    pub fn at(seconds: u64) -> Self {
        Self(Mutex::new(at(seconds)))
    }

    pub fn advance(&self, seconds: u64) {
        *locked(&self.0) += Duration::from_secs(seconds);
    }
}

impl Clock for FakeClock {
    fn now(&self) -> SystemTime {
        *locked(&self.0)
    }
}

/// Every state a listener was told, in order.
#[derive(Default)]
pub struct Recorder(Mutex<Vec<SessionState>>);

impl Recorder {
    pub fn states(&self) -> Vec<SessionState> {
        locked(&self.0).clone()
    }
}

impl SessionListener for Recorder {
    fn on_change(&self, state: SessionState) {
        locked(&self.0).push(state);
    }
}

pub struct Harness {
    pub client: Arc<IdenzyClient>,
    pub transport: Arc<FakeTransport>,
    pub store: Arc<FakeStore>,
    pub clock: Arc<FakeClock>,
}

pub fn harness() -> Harness {
    harness_with(ClientConfig {
        publishable_key: KEY.into(),
        api_url: API.into(),
        device_name: Some("Ada's Pixel".into()),
    })
}

pub fn harness_with(config: ClientConfig) -> Harness {
    let transport = Arc::new(FakeTransport::default());
    let store = Arc::new(FakeStore::default());
    let clock = Arc::new(FakeClock::at(NOW));
    let client = IdenzyClient::build(config, transport.clone(), store.clone(), clock.clone())
        .map(Arc::new)
        .unwrap();
    Harness {
        client,
        transport,
        store,
        clock,
    }
}

/// Runs a future to completion on this thread. Every future here is driven by its caller, as
/// UniFFI's are by the foreign executor, so no runtime is involved.
pub fn run<F: Future>(future: F) -> F::Output {
    futures::executor::block_on(future)
}

/// Gives every other future in a `join!` one more poll.
pub async fn yield_now() {
    struct Yield(bool);
    impl Future for Yield {
        type Output = ();
        fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<()> {
            if self.0 {
                return Poll::Ready(());
            }
            self.0 = true;
            context.waker().wake_by_ref();
            Poll::Pending
        }
    }
    Yield(false).await
}
