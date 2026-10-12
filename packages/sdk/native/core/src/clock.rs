use std::time::SystemTime;

/// The wall clock, injected so the tests can move it. Never exported: a platform has one clock.
pub(crate) trait Clock: Send + Sync {
    fn now(&self) -> SystemTime;
}

pub(crate) struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }
}
