//! A PKCE pair for the exchange code our redirect hands back (PROJECT.md 4.6, RFC 7636).
//!
//! PKCE here is on our own exchange code, not the provider's. On a phone that code arrives
//! through a custom scheme or an app link, and any app that registered the same scheme can see
//! it; the verifier this app kept is what makes an intercepted code worthless.

use sha2::{Digest, Sha256};

use crate::encoding::base64url_encode;
use crate::error::IdenzyError;

/// 32 bytes, which is 43 base64url characters: the length the server's challenge regex pins.
const VERIFIER_BYTES: usize = 32;

pub(crate) struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    pub fn generate() -> Result<Self, IdenzyError> {
        let mut bytes = [0u8; VERIFIER_BYTES];
        getrandom::fill(&mut bytes).map_err(|error| {
            IdenzyError::configuration(format!("The platform has no usable random source: {error}"))
        })?;
        Ok(Self::from_verifier(base64url_encode(&bytes)))
    }

    fn from_verifier(verifier: String) -> Self {
        let challenge = base64url_encode(&Sha256::digest(verifier.as_bytes()));
        Self {
            verifier,
            challenge,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_s256_challenge_of_rfc_7636_appendix_b() {
        let pair = Pkce::from_verifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into());
        assert_eq!(
            pair.challenge,
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn generates_a_fresh_verifier_of_the_pinned_length() {
        let first = Pkce::generate().unwrap();
        let second = Pkce::generate().unwrap();
        assert_eq!(first.verifier.len(), 43);
        assert_eq!(first.challenge.len(), 43);
        assert_ne!(first.verifier, second.verifier);
    }
}
