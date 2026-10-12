//! A workspace-local `uniffi-bindgen`, so the generator and the scaffolding it reads can never be
//! two different versions of UniFFI. A globally installed one can, and the mismatch surfaces as a
//! checksum failure on the first call into the library rather than at build time.

fn main() {
    uniffi::uniffi_bindgen_main()
}
