//! Holds the session and is the only thing that renews it (`SessionManager` in `@idenzy/js`).
//!
//! Three rules carry the weight, and each has a test that fails without it.
//!
//! - **One rotation at a time, and its answer is shared.** The server has no grace window, so a
//!   refresh token presented twice revokes the session (ADR-0007). Callers that arrive while a
//!   rotation is in flight wait for it and take its outcome, failures included, instead of
//!   sending one of their own.
//! - **A rotation whose answer was not observed is never followed by another.** If the request
//!   may have reached the server and the answer was lost, the token is in an unknown state, and
//!   presenting it again converts that unknown into a revoked family. The session ends locally
//!   and the user signs in again. Only a request the platform can prove never left the device is
//!   safe to send again. A marker in the store carries this across a process that died with a
//!   rotation in flight, which on a phone is an app swiped away at the wrong moment.
//! - **Renewal is lazy, never timed.** A background timer keeps a session alive in an app nobody
//!   is using, which turns an idle timeout into no timeout at all.

use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde_json::{Map, Value, json};

use super::renewal::Renewal;
use super::{Session, SessionListener, SessionState, SessionStatus, SignOutScope};
use crate::api::{ApiClient, Call};
use crate::clock::Clock;
use crate::error::{IdenzyError, TransportReason};
use crate::locked;
use crate::protocol::{SessionCreated, SessionRefreshed, User};
use crate::store::StoredValue;

pub(crate) struct SessionManager {
    api: Arc<ApiClient>,
    refresh_token: StoredValue,
    /// Present in the store from just before a rotation is sent until its answer is observed.
    rotation_marker: StoredValue,
    clock: Arc<dyn Clock>,
    state: Mutex<State>,
    /// Held for the length of a rotation, and by sign-out so it never presents a token that a
    /// rotation in flight is about to replace.
    rotation: async_lock::Mutex<()>,
    listeners: Mutex<BTreeMap<u64, Arc<dyn SessionListener>>>,
    next_listener: AtomicU64,
}

#[derive(Default)]
struct State {
    current: Option<Held>,
    /// Set once a rotation is refused, cleared when a session is adopted. Without it a signed-out
    /// app asks the server again on every call that wants a token. `restore` clears it.
    known_signed_out: bool,
    /// Moves whenever the session is replaced by anything other than its own rotation: a new
    /// sign-in or a sign-out. A rotation that finishes into a different epoch is discarded.
    epoch: u64,
    /// Completed rotations, so a caller that queued behind one takes its answer.
    rotations: u64,
    /// The last rotation's outcome, with the epoch it started in.
    last_rotation: Option<(u64, Result<Session, IdenzyError>)>,
}

#[derive(Clone)]
struct Held {
    session: Session,
    renewal: Renewal,
}

impl State {
    fn snapshot(&self) -> SessionState {
        match &self.current {
            None => SessionState {
                status: SessionStatus::SignedOut,
                user: None,
                session_id: None,
            },
            Some(held) => SessionState {
                status: SessionStatus::SignedIn,
                user: Some(held.session.user.clone()),
                session_id: Some(held.session.id.clone()),
            },
        }
    }

    /// The new state, when a subscriber has something to hear: status or session changed.
    fn replace(&mut self, next: Option<Held>) -> Option<SessionState> {
        let before = self.snapshot();
        self.current = next;
        let after = self.snapshot();
        let changed = before.status != after.status || before.session_id != after.session_id;
        changed.then_some(after)
    }
}

