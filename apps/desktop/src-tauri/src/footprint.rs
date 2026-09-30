use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::Manager;

#[cfg(target_os = "macos")]
use crate::commands::Shell;

// The renderer's memory, measured from outside it (docs/shell.md § What the shell reports).
//
// WebKit gives the page no way to read its own process's memory, and the page is the thing that
// grows. So the helper asks on stdout, this reads the web content process and the helper from here,
// and the answer goes back on the helper's stdin. The helper owns the timer and the consent check,
// so a shell whose telemetry is off is never asked and does nothing.
//
// The number is the physical footprint, which is what `footprint` and Activity Monitor's Memory
// column show. Resident size undercounts on macOS because compressed pages leave it.
//
// macOS only. Anywhere else the request is ignored, and the helper does not send one.

/// Answer one footprint request from the helper. Never blocks the caller: the web content process is
/// read on the main thread, because a WKWebView may only be touched there.
pub fn answer(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let Some(webview) = app.get_webview("main") else { return reply(app, None) };
        let handle = app.clone();
        // Read every time rather than cached. WebKit replaces a web content process that crashed or
        // was killed for memory, and the new one has a new pid.
        let queued = webview.with_webview(move |platform| {
            let renderer = web_content_pid(platform.inner()).and_then(phys_footprint);
            reply(&handle, renderer);
        });
        if queued.is_err() {
            reply(app, None);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
fn reply(app: &AppHandle, renderer: Option<u64>) {
    let Some(shell) = app.try_state::<Shell>() else { return };
    let Ok(held) = shell.helper.lock() else { return };
    let Some(helper) = held.as_ref() else { return };
    let own = helper.pid().and_then(|pid| i32::try_from(pid).ok()).and_then(phys_footprint);
    helper.send(&report_line(renderer, own));
}

/// The command the helper reads off stdin. `null` for a process that could not be read, so the helper
/// can tell a missing number from a zero.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn report_line(renderer: Option<u64>, helper: Option<u64>) -> String {
    serde_json::json!({ "command": "footprint", "renderer": renderer, "helper": helper }).to_string()
}

/// The physical footprint of a process in bytes, or None when it has gone or cannot be read.
#[cfg(target_os = "macos")]
pub fn phys_footprint(pid: i32) -> Option<u64> {
    if pid <= 0 {
        return None;
    }
    // SAFETY: `rusage_info_v4` is plain data, and the kernel writes at most its size for this flavor.
    let mut info: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
    let status = unsafe {
        libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V4, &mut info as *mut libc::rusage_info_v4 as *mut libc::rusage_info_t)
    };
    (status == 0).then_some(info.ri_phys_footprint)
}

/// The pid of the process drawing a WKWebView's page, or None when it has none right now.
///
/// `_webProcessIdentifier` is private, but WebKit has shipped it unchanged for years, and wry and
/// Tauri expose no public way to ask. It answers 0 while a crashed renderer is being replaced. The
/// selector is checked first, because sending one the object does not know raises an Objective-C
/// exception, and that aborts the process from inside Rust.
#[cfg(target_os = "macos")]
pub fn web_content_pid(webview: *mut std::ffi::c_void) -> Option<i32> {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};

    let view = webview as *mut AnyObject;
    if view.is_null() {
        return None;
    }
    // SAFETY: `view` is the live WKWebView Tauri handed to `with_webview`, and this runs on the main
    // thread inside that callback.
    let knows: bool = unsafe { msg_send![view, respondsToSelector: sel!(_webProcessIdentifier)] };
    if !knows {
        return None;
    }
    let pid: i32 = unsafe { msg_send![view, _webProcessIdentifier] };
    (pid > 0).then_some(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_report_names_a_missing_number_as_null() {
        let line = report_line(Some(1_234), None);
        let value: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value, serde_json::json!({ "command": "footprint", "renderer": 1234, "helper": null }));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn this_process_has_a_footprint_and_a_missing_one_does_not() {
        let own = phys_footprint(std::process::id() as i32).expect("this process can read itself");
        assert!(own > 1024 * 1024, "a running test binary holds more than a megabyte, got {own}");
        assert_eq!(phys_footprint(0), None);
        assert_eq!(phys_footprint(-1), None);
        // Past the kernel's pid ceiling, so it cannot name a live process.
        assert_eq!(phys_footprint(99_999_999), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn an_object_without_the_private_selector_has_no_pid() {
        // What a WebKit that dropped `_webProcessIdentifier` looks like from here: no answer, and no
        // exception.
        let object = objc2::runtime::NSObject::new();
        let pointer = objc2::rc::Retained::as_ptr(&object) as *mut std::ffi::c_void;
        assert_eq!(web_content_pid(pointer), None);
        assert_eq!(web_content_pid(std::ptr::null_mut()), None);
    }
}
