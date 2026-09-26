use std::time::{Duration, Instant};

const ENTRY_PATH: &str = "/src/client/index.tsx";
const ENTRY_TIMEOUT: Duration = Duration::from_secs(30);
const RETRY_DELAY: Duration = Duration::from_millis(50);

/// Hold a development window until Vite has transformed the renderer entry at least once.
///
/// Tauri waits for `devUrl`, but that request asks only for `index.html`. Vite can answer the HTML
/// while its optimized dependency graph is still changing, then refuse the entry module with the
/// transient 504 that asks a browser to reload. The shell owns the stronger readiness check shared
/// by `tauri dev` and the automation runner.
pub fn wait_for_entry(origin: &str) {
    if !wait_for_entry_with(origin, ENTRY_TIMEOUT, RETRY_DELAY) {
        eprintln!("[shell] renderer entry did not settle within {}s; opening the window with its startup guard", ENTRY_TIMEOUT.as_secs());
    }
}

fn wait_for_entry_with(origin: &str, timeout: Duration, retry_delay: Duration) -> bool {
    let started = Instant::now();
    let url = format!("{origin}{ENTRY_PATH}");
    loop {
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return false;
        }
        match ureq::get(&url).timeout(remaining).call() {
            Ok(_) => return true,
            // A non-504 HTTP failure is settled too: the window should open and let Vite's body
            // reach the startup guard instead of replacing a real transform error with a timeout.
            Err(ureq::Error::Status(status, _)) if status != 504 => return true,
            Err(ureq::Error::Status(_, _)) | Err(ureq::Error::Transport(_)) => {}
        }
        std::thread::sleep(retry_delay.min(timeout.saturating_sub(started.elapsed())));
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    use super::*;

    #[test]
    fn waits_for_the_entry_module_to_settle() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for (status, body) in [(504, "Outdated Optimize"), (200, "export default 1")] {
                let (mut socket, _) = listener.accept().expect("one request");
                let mut seen = [0u8; 1024];
                let size = socket.read(&mut seen).expect("the request");
                assert!(String::from_utf8_lossy(&seen[..size])
                    .starts_with("GET /src/client/index.tsx "));
                let response = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Type: text/javascript\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                socket.write_all(response.as_bytes()).expect("the response");
            }
        });

        assert!(wait_for_entry_with(
            &origin,
            Duration::from_secs(1),
            Duration::from_millis(1)
        ));
        server.join().expect("the fixture server");
    }

    #[test]
    fn a_real_transform_error_does_not_hold_the_window_closed() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("one request");
            let mut seen = [0u8; 1024];
            let _ = socket.read(&mut seen);
            socket
                .write_all(b"HTTP/1.1 500 Transform Error\r\nContent-Type: text/plain\r\nContent-Length: 6\r\nConnection: close\r\n\r\nbroken")
                .expect("the response");
        });

        assert!(wait_for_entry_with(
            &origin,
            Duration::from_secs(1),
            Duration::from_millis(1)
        ));
        server.join().expect("the fixture server");
    }
}
