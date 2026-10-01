use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager};

const HEADER: &str = "#!/bin/sh\n# acorn desktop CLI launcher v1\n";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallState {
    available: bool,
    installed: bool,
    /// The launcher there is acorn's, but for another copy of the app, so installing updates it.
    outdated: bool,
    location: Option<String>,
    message: String,
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

fn launcher(node: &Path, cli: &Path, standalone: &Path, data: &Path) -> String {
    format!(
        "{HEADER}if [ -z \"${{ACORN_DATA_DIR:-}}\" ]; then ACORN_DATA_DIR={}; export ACORN_DATA_DIR; fi\nif [ -z \"${{ACORN_CLI_NODE_ENTRY:-}}\" ]; then ACORN_CLI_NODE_ENTRY={}; export ACORN_CLI_NODE_ENTRY; fi\nexec {} {} \"$@\"\n",
        shell_quote(data), shell_quote(standalone), shell_quote(node), shell_quote(cli),
    )
}

fn login_path() -> String {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|path| Path::new(path).is_absolute())
        .unwrap_or_else(|| "/bin/sh".into());
    Command::new(shell)
        .args(["-lic", "printf %s \"$PATH\""])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .filter(|path| !path.is_empty())
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default()
}

#[cfg(unix)]
fn writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(name) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    unsafe { libc::access(name.as_ptr(), libc::W_OK | libc::X_OK) == 0 }
}

#[cfg(not(unix))]
fn writable(_path: &Path) -> bool {
    false
}

fn destination() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("HOME is not set")?;
    let allowed = [
        home.join(".local/bin"),
        home.join("bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    for entry in login_path().split(':').filter(|entry| !entry.is_empty()) {
        let directory = Path::new(entry);
        let command = directory.join("acorn");
        if allowed.iter().any(|candidate| candidate == directory)
            && directory.is_dir()
            && writable(directory)
        {
            return Ok(command);
        }
        if fs::symlink_metadata(&command).is_ok() {
            return Err(format!(
                "{} already provides an acorn command earlier on PATH. Acorn will not install a hidden launcher.",
                command.display()
            ));
        }
    }
    Err("No writable command directory is on your login shell PATH. Add ~/.local/bin to PATH, create that directory, and try again.".into())
}

fn paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let cli = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/cli/cli.js")
    } else {
        app.path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("cli/cli.js")
    };
    let standalone = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/helper/standalone.js")
    } else {
        app.path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("helper/standalone.js")
    };
    let node = if cfg!(debug_assertions) {
        crate::bundled_node_for_host()
    } else {
        crate::bundled_node()
    };
    let data = app.state::<crate::commands::Shell>().data_dir.clone();
    for required in [&cli, &standalone, &node] {
        if !required.is_file() {
            return Err(format!(
                "{} is missing. Run `pnpm run stage` before installing the command.",
                required.display()
            ));
        }
    }
    Ok((node, cli, standalone, data))
}

fn installed_content(target: &Path) -> Result<Option<String>, String> {
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.is_file() => fs::read_to_string(target)
            .map(Some)
            .map_err(|error| error.to_string()),
        Ok(_) => Err(format!(
            "{} already exists and is not an Acorn launcher.",
            target.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_launcher(target: &Path, content: &str) -> Result<(), String> {
    if let Some(existing) = installed_content(target)? {
        if !existing.starts_with(HEADER) {
            return Err(format!(
                "{} already exists. Acorn will not replace another command.",
                target.display()
            ));
        }
        if existing == content {
            return Ok(());
        }
    }
    let temporary = target.with_file_name(format!(".acorn-{}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let result = (|| {
        file.write_all(content.as_bytes())
            .map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o755))
                .map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, target).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn state(app: &AppHandle) -> CliInstallState {
    let (node, cli, standalone, data) = match paths(app) {
        Ok(paths) => paths,
        Err(message) => {
            return CliInstallState {
                available: false,
                installed: false,
                outdated: false,
                location: None,
                message,
            }
        }
    };
    let target = match destination() {
        Ok(target) => target,
        Err(message) => {
            return CliInstallState {
                available: false,
                installed: false,
                outdated: false,
                location: None,
                message,
            }
        }
    };
    let expected = launcher(&node, &cli, &standalone, &data);
    let location = Some(target.display().to_string());
    match installed_content(&target) {
        Ok(Some(content)) if content == expected => CliInstallState {
            available: true,
            installed: true,
            outdated: false,
            location,
            message: "The acorn command is installed. Open a new terminal to use it.".into(),
        },
        Ok(Some(content)) if content.starts_with(HEADER) => CliInstallState {
            available: true,
            installed: false,
            outdated: true,
            location,
            message: "The acorn command points to a different copy of acorn.".into(),
        },
        Ok(None) => CliInstallState {
            available: true,
            installed: false,
            outdated: false,
            location,
            message: "Not installed.".into(),
        },
        Ok(Some(_)) => CliInstallState {
            available: false,
            installed: false,
            outdated: false,
            location,
            message: "Another program called acorn is already there, so acorn leaves it alone.".into(),
        },
        Err(message) => CliInstallState {
            available: false,
            installed: false,
            outdated: false,
            location,
            message,
        },
    }
}

#[tauri::command]
pub async fn cli_install_status(app: AppHandle) -> CliInstallState {
    tauri::async_runtime::spawn_blocking(move || state(&app))
        .await
        .unwrap_or_else(|error| CliInstallState {
            available: false,
            installed: false,
            outdated: false,
            location: None,
            message: error.to_string(),
        })
}

#[tauri::command]
pub async fn cli_install(app: AppHandle) -> Result<CliInstallState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (node, cli, standalone, data) = paths(&app)?;
        let target = destination()?;
        write_launcher(&target, &launcher(&node, &cli, &standalone, &data))?;
        Ok(state(&app))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{launcher, shell_quote, write_launcher};
    use std::fs;
    use std::path::Path;

    #[test]
    fn launcher_quotes_paths_and_preserves_arguments() {
        let script = launcher(
            Path::new("/app's/node"),
            Path::new("/app/cli.js"),
            Path::new("/app/standalone.js"),
            Path::new("/my data"),
        );
        assert!(script.contains("exec '/app'\\''s/node' '/app/cli.js' \"$@\""));
        assert_eq!(shell_quote(Path::new("/my data")), "'/my data'");
    }

    #[test]
    fn installer_updates_only_its_own_launcher() {
        let dir = std::env::temp_dir().join(format!(
            "acorn-cli-install-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("acorn");
        fs::write(&target, "someone else's command").unwrap();
        assert!(write_launcher(&target, "#!/bin/sh\n# acorn desktop CLI launcher v1\n").is_err());
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            "someone else's command"
        );
        fs::remove_file(&target).unwrap();
        write_launcher(&target, "#!/bin/sh\n# acorn desktop CLI launcher v1\nold").unwrap();
        write_launcher(&target, "#!/bin/sh\n# acorn desktop CLI launcher v1\nnew").unwrap();
        assert!(fs::read_to_string(&target).unwrap().ends_with("new"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn installed_launcher_forwards_arguments() {
        let dir = std::env::temp_dir().join(format!(
            "acorn-cli-launch-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("acorn");
        let content = launcher(
            Path::new("/bin/echo"),
            Path::new("/a path/cli.js"),
            Path::new("/a path/standalone.js"),
            Path::new("/data path"),
        );
        write_launcher(&target, &content).unwrap();
        let output = std::process::Command::new(&target)
            .args(["two words", "last"])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().trim(),
            "/a path/cli.js two words last"
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
