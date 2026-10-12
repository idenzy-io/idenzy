//! Where credentials outlive the process, implemented by the platform SDK.
//!
//! The Keychain on Apple platforms with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, and a
//! Keystore-wrapped key on Android (PROJECT.md 4.4). This is the seam ADR-0008 leaves for exactly
//! this case: on a device the storage is protected by the platform rather than by a same-origin
//! rule, so persisting the refresh token is the default here and not an opt-in.

use std::sync::{Arc, Mutex};

use crate::error::IdenzyError;
use crate::locked;

#[derive(Debug, Clone, PartialEq, thiserror::Error, uniffi::Error)]
pub enum StoreFailure {
    /// The store exists and cannot be used right now, such as a Keychain before first unlock.
    #[error("{detail}")]
    Unavailable { detail: String },
}

impl From<uniffi::UnexpectedUniFFICallbackError> for StoreFailure {
    fn from(error: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::Unavailable {
            detail: format!("The store failed unexpectedly: {}", error.reason),
        }
    }
}

/// A small string store the platform protects. Keys are namespaced by the core, per project.
///
/// Synchronous on purpose: the Keychain and the Keystore are synchronous APIs, and a call that
/// cannot block on the network has no reason to be a future.
#[uniffi::export(with_foreign)]
pub trait SecureStore: Send + Sync {
    fn read(&self, key: String) -> Result<Option<String>, StoreFailure>;
    fn write(&self, key: String, value: String) -> Result<(), StoreFailure>;
    fn remove(&self, key: String) -> Result<(), StoreFailure>;
}

/// One value in the store, cached after the first read.
///
/// The cache is what lets a session survive a failed write. If the Keychain refuses a rotated
/// token, the process keeps the new one in memory and carries on, and the stale one is removed
/// from the store: presenting it on the next launch would look to the server exactly like theft
/// (ADR-0007), and an empty store signs in again instead.
pub(crate) struct StoredValue {
    store: Arc<dyn SecureStore>,
    key: String,
    cached: Mutex<Option<Option<String>>>,
}

impl StoredValue {
    pub(crate) fn new(store: Arc<dyn SecureStore>, key: String) -> Self {
        Self {
            store,
            key,
            cached: Mutex::new(None),
        }
    }

    /// The value, or a storage error that leaves it untouched for the next attempt.
    pub(crate) fn read(&self) -> Result<Option<String>, IdenzyError> {
        let mut cached = locked(&self.cached);
        if let Some(known) = cached.as_ref() {
            return Ok(known.clone());
        }
        let loaded = self.store.read(self.key.clone()).map_err(storage_error)?;
        *cached = Some(loaded.clone());
        Ok(loaded)
    }

    /// Holds the value in memory whatever happens, and answers whether it is also on disk.
    pub(crate) fn write(&self, value: String) -> bool {
        *locked(&self.cached) = Some(Some(value.clone()));
        if self.store.write(self.key.clone(), value).is_ok() {
            return true;
        }
        let _ = self.store.remove(self.key.clone());
        false
    }

    /// Forgets the value. The error is the store's, for the caller that has to report it.
    pub(crate) fn clear(&self) -> Result<(), IdenzyError> {
        *locked(&self.cached) = Some(None);
        self.store.remove(self.key.clone()).map_err(storage_error)
    }

    /// Reads and forgets in one step, for a value that is single use.
    pub(crate) fn take(&self) -> Result<Option<String>, IdenzyError> {
        let value = self.read()?;
        if value.is_some() {
            let _ = self.clear();
        }
        Ok(value)
    }
}

fn storage_error(failure: StoreFailure) -> IdenzyError {
    let StoreFailure::Unavailable { detail } = failure;
    IdenzyError::Storage { detail }
}
