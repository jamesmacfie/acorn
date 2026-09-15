use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

// Supervision of the desktop helper: spawn it under the bundled Node, hand it the handshake on stdin,
// read its ready line off stdout, and kill its whole process group on the way out. See docs/shell.md,
// "The shell process".
//
// Two rules here are not optional. The helper gets its own process group and the kill targets the
// group. Killing the helper alone orphans the node service, which keeps holding the data root's
// exclusive lock, and the replacement helper's node then refuses to boot with "Another acorn node
// already holds <dataDir>".
//
// The handshake goes in the moment the process exists, before anything is awaited, because the helper
// installs its command reader before it starts the node and a quit can reach it mid-boot.

/// How long the helper gets to print its ready line before the boot counts as failed. Normal boot is
/// under a second. Migrations on a cold data root are the case this has to be generous for.
const READY_TIMEOUT: Duration = Duration::from_secs(90);
/// SIGTERM, then SIGKILL if the group ignores it. The helper drains the node, which is worth waiting
/// for, but a wedged one holding the data root's lock is worse than a hard kill.
const KILL_ESCALATION: Duration = Duration::from_secs(8);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handshake {
    pub protocol: u32,
    pub data_key: String,
    pub data_dir: String,
    pub user_data_dir: String,
    pub service_entry: String,
    pub mcp_entry: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundled_plugins_dir: Option<String>,
    /// The Electron build's custody root and the safeStorage key its device tokens are encrypted
    /// under, when both were found. Absent means there is nothing to adopt or nothing readable, and
    /// the helper starts from an empty fleet. See src/keychain.rs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy: Option<Legacy>,
    pub env_files: Vec<String>,
    pub version: String,
    pub is_packaged: bool,
    pub app_origin: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Legacy {
    pub user_data_dir: String,
    pub safe_storage_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ready {
    pub protocol: u32,
    pub port: u16,
    pub secret: String,
    pub node_version: String,
}

/// A line the helper meant for the shell, as opposed to one of its logs. Everything it says to the
/// shell carries the `acorn-helper` key. Everything else on stdout is passed through.
#[derive(Debug)]
pub enum Signal {
    Ready(Ready),
    /// `reason` is what the service said about the last attempt, when it said anything. The recovery
    /// dialog is the only place an owner reads it.
    CrashBudgetExhausted { reason: Option<String> },
    /// A preview tunnel is listening on this loopback port under this secret. wry cannot inject a
    /// per-request header, so src/webviews.rs seeds the credential into the preview webview's cookie
    /// store. It travels on this pipe so the renderer never sees it.
    TunnelOpened { port: u16, secret: String },
    TunnelClosed { port: u16 },
}

fn parse_signal(line: &str) -> Option<Signal> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let port = || u16::try_from(value.get("port")?.as_u64()?).ok();
    match value.get("acorn-helper")?.as_str()? {
        "ready" => serde_json::from_value(value.clone()).ok().map(Signal::Ready),
        "crash-budget-exhausted" => Some(Signal::CrashBudgetExhausted {
            reason: value.get("reason").and_then(|r| r.as_str()).map(str::to_string),
        }),
        "tunnel-opened" => Some(Signal::TunnelOpened { port: port()?, secret: value.get("secret")?.as_str()?.to_string() }),
        "tunnel-closed" => Some(Signal::TunnelClosed { port: port()? }),
        _ => None,
    }
}

pub struct Helper {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    pub ready: Ready,
}

/// Everything the shell needs to launch one: the runtime, the helper bundle, and what to tell it.
pub struct Launch {
    pub node: PathBuf,
    pub entry: PathBuf,
    pub handshake: Handshake,
}

fn spawn(launch: &Launch) -> std::io::Result<Child> {
    let mut command = Command::new(&launch.node);
    command
        .arg(&launch.entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    // Its own process group, so the kill below reaches the node service too. `setsid` would also
    // detach it from the controlling terminal, which is wrong for `pnpm dev`, where the helper's logs
    // are meant to land in the developer's terminal.
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }

    command.spawn()
}

#[cfg(unix)]
fn signal_group(group: i32, signal: i32) {
    // Negative pid means "the group whose id this is", which is the whole point of the setpgid above.
    unsafe { libc::kill(-group, signal) };
}

/// Whether anything is still in the group. Signal 0 checks for delivery without delivering, so this
/// is the difference between "the helper has exited" and "the helper and the node it supervises have
/// both exited". Only the second one is safe to leave.
#[cfg(unix)]
fn group_has_members(group: i32) -> bool {
    unsafe { libc::kill(-group, 0) == 0 }
}

/// SIGTERM the group, wait for it to empty, then SIGKILL whatever is left.
///
/// The wait is on the group rather than on the helper, and that is the whole point. The helper exits
/// promptly and politely; the node it supervises is the one that can wedge, and the node is what
/// holds the data root's exclusive lock. Returning as soon as the helper was reaped left a live node
/// behind in an abandoned group, so the next launch failed with "Another acorn node already holds
/// <dataDir>" until somebody killed a pid by hand.
///
/// The ceiling is that the group id is the helper's pid, which the kernel may reuse once the helper
/// is reaped. Escalating onto a recycled group would need that exact pid to be handed to a new group
/// leader inside the escalation window, which is why this is a comment rather than a lock file.
#[cfg(unix)]
fn terminate_group(child: &mut Child, escalation: Duration) -> bool {
    let group = child.id() as i32;
    signal_group(group, libc::SIGTERM);

    let deadline = std::time::Instant::now() + escalation;
    let mut reaped = false;
    loop {
        if !reaped && matches!(child.try_wait(), Ok(Some(_))) {
            reaped = true;
        }
        if reaped && !group_has_members(group) {
            return false;
        }
        if std::time::Instant::now() >= deadline {
            signal_group(group, libc::SIGKILL);
            if !reaped {
                let _ = child.kill();
                let _ = child.wait();
            }
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(not(unix))]
fn terminate_group(child: &mut Child, _escalation: Duration) -> bool {
    let _ = child.kill();
    let _ = child.wait();
    true
}

impl Helper {
    /// Spawn, hand over the handshake, and wait for the ready line. Every other line the helper writes
    /// to stdout is forwarded to ours, and signals after boot go to `on_signal`.
    pub fn start(launch: Launch, on_signal: impl Fn(Signal) + Send + 'static) -> Result<Self, String> {
        let expected = launch.handshake.protocol;
        let mut child = spawn(&launch).map_err(|e| format!("could not start the desktop helper: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("the desktop helper has no stdin")?;
        let stdout = child.stdout.take().ok_or("the desktop helper has no stdout")?;

        // Written before anything is awaited. The helper's command reader is live from its first
        // tick, and a handshake it never receives leaves it hanging rather than failing.
        let line = serde_json::to_string(&launch.handshake).map_err(|e| e.to_string())?;
        stdin
            .write_all(format!("{line}\n").as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("could not hand the desktop helper its handshake: {e}"))?;

        let (tx, rx): (_, Receiver<Ready>) = mpsc::channel();
        std::thread::spawn(move || {
            let mut announced = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                match parse_signal(&line) {
                    Some(Signal::Ready(ready)) if !announced => {
                        announced = true;
                        let _ = tx.send(ready);
                    }
                    Some(signal) => on_signal(signal),
                    None => println!("{line}"),
                }
            }
        });

        let ready = match rx.recv_timeout(READY_TIMEOUT) {
            Ok(ready) => ready,
            Err(RecvTimeoutError::Timeout) => {
                let helper = Self { child: Arc::new(Mutex::new(Some(child))), stdin: Arc::new(Mutex::new(None)), ready: Ready { protocol: 0, port: 0, secret: String::new(), node_version: String::new() } };
                helper.stop();
                return Err("the desktop helper did not become ready".into());
            }
            // The reader thread ended, which means stdout closed, which means the process is gone.
            Err(RecvTimeoutError::Disconnected) => return Err("the desktop helper exited during boot".into()),
        };

        let helper = Self {
            child: Arc::new(Mutex::new(Some(child))),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            ready,
        };
        // A helper from a different build than this shell. A bundle ships both together, but in a
        // checkout one side often gets rebuilt and the other does not, and the failure that causes is
        // a renderer that connects and then gets nonsense back.
        if helper.ready.protocol != expected {
            let found = helper.ready.protocol;
            helper.stop();
            return Err(format!("the desktop helper speaks protocol {found}, this shell speaks {expected}"));
        }
        Ok(helper)
    }

    /// One command line to the helper: `stop` to drain, `retry` to forgive a spent crash budget.
    pub fn command(&self, command: &str) {
        let mut held = self.stdin.lock().unwrap();
        if let Some(stdin) = held.as_mut() {
            let _ = stdin.write_all(format!("{{\"command\":\"{command}\"}}\n").as_bytes());
            let _ = stdin.flush();
        }
    }

    /// Ask politely, then stop being polite. Group-wide both times. See the note at the top of this
    /// file for what a single-process kill costs.
    pub fn stop(&self) {
        self.command("stop");
        let mut held = self.child.lock().unwrap();
        let Some(child) = held.as_mut() else { return };

        if terminate_group(child, KILL_ESCALATION) {
            eprintln!("[shell] the helper's process group had to be killed; a node may not have drained cleanly");
        }
        *held = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_tagged_lines_are_signals() {
        assert!(parse_signal("[service-host] ready").is_none());
        assert!(parse_signal("{\"hello\":1}").is_none());
        assert!(matches!(
            parse_signal("{\"acorn-helper\":\"crash-budget-exhausted\"}"),
            Some(Signal::CrashBudgetExhausted { reason: None })
        ));
        let exhausted = parse_signal("{\"acorn-helper\":\"crash-budget-exhausted\",\"reason\":\"another node holds this root\"}");
        let Some(Signal::CrashBudgetExhausted { reason: Some(reason) }) = exhausted else { panic!("expected a reason") };
        assert_eq!(reason, "another node holds this root");
        let ready = parse_signal("{\"acorn-helper\":\"ready\",\"protocol\":1,\"port\":51234,\"secret\":\"ab\",\"nodeVersion\":\"v24.11.0\"}");
        let Some(Signal::Ready(ready)) = ready else { panic!("expected a ready line") };
        assert_eq!(ready.port, 51234);
        assert_eq!(ready.node_version, "v24.11.0");
    }

    /// The orphaned-node regression, in the shape that produced it: a parent that exits at once,
    /// leaving a child alive in the same process group. Waiting on the parent says "done" while the
    /// thing holding the data root's lock is still running.
    #[cfg(unix)]
    #[test]
    fn a_child_that_outlives_the_helper_is_still_killed() {
        use std::os::unix::process::CommandExt;

        let mut command = Command::new("/bin/sh");
        // The shell backgrounds a long sleep and exits immediately. The sleep inherits the group.
        command.arg("-c").arg("sleep 120 & exit 0").stdout(Stdio::null()).stderr(Stdio::null());
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().expect("a shell");
        let group = child.id() as i32;

        // Let the shell exit and the sleep settle, so the group really is "parent gone, child alive".
        std::thread::sleep(Duration::from_millis(300));
        assert!(group_has_members(group), "the backgrounded sleep should still hold the group");

        // `sleep` does not ignore SIGTERM, so the polite signal is enough and no escalation is
        // reported. The property under test is that the wait did not end when the shell did.
        let escalated = terminate_group(&mut child, Duration::from_secs(5));
        assert!(!escalated, "SIGTERM alone should have emptied the group");
        assert!(!group_has_members(group), "nothing may be left in the group");
    }

    /// And the other half: a child that refuses SIGTERM is killed rather than waited on forever.
    #[cfg(unix)]
    #[test]
    fn a_child_that_ignores_sigterm_is_killed() {
        use std::os::unix::process::CommandExt;

        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("trap '' TERM; sleep 120").stdout(Stdio::null()).stderr(Stdio::null());
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().expect("a shell");
        let group = child.id() as i32;
        std::thread::sleep(Duration::from_millis(300));

        let started = std::time::Instant::now();
        let escalated = terminate_group(&mut child, Duration::from_millis(500));
        assert!(escalated, "a child that ignores SIGTERM must be reported as killed");
        assert!(started.elapsed() < Duration::from_secs(5), "the escalation must not wait out the sleep");
        std::thread::sleep(Duration::from_millis(200));
        assert!(!group_has_members(group), "SIGKILL must have emptied the group");
    }

    #[test]
    fn the_handshake_is_camel_case_and_hides_an_absent_plugins_dir() {
        let line = serde_json::to_string(&Handshake {
            protocol: 1,
            data_key: "ab".into(),
            data_dir: "/d".into(),
            user_data_dir: "/u".into(),
            service_entry: "/s".into(),
            mcp_entry: "/m".into(),
            bundled_plugins_dir: None,
            legacy: None,
            env_files: vec!["/a/.env".into()],
            version: "0.1.0".into(),
            is_packaged: false,
            app_origin: "app://acorn".into(),
        })
        .unwrap();
        assert!(line.contains("\"userDataDir\":\"/u\""), "{line}");
        assert!(line.contains("\"isPackaged\":false"), "{line}");
        assert!(line.contains("\"envFiles\":[\"/a/.env\"]"), "{line}");
        assert!(!line.contains("bundledPluginsDir"), "{line}");
        assert!(!line.contains("legacy"), "{line}");
    }

    #[test]
    fn a_tunnel_signal_carries_a_port_and_a_secret() {
        let opened = parse_signal("{\"acorn-helper\":\"tunnel-opened\",\"port\":51999,\"secret\":\"s3cr3t\"}");
        let Some(Signal::TunnelOpened { port, secret }) = opened else { panic!("expected a tunnel-opened signal") };
        assert_eq!((port, secret.as_str()), (51999, "s3cr3t"));
        assert!(matches!(parse_signal("{\"acorn-helper\":\"tunnel-closed\",\"port\":51999}"), Some(Signal::TunnelClosed { port: 51999 })));
        // A port that cannot be one is not a signal, rather than a signal about port 0.
        assert!(parse_signal("{\"acorn-helper\":\"tunnel-closed\",\"port\":70000}").is_none());
        assert!(parse_signal("{\"acorn-helper\":\"tunnel-opened\",\"port\":1}").is_none());
    }
}
