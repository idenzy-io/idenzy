//! When a held access token is due for renewal, measured without trusting the device clock.
//!
//! The browser client compares `accessTokenExpiresAt` with the local clock. A phone's clock is
//! wrong often enough for that to matter: ten minutes fast and every token looks expired on
//! arrival, so each call rotates; ten minutes slow and expired tokens are presented until the
//! customer's API refuses them. The token's own `exp - iat` is its lifetime as the server
//! measured it, so renewal counts that lifetime from the moment the token arrived here instead.
//! Decoding the claims for timing is all this does; nothing here verifies or trusts them.

use std::time::{Duration, SystemTime};

use serde::Deserialize;

use crate::encoding::base64url_decode;

/// How long before the end of its lifetime a token is renewed. Covers the flight time of the
/// request it is about to be attached to, against a five-minute default lifetime.
const RENEW_MARGIN: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub(crate) struct Renewal {
    received_at: SystemTime,
    renew_at: SystemTime,
}

impl Renewal {
    pub fn new(access_token: &str, stated_expiry: SystemTime, received_at: SystemTime) -> Self {
        let deadline = lifetime(access_token)
            .and_then(|lifetime| received_at.checked_add(lifetime))
            .unwrap_or(stated_expiry);
        let renew_at = deadline.checked_sub(RENEW_MARGIN).unwrap_or(deadline);
        Self {
            received_at,
            renew_at,
        }
    }

    /// Due, or the clock went backwards since the token arrived, in which case nothing measured
    /// against it can be believed and renewing is the answer that cannot be wrong.
    pub fn is_due(&self, now: SystemTime) -> bool {
        now >= self.renew_at || now < self.received_at
    }
}

#[derive(Deserialize)]
struct Timing {
    iat: Option<f64>,
    exp: Option<f64>,
}

fn lifetime(access_token: &str) -> Option<Duration> {
    let payload = access_token.split('.').nth(1)?;
    let timing: Timing = serde_json::from_slice(&base64url_decode(payload)?).ok()?;
    let seconds = timing.exp? - timing.iat?;
    (seconds.is_finite() && seconds > 0.0).then(|| Duration::from_secs_f64(seconds))
}

#[cfg(test)]
mod tests {
    use std::time::UNIX_EPOCH;

    use super::*;
    use crate::testing::jwt;

    fn at(seconds: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(seconds)
    }

    #[test]
    fn counts_the_lifetime_from_arrival_not_from_the_stated_expiry() {
        // The device clock is an hour ahead of the server's: the stated expiry is already in the
        // past by the device's reckoning, and the token was issued a moment ago.
        let token = jwt(1_000, 1_300);
        let renewal = Renewal::new(&token, at(1_300), at(4_600));
        assert!(!renewal.is_due(at(4_600)));
        assert!(!renewal.is_due(at(4_869)));
        assert!(renewal.is_due(at(4_870)));
    }

    #[test]
    fn falls_back_to_the_stated_expiry_without_readable_claims() {
        let renewal = Renewal::new("opaque", at(1_300), at(1_000));
        assert!(!renewal.is_due(at(1_269)));
        assert!(renewal.is_due(at(1_270)));
    }

    #[test]
    fn treats_a_clock_that_went_backwards_as_due() {
        let renewal = Renewal::new(&jwt(1_000, 1_300), at(1_300), at(1_000));
        assert!(renewal.is_due(at(999)));
    }
}
