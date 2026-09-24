use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, State};

const KEY_SERVICE: &str = "acorn";
const KEY_ACCOUNT: &str = "data-key";
const ORIGIN_FILE: &str = "desktop-origin.json";
const KEY_FILE: &str = "desktop-key.txt";
const STAGE_FILE: &str = "desktop-stage.json";

#[derive(Clone)]
pub struct ResetOptions {
    desktop_root: PathBuf,
    recovery_dir: PathBuf,
    pub fixture: bool,
}

pub struct ResetState {
    desktop_root: PathBuf,
    recovery_dir: PathBuf,
    use_keychain: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginSnapshot {
    local_storage: Vec<(String, String)>,
    cache: Vec<(String, String)>,
}

#[derive(Serialize)]
struct StageFile {
    path: &'static str,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StageManifest {
    desktop_root: String,
    complete: bool,
    files: Vec<StageFile>,
}

pub fn options_from_args() -> Result<Option<ResetOptions>, String> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("--reset-stage") => {},
        Some(flag) if flag.starts_with("--reset") => return Err(format!("unknown reset mode: {flag}")),
        _ => return Ok(None),
    }
    let mut desktop_root = None;
    let mut recovery_dir = None;
    let mut fixture = false;
    while let Some(flag) = args.next() {
        if flag == "--fixture" && cfg!(debug_assertions) && !fixture {
            fixture = true;
            continue;
        }
        let value = args.next().ok_or_else(|| format!("missing value for {flag}"))?;
        match flag.as_str() {
            "--desktop-root" if desktop_root.is_none() => desktop_root = Some(PathBuf::from(value)),
            "--recovery-dir" if recovery_dir.is_none() => recovery_dir = Some(PathBuf::from(value)),
            _ => return Err(format!("unknown or duplicate reset argument: {flag}")),
        }
    }
    Ok(Some(ResetOptions {
        desktop_root: desktop_root.ok_or("--desktop-root is required")?,
        recovery_dir: recovery_dir.ok_or("--recovery-dir is required")?,
        fixture,
    }))
}

fn is_within(parent: &Path, child: &Path) -> bool {
    child == parent || child.starts_with(parent)
}

fn development_node_root() -> PathBuf {
    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../node/.acorn");
    std::env::var_os("ACORN_DATA_DIR").filter(|value| !value.is_empty()).map(PathBuf::from).unwrap_or(checkout)
}

fn expected_root(app: &tauri::AppHandle, packaged: bool) -> Result<PathBuf, String> {
    if packaged {
        return app.path().app_data_dir().map_err(|error| error.to_string());
    }
    super::development_custody_root(&development_node_root())
}

pub fn validate(app: &tauri::AppHandle, options: ResetOptions, packaged: bool) -> Result<ResetState, String> {
    if !options.desktop_root.is_absolute() || !options.recovery_dir.is_absolute() {
        return Err("reset paths must be absolute".into());
    }
    let root = options.desktop_root.canonicalize().map_err(|error| format!("desktop root: {error}"))?;
    let expected = expected_root(app, packaged)?.canonicalize().map_err(|error| format!("expected desktop root: {error}"))?;
    if root != expected {
        return Err("desktop root does not match this Acorn installation".into());
    }
    let recovery = options.recovery_dir.canonicalize().map_err(|error| format!("recovery directory: {error}"))?;
    if is_within(&root, &recovery) || is_within(&recovery, &root) {
        return Err("recovery directory overlaps desktop root".into());
    }
    if !packaged {
        let node_root = development_node_root().canonicalize().map_err(|error| format!("development Node root: {error}"))?;
        if is_within(&node_root, &recovery) || is_within(&recovery, &node_root) {
            return Err("recovery directory overlaps the development Node root".into());
        }
    }
    let node_root = if packaged { root.join("node") } else {
        development_node_root().canonicalize().map_err(|error| format!("development Node root: {error}"))?
    };
    if node_root.join("node.lock").exists() {
        return Err("the Node root has a lock; stop its writer and inspect the lock before reset".into());
    }
    if !recovery.is_dir() {
        return Err("recovery destination is not a directory".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if recovery.metadata().map_err(|error| error.to_string())?.permissions().mode() & 0o077 != 0 {
            return Err("recovery directory must be private (0700)".into());
        }
    }
    if recovery.join(STAGE_FILE).exists() {
        return Err("desktop reset stage already completed".into());
    }
    Ok(ResetState { desktop_root: root, recovery_dir: recovery, use_keychain: packaged })
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("existing recovery artifact is not a regular file".into());
        }
        #[cfg(unix)]
        if std::os::unix::fs::MetadataExt::nlink(&metadata) != 1 {
            return Err("existing recovery artifact has another hard link".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err("existing recovery artifact is not private".into());
            }
        }
        return Ok(()); // An interrupted stage keeps its first recovery copy.
    }
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    if temporary.exists() {
        let metadata = fs::symlink_metadata(&temporary).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("interrupted recovery file is not a regular file".into());
        }
        fs::remove_file(&temporary).map_err(|error| error.to_string())?;
    }
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&temporary).map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    Ok(())
}