impl SessionManager {
    pub fn new(
        api: Arc<ApiClient>,
        refresh_token: StoredValue,
        rotation_marker: StoredValue,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            api,
            refresh_token,
            rotation_marker,
            clock,
            state: Mutex::new(State::default()),
            rotation: async_lock::Mutex::new(()),
            listeners: Mutex::new(BTreeMap::new()),
            next_listener: AtomicU64::new(0),
        }
    }

    pub fn session(&self) -> Option<Session> {
        locked(&self.state)
            .current
            .as_ref()
            .map(|held| held.session.clone())
    }

    pub fn state(&self) -> SessionState {
        locked(&self.state).snapshot()
    }

    /// Takes a freshly issued session. The refresh token is stored before the session is
    /// published, so a listener that reacts by asking for a token finds one that will renew.
    pub fn adopt(&self, created: SessionCreated) -> Session {
        let received = self.clock.now();
        let session = Session {
            id: created.session_id,
            user: created.user,
            access_token: created.access_token,
            access_token_expires_at: created.access_token_expires_at,
        };
        let renewal = Renewal::new(
            &session.access_token,
            session.access_token_expires_at,
            received,
        );
        let change = {
            let mut state = locked(&self.state);
            match created.refresh_token {
                Some(token) => {
                    self.refresh_token.write(token);
                }
                None => {
                    let _ = self.refresh_token.clear();
                }
            }
            // Whatever was in doubt belonged to the session this one replaces.
            let _ = self.rotation_marker.clear();
            state.known_signed_out = false;
            state.epoch += 1;
            state.replace(Some(Held {
                session: session.clone(),
                renewal,
            }))
        };
        self.emit(change);
        session
    }

    /// A token good for the next request, or `None` when nobody is signed in.
    ///
    /// Signing out is a state and not an error, so a refused credential ends here as `None` with
    /// the listeners told. Anything else is thrown, because it is not a state change and must not
    /// be able to look like one.
    pub async fn get_token(&self) -> Result<Option<String>, IdenzyError> {
        let has_session = {
            let state = locked(&self.state);
            match &state.current {
                Some(held) if !held.renewal.is_due(self.clock.now()) => {
                    return Ok(Some(held.session.access_token.clone()));
                }
                held => held.is_some(),
            }
        };
        if !has_session && !self.can_refresh()? {
            return Ok(None);
        }
        Ok(self
            .try_refresh()
            .await?
            .map(|session| session.access_token))
    }

    /// The token, or the refusal the API would have given, for calls on an existing account.
    pub async fn require_token(&self) -> Result<String, IdenzyError> {
        self.get_token()
            .await?
            .ok_or_else(IdenzyError::missing_credentials)
    }

    /// Picks up the session a previous launch left in the store. Call it once, at start-up.
    ///
    /// A storage error is thrown and the stored token left alone: a Keychain that cannot be read
    /// before first unlock is a reason to try later, never a reason to sign anybody out.
    pub async fn restore(&self) -> Result<Option<Session>, IdenzyError> {
        {
            let mut state = locked(&self.state);
            state.known_signed_out = false;
            if let Some(held) = &state.current {
                if !held.renewal.is_due(self.clock.now()) {
                    return Ok(Some(held.session.clone()));
                }
            }
        }
        if self.refresh_token.read()?.is_none() {
            return Ok(None);
        }
        self.try_refresh().await
    }

    /// Ends the session server-side, then locally whatever the server said.
    ///
    /// Waits out a rotation in flight first, so the token it presents is the current one rather
    /// than one a rotation is about to make spent. The local half runs even when the request
    /// fails: an app showing a signed-in user after they pressed sign out is worse than a token
    /// we have already stopped presenting.
    pub async fn sign_out(&self, scope: SignOutScope) -> Result<(), IdenzyError> {
        let _turn = self.rotation.lock().await;
        let (access_token, epoch) = {
            let state = locked(&self.state);
            let token = state
                .current
                .as_ref()
                .map(|held| held.session.access_token.clone());
            (token, state.epoch)
        };
        let in_doubt = self.rotation_marker.read().ok().flatten().is_some();
        // A token whose rotation went unobserved may already be spent, and presenting a spent
        // one reads as theft to the server. The access token alone still names the session.
        let presented = if in_doubt {
            None
        } else {
            self.refresh_token.read().ok().flatten()
        };
        let mut body = Map::new();
        body.insert("scope".into(), Value::from(scope.as_wire()));
        if let Some(token) = presented {
            body.insert("refreshToken".into(), Value::from(token));
        }
        let sent = self
            .api
            .send_void(
                Call::post("v1/auth/sign-out")
                    .body(Value::Object(body))
                    .bearer_if(access_token),
            )
            .await;
        // A sign-in that completed while this request was out is a different session, and the
        // user who started it did not ask for it to end.
        let cleared = self.clear_if(Some(epoch));
        sent.and(cleared)
    }

    /// Forgets the session here, and the stored token with it.
    pub fn clear(&self) -> Result<(), IdenzyError> {
        self.clear_if(None)
    }

    /// Clears only if the session is still the one from `epoch`, checked under the same lock
    /// that clears it, so a sign-in that lands in between is never the thing that gets cleared.
    fn clear_if(&self, epoch: Option<u64>) -> Result<(), IdenzyError> {
        let change = {
            let mut state = locked(&self.state);
            if epoch.is_some_and(|epoch| epoch != state.epoch) {
                return Ok(());
            }
            state.epoch += 1;
            state.known_signed_out = true;
            let change = state.replace(None);
            // Removed while the lock is held for the same reason: an adoption waiting on it
            // writes its own token next, and must not have it removed from under it.
            let removed = self.refresh_token.clear();
            let _ = self.rotation_marker.clear();
            (change, removed)
        };
        self.emit(change.0);
        change.1
    }

    /// Swaps the access token for a newer one on the same session, after a step-up.
    ///
    /// The refresh token is untouched: rotating the credential that mints tokens because a check
    /// only read one would be a rotation nobody asked for. No listener is told, because nothing a
    /// subscriber watches has changed.
    pub fn replace_token(
        &self,
        access_token: String,
        expires_at: SystemTime,
    ) -> Result<Session, IdenzyError> {
        let received = self.clock.now();
        let mut state = locked(&self.state);
        let held = state
            .current
            .as_mut()
            .ok_or_else(IdenzyError::missing_credentials)?;
        held.renewal = Renewal::new(&access_token, expires_at, received);
        held.session.access_token = access_token;
        held.session.access_token_expires_at = expires_at;
        Ok(held.session.clone())
    }

    /// Replaces the profile without touching the tokens, and always tells the listeners: a
    /// changed name or a newly verified address is exactly what a subscriber is watching for.
    pub fn update_user(&self, user: User) {
        let state = {
            let mut state = locked(&self.state);
            let Some(held) = state.current.as_mut() else {
                return;
            };
            held.session.user = user;
            state.snapshot()
        };
        self.emit(Some(state));
    }

    /// Called at once with the current state, so a subscriber never has to ask separately.
    pub fn subscribe(&self, listener: Arc<dyn SessionListener>) -> u64 {
        let id = self.next_listener.fetch_add(1, Ordering::Relaxed);
        locked(&self.listeners).insert(id, listener.clone());
        notify(&listener, self.state());
        id
    }

    pub fn unsubscribe(&self, id: u64) {
        locked(&self.listeners).remove(&id);
    }

    /// The rotation, or `None` when the server refused the credential and the session is over.
    async fn try_refresh(&self) -> Result<Option<Session>, IdenzyError> {
        match self.refresh().await {
            Ok(session) => Ok(Some(session)),
            Err(error) if error.is_refusal() => Ok(None),
            Err(IdenzyError::MissingCredentials { .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Rotates once, however many callers ask at the same moment.
    async fn refresh(&self) -> Result<Session, IdenzyError> {
        let (ticket, epoch) = {
            let state = locked(&self.state);
            (state.rotations, state.epoch)
        };
        let _turn = self.rotation.lock().await;
        {
            let state = locked(&self.state);
            if state.rotations != ticket {
                // The rotation this caller queued behind. Its failure is this caller's failure,
                // even though it has since ended the session; its success is this caller's only
                // while that session is still the one held.
                match &state.last_rotation {
                    Some((rotated, Err(error))) if *rotated == epoch => return Err(error.clone()),
                    Some((rotated, Ok(session))) if *rotated == epoch && state.epoch == epoch => {
                        return Ok(session.clone());
                    }
                    _ => {}
                }
            }
            if state.epoch != epoch {
                // Signed in or out while this caller waited: the answer is whatever is held now.
                return current_or_missing(&state);
            }
        }
        let outcome = self.rotate(epoch).await;
        let mut state = locked(&self.state);
        state.rotations += 1;
        state.last_rotation = Some((epoch, outcome.clone()));
        outcome
    }

    async fn rotate(&self, epoch: u64) -> Result<Session, IdenzyError> {
        // The epoch check and the token read share one lock, which is what an adoption holds
        // while it writes its token. Read apart, a sign-in landing between them would have its
        // brand-new token presented by a rotation whose answer is then discarded as stale.
        let (previous_user, presented) = {
            let state = locked(&self.state);
            if state.epoch != epoch {
                return current_or_missing(&state);
            }
            // The marker outlives the rotation that wrote it whenever the answer went unobserved:
            // a caller that abandoned the call, or a process that died before it arrived.
            if self.rotation_marker.read().ok().flatten().is_some() {
                drop(state);
                let _ = self.clear_if(Some(epoch));
                return Err(unobserved_rotation());
            }
            let user = state.current.as_ref().map(|held| held.session.user.clone());
            let presented = self
                .refresh_token
                .read()?
                .ok_or_else(IdenzyError::missing_credentials)?;
            (user, presented)
        };
        // The profile is asked for only when there is none: a rotation loads the user anyway to
        // check the account may still sign in, so this saves a round trip at start-up, and a
        // routine rotation should not re-send a profile nothing will read.
        let call = Call::post("v1/auth/refresh")
            .body(json!({ "refreshToken": presented, "includeUser": previous_user.is_none() }));

        // Written before the request and removed only once its answer is observed, so a future
        // dropped in between leaves it behind. The cache keeps it for this process even when the
        // store refuses it; only the guarantee across a relaunch is lost then.
        self.rotation_marker.write("in-flight".into());
        let answer = self.api.send::<SessionRefreshed>(call).await;

        match answer {
            Ok(refreshed) => self.accept(epoch, refreshed, previous_user),
            Err(error) => {
                self.reject(epoch, &error);
                Err(error)
            }
        }
    }

    fn accept(
        &self,
        epoch: u64,
        refreshed: SessionRefreshed,
        previous_user: Option<User>,
    ) -> Result<Session, IdenzyError> {
        let received = self.clock.now();
        let (session, change) = {
            let mut state = locked(&self.state);
            if state.epoch != epoch {
                // The session this rotated is no longer the one held. Its successor token is
                // dropped with it: writing it would overwrite whatever replaced it.
                return current_or_missing(&state);
            }
            let Some(successor) = refreshed.refresh_token else {
                // Header mode always answers with the successor. Without one, the token just
                // presented is spent and nothing replaces it, so there is no session to keep.
                drop(state);
                let _ = self.clear_if(Some(epoch));
                return Err(IdenzyError::unexpected(
                    "The refresh answered without the refresh token that replaces the one it spent.",
                    200,
                ));
            };
            // The successor is stored before the marker goes. A process that dies between the
            // two signs in again on its next launch; the other order would present a spent token.
            self.refresh_token.write(successor);
            let _ = self.rotation_marker.clear();
            let user = refreshed.user.or(previous_user).ok_or_else(|| {
                IdenzyError::unexpected(
                    "The refresh did not return the profile it was asked for.",
                    200,
                )
            })?;
            let session = Session {
                id: refreshed.session_id,
                user,
                access_token: refreshed.access_token,
                access_token_expires_at: refreshed.access_token_expires_at,
            };
            let renewal = Renewal::new(
                &session.access_token,
                session.access_token_expires_at,
                received,
            );
            let change = state.replace(Some(Held {
                session: session.clone(),
                renewal,
            }));
            (session, change)
        };
        self.emit(change);
        Ok(session)
    }

    /// Ends the session when the failure leaves nothing to renew with: the server refused the
    /// token, or the answer was lost and the token may be spent. Anything else spent nothing.
    fn reject(&self, epoch: u64, error: &IdenzyError) {
        let unobserved = matches!(
            error,
            IdenzyError::Transport {
                reason: TransportReason::Interrupted,
                ..
            }
        );
        if error.is_refusal() || unobserved {
            let _ = self.clear_if(Some(epoch));
        } else {
            let _ = self.rotation_marker.clear();
        }
    }

    /// Whether a rotation could find a token to present. Read at the call, never cached.
    fn can_refresh(&self) -> Result<bool, IdenzyError> {
        if locked(&self.state).known_signed_out {
            return Ok(false);
        }
        Ok(self.refresh_token.read()?.is_some())
    }

    fn emit(&self, change: Option<SessionState>) {
        let Some(state) = change else { return };
        let listeners: Vec<_> = locked(&self.listeners).values().cloned().collect();
        for listener in listeners {
            notify(&listener, state.clone());
        }
    }
}

fn current_or_missing(state: &State) -> Result<Session, IdenzyError> {
    match &state.current {
        Some(held) => Ok(held.session.clone()),
        None => Err(IdenzyError::missing_credentials()),
    }
}

/// One subscriber's failure must not stop the others being told.
fn notify(listener: &Arc<dyn SessionListener>, state: SessionState) {
    let _ = catch_unwind(AssertUnwindSafe(|| listener.on_change(state)));
}

fn unobserved_rotation() -> IdenzyError {
    IdenzyError::Transport {
        reason: TransportReason::Interrupted,
        detail: "An earlier refresh was sent and its answer never arrived, so the refresh token \
                  may already be spent. Presenting it again would revoke the session; sign in again."
            .into(),
        status: 0,
    }
}
