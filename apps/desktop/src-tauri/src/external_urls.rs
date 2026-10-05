use tauri::Url;

// URLs from renderer-owned links reach the OS here. A scheme outside this list can launch an
// arbitrary application or open a local file. See docs/shell/origins.md § Navigation policy.
fn is_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url: Url = url.parse().map_err(|_| "Invalid external URL")?;
    if !is_allowed(&url) || crate::is_renderer_url(&url) || crate::is_plugin_url(&url) {
        return Err("This URL cannot be opened externally".to_string());
    }
    // The platform opener can wait for a child process. Keep it off the window's event thread.
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_opener::open_url(url.as_str(), None::<&str>).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{is_allowed, open_external_url};

    #[test]
    fn external_links_allow_web_and_email_destinations() {
        for href in [
            "https://example.com/article?part=2#section",
            "http://localhost:3000/preview",
            "mailto:hello@example.com?subject=Acorn",
        ] {
            assert!(is_allowed(&href.parse().unwrap()), "{href}");
        }
    }

    #[test]
    fn external_links_refuse_files_code_and_other_application_schemes() {
        for href in [
            "file:///tmp/script.command",
            "javascript:alert(1)",
            "data:text/html,hello",
            "app://acorn/",
            "app-plugin://bundle/index.html",
            "about:blank",
            "ftp://example.com/file",
            "tel:+123456789",
            "acorn://task/123",
        ] {
            assert!(
                tauri::async_runtime::block_on(open_external_url(href.to_string())).is_err(),
                "{href}"
            );
        }
        assert!(
            tauri::async_runtime::block_on(open_external_url("not a URL".to_string())).is_err()
        );
    }
}