fn hash_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEY_SERVICE, KEY_ACCOUNT).map_err(|error| error.to_string())
}

fn has_device_tokens(root: &Path) -> Result<bool, String> {
    for entry in root.read_dir().map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_name().to_string_lossy().starts_with("device-token-") {
            return Ok(true);
        }
    }
    Ok(false)
}

fn valid_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[tauri::command]
pub fn reset_export(state: State<'_, ResetState>, snapshot: OriginSnapshot) -> Result<(), String> {
    // idb-keyval stores JSON strings. Refuse an unexpected value rather than exporting a lossy cache.
    let origin = serde_json::to_vec_pretty(&snapshot).map_err(|error| error.to_string())?;
    let origin_path = state.recovery_dir.join(ORIGIN_FILE);
    write_private(&origin_path, &origin)?;
    let saved: OriginSnapshot = serde_json::from_slice(&fs::read(&origin_path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("saved origin snapshot is unreadable: {error}"))?;
    let still_saved = |current: &[(String, String)], exported: &[(String, String)]| {
        current.iter().all(|entry| exported.contains(entry))
    };
    if !still_saved(&snapshot.local_storage, &saved.local_storage) || !still_saved(&snapshot.cache, &saved.cache) {
        return Err("browser storage changed after the first recovery export; reset stopped".into());
    }
    let mut active_key = None;
    if state.use_keychain {
        let entry = keychain_entry()?;
        match entry.get_password() {
            Ok(key) => active_key = Some(key),
            Err(keyring::Error::NoEntry) => {},
            Err(error) => return Err(format!("cannot read Acorn data key: {error}")),
        }
    }
    if active_key.is_none() && state.desktop_root.join("data.key").exists() {
        active_key = Some(fs::read_to_string(state.desktop_root.join("data.key")).map_err(|error| error.to_string())?.trim().to_owned());
    }
    if let Some(key) = active_key {
        if !valid_key(&key) {
            return Err("Acorn data key has an unexpected shape".into());
        }
        let key_path = state.recovery_dir.join(KEY_FILE);
        write_private(&key_path, key.as_bytes())?;
        if fs::read(&key_path).map_err(|error| error.to_string())? != key.as_bytes() {
            return Err("the active data key differs from the first recovery export".into());
        }
    } else if has_device_tokens(&state.desktop_root)? && !state.recovery_dir.join(KEY_FILE).exists() {
        return Err("encrypted device tokens have no recoverable data key".into());
    }
    Ok(())
}

#[tauri::command]
pub fn reset_complete(app: tauri::AppHandle, state: State<'_, ResetState>) -> Result<(), String> {
    let origin = state.recovery_dir.join(ORIGIN_FILE);
    if !origin.is_file() {
        return Err("origin snapshot is missing".into());
    }
    let mut files = vec![StageFile { path: ORIGIN_FILE, sha256: hash_file(&origin)? }];
    let key = state.recovery_dir.join(KEY_FILE);
    if key.exists() {
        files.push(StageFile { path: KEY_FILE, sha256: hash_file(&key)? });
    }
    if state.use_keychain {
        let entry = keychain_entry()?;
        match entry.get_password() {
            Ok(current) => {
                let exported = fs::read_to_string(&key).map_err(|_| "data key was not exported")?;
                if exported != current {
                    return Err("exported data key differs from the keychain entry".into());
                }
            }
            Err(keyring::Error::NoEntry) => {},
            Err(error) => return Err(format!("cannot verify Acorn data key: {error}")),
        }
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {},
            Err(error) => return Err(format!("could not remove Acorn data key: {error}")),
        }
    }
    let manifest = StageManifest {
        desktop_root: state.desktop_root.to_string_lossy().into_owned(),
        complete: true,
        files,
    };
    let body = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    write_private(&state.recovery_dir.join(STAGE_FILE), &body)?;
    app.exit(0);
    Ok(())
}

pub fn page() -> tauri::http::Response<Vec<u8>> {
    let html = include_str!("reset_stage.html");
    tauri::http::Response::builder()
        .status(200)
        .header("content-type", "text/html; charset=utf-8")
        .header("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; connect-src ipc: http://ipc.localhost; base-uri 'none'; form-action 'none'")
        .header("cache-control", "no-store")
        .body(html.as_bytes().to_vec())
        .expect("static reset page builds")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupted_private_export_preserves_first_copy() {
        let dir = std::env::temp_dir().join(format!("acorn-reset-stage-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(ORIGIN_FILE);
        fs::remove_file(&file).ok();
        let temporary = file.with_extension(format!("tmp-{}", std::process::id()));
        fs::write(&temporary, "incomplete").unwrap();
        write_private(&file, b"first").unwrap();
        write_private(&file, b"second").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"first");
        assert!(!temporary.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_lowercase_hex_is_a_data_key() {
        assert!(valid_key(&"a".repeat(64)));
        assert!(!valid_key(&"A".repeat(64)));
        assert!(!valid_key(&"z".repeat(64)));
    }
}
