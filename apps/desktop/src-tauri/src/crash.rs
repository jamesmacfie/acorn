use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// What the shell leaves behind when it panics.
//
// A panic hook runs while the process is dying. It can write a file and it can do nothing else: the
// helper is this process's child and is going with it, so there is no socket to post over and no
// runtime left to post from. So the record waits on disk for the next boot, which is the same
// pattern the crash budget uses for its window. The helper reads it, posts it as an error record
// with `runtime: shell`, and deletes it (packages/custody/src/telemetry.ts).
//
// The file is the telemetry error record's own shape, minus the `kind` the reader adds. That is the
// door the design left open: a crash reporter in the shell, a native dialog offering to send it,
// reads the same file (docs/shell.md § What the shell reports).
//
// Nothing here may panic. A panic inside a panic hook aborts the process without running any of the
// other hooks, so every step is a `let _ =` and the message is built from pieces that cannot fail.

/// Where the record goes, under the shell's own custody root rather than the node's data root. It
/// belongs to this app, the way `fleet.json` and the encrypted device tokens do, and the helper
/// already knows that directory from its handshake.
pub const CRASH_FILE: &str = "shell-crash.json";

/// The custody root, set once boot has resolved it. A `Mutex<Option<..>>` rather than a captured
/// value because the hook is installed before the roots exist in the packaged build and a panic in
/// between has nowhere useful to be written anyway.
static ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Install the hook and say where to write. Called from `boot` once both roots exist.
pub fn install(user_data_dir: &Path, version: String) {
    if let Ok(mut root) = ROOT.lock() {
        *root = Some(user_data_dir.to_path_buf());
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        write(info, &version);
        // Then whatever was there before, which in a debug build is the printer that puts the
        // message and the backtrace on stderr. A hook that swallowed that would make a developer's
        // panic harder to read than it was before any of this existed.
        previous(info);
    }));
}

fn write(info: &std::panic::PanicHookInfo<'_>, version: &str) {
    let Ok(root) = ROOT.lock() else { return };
    let Some(dir) = root.as_ref() else { return };

    // `payload` is the panic's message, which is a `&str` for `panic!("…")` and a `String` for
    // `panic!("{x}")`. Anything else is a payload no formatter can read, and "a panic" is still
    // worth reporting.
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic with no message".to_string());
    let location = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_default();
    let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
    let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);

    let record = serde_json::json!({
        "at": at,
        "name": "ShellPanic",
        "message": message,
        // The location stands in for a stack. `std::backtrace` needs `RUST_BACKTRACE` to be set to
        // capture anything, and a release build with no debug symbols resolves to addresses nobody
        // can read, so the file and line the panic names is the honest answer.
        "stack": location.clone(),
        "level": "fatal",
        "handled": false,
        "attrs": {
            "seam": "shell.panic",
            "thread": thread,
            "app.version": version,
            "location": location,
        }
    });

    // Written whole rather than appended, because there is one shell and one last panic worth
    // reading. A second panic on the way down overwrites the first, which is the right way round:
    // the last one is the one that killed it.
    let _ = fs::write(dir.join(CRASH_FILE), record.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_record_the_helper_can_read() {
        let dir = std::env::temp_dir().join(format!("acorn-crash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        *ROOT.lock().unwrap() = Some(dir.clone());

        // The hook's own writer, under a hook that writes and stays quiet. The real `install` chains
        // the previous hook, which in a test binary prints the panic and its backtrace to stderr and
        // makes a passing test look like a failing one.
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|info| write(info, "9.9.9")));
        let caught = std::panic::catch_unwind(|| panic!("the window went away"));
        std::panic::set_hook(previous);
        assert!(caught.is_err());

        let raw = std::fs::read_to_string(dir.join(CRASH_FILE)).expect("a crash file");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        assert_eq!(value["name"], "ShellPanic");
        assert_eq!(value["level"], "fatal");
        assert_eq!(value["handled"], false);
        assert_eq!(value["message"], "the window went away");
        assert_eq!(value["attrs"]["seam"], "shell.panic");
        assert_eq!(value["attrs"]["app.version"], "9.9.9");
        assert!(value["attrs"]["location"].as_str().unwrap().contains("crash.rs"));
        assert!(value["at"].as_u64().unwrap() > 0);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
