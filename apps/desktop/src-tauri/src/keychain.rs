use std::fs;
use std::io;
use std::path::Path;

// The one secret Rust holds: a 32-byte data key that device tokens are encrypted under, in the OS
// keychain via the `keyring` crate (docs/future/tauri/architecture.md § Keys and custody). The helper
// receives it over the stdin handshake and never writes it anywhere.
//
// One key, not one per token. Per-token keychain items would mean a prompt per node and ACL churn on
// every rebuild, and a stronghold database is a runtime for a problem one entry solves.
//
// The file fallback is deliberate, and on macOS it is the common path rather than the exception:
// keychain item ACLs bind to the code signature, so while acorn ships ad-hoc signed, every rebuild
// re-prompts or loses access. Falling back to a 0600 file is the same fail-quiet stance
// deviceTokenStore.ts already takes, and the same blast radius as the node's own session.key.

const SERVICE: &str = "acorn";
const ACCOUNT: &str = "data-key";
const FALLBACK: &str = "data.key";

fn generate() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("the OS refused to provide random bytes");
    hex::encode(bytes)
}

fn is_key(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn from_file(path: &Path) -> Option<String> {
    let value = fs::read_to_string(path).ok()?;
    let value = value.trim().to_string();
    is_key(&value).then_some(value)
}

fn to_file(path: &Path, key: &str) -> io::Result<()> {
    fs::write(path, key)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// The data key for this installation, creating it on first run. `user_data_dir` is where the fallback
/// file lives, beside the encrypted tokens it protects.
///
/// `use_keychain` is false for a dev build, and that is not a shortcut. An unsigned binary's keychain
/// ACL does not survive a rebuild, so every `cargo build` would put a modal password prompt in front of
/// the app — and the answer to it grants nothing durable, because the next rebuild asks again. The
/// 0600 file beside the tokens is what the caveat in docs/future/tauri/architecture.md § Keys and
/// custody says will be the common path on macOS until Developer ID signing exists; a dev build simply
/// takes it directly.
pub fn data_key(user_data_dir: &Path, use_keychain: bool) -> String {
    let entry = use_keychain.then(|| keyring::Entry::new(SERVICE, ACCOUNT).ok()).flatten();
    if let Some(existing) = entry.as_ref().and_then(|e| e.get_password().ok()) {
        if is_key(&existing) {
            return existing;
        }
    }

    let fallback = user_data_dir.join(FALLBACK);
    // The keychain is asked first on every launch, but an existing fallback file wins over minting a
    // new key: a machine that fell back once has tokens encrypted under that key, and quietly
    // replacing it would forget every paired node without saying so.
    if let Some(existing) = from_file(&fallback) {
        return existing;
    }

    let key = generate();
    if let Some(entry) = entry.as_ref() {
        if entry.set_password(&key).is_ok() {
            return key;
        }
    }
    if let Err(error) = to_file(&fallback, &key) {
        eprintln!("[keychain] could not store the data key: {error}");
    }
    key
}

/// Electron's `safeStorage` key, for the one-time adoption of a custody root the Electron build left
/// behind (docs/future/tauri/architecture.md § Keys and custody).
///
/// safeStorage is Chromium's os_crypt: on macOS the password lives in a keychain item named
/// "<app> Safe Storage" and the AES key is derived from it. The derivation and the decryption are the
/// helper's, in TypeScript beside the token store that has to re-encrypt the results; all Rust owns is
/// the one thing only it can reach.
///
/// Returns None whenever there is nothing to adopt or nothing readable, and that is a supported
/// outcome rather than an error: the local node mints a fresh device row, remote nodes need
/// re-pairing, and the fleet UI says so.
pub fn legacy_safe_storage_key(app_name: &str) -> Option<String> {
    keyring::Entry::new(&format!("{app_name} Safe Storage"), app_name)
        .ok()?
        .get_password()
        .inspect_err(|error| eprintln!("[keychain] no legacy safeStorage key to adopt: {error}"))
        .ok()
        .filter(|password| !password.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_sixty_four_lowercase_hex_digits() {
        let key = generate();
        assert!(is_key(&key), "{key}");
        assert!(!is_key(""));
        assert!(!is_key(&"a".repeat(63)));
        assert!(!is_key(&"A".repeat(64)));
        assert!(!is_key(&"z".repeat(64)));
    }

    #[test]
    fn the_fallback_file_round_trips_and_rejects_junk() {
        let dir = std::env::temp_dir().join(format!("acorn-key-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FALLBACK);
        let key = generate();
        to_file(&path, &key).unwrap();
        assert_eq!(from_file(&path).as_deref(), Some(key.as_str()));
        fs::write(&path, "not a key").unwrap();
        assert_eq!(from_file(&path), None);
        fs::remove_dir_all(&dir).ok();
    }
}
