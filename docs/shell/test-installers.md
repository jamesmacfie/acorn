# Test installers

This page covers the Windows and Linux test builds: what CI uploads, what each target machine needs,
and what verification checks. Read it before you install one on a test machine or change a platform's
bundle configuration. It's part of [desktop shell](../shell.md), next to
[build and packaging](packaging.md).

## Windows

The Windows job uploads `acorn-windows-x64`, an NSIS setup executable and its updater signature, and
the macOS job uploads `acorn-dmg`. Both belong to the Actions run, and nothing publishes a GitHub
release. Windows Authenticode signing isn't configured.

`apps/desktop/src-tauri/tauri.windows.conf.json` selects NSIS, a Windows icon, per-user install, and the
WebView2 bootstrapper, which downloads WebView2 if it's missing. Staging fetches the pinned Windows
`node.exe` and checks its SHA-256. The runtime installs beside `acorn-desktop.exe`, and the helper,
service, CLI, plugins, and renderer install under the same directory. The helper's origin gate expects
`http://app.localhost` on Windows.

The target needs Git on `PATH`. The service makes the local Node's TLS certificate in process, so no
OpenSSL is needed, and the target needs no Node, pnpm, Rust, or compiler.

Windows distribution verification installs the setup executable into a temporary directory, compares
the installed resources with staging, checks the Node version and digest, and runs the helper boot test
against the install with host executables removed from `PATH`. It checks an authenticated broker
request and the WebSocket secret and origin gates, then uninstalls. Run it on a disposable build host,
because NSIS also writes shortcuts and uninstall data. It doesn't drive the WebView2 window or test
connections between machines.

## Linux

The Linux jobs upload `acorn-linux-x64` and `acorn-linux-arm64`, each an AppImage and its updater
signature. The arm64 build is the one that runs in Parallels on an Apple silicon Mac, because Linux
has no built-in x64 emulation. Nothing publishes them, and nothing signs them beyond the updater key.

`apps/desktop/src-tauri/tauri.linux.conf.json` selects AppImage only. The shell looks for its Node
beside its own executable, so a `.deb` would install the runtime as `/usr/bin/node` over the system's
Node. Inside the AppImage the runtime is `usr/bin/node` and the resources are under `usr/lib/acorn`.
The bundle step sets `NO_STRIP` so the AppImage tool doesn't strip the binaries it packs. It still
rewrites each ELF binary's library search path, Node's included, so none of them keep the staged bytes.

The target needs Git on `PATH`, WebKitGTK 4.1, and a running Secret Service such as GNOME Keyring for
the keychain. A desktop Ubuntu install has all three except Git.

Linux distribution verification extracts the AppImage into a temporary directory, compares its
resources with staging byte for byte except for ELF binaries, checks the Node version, and runs the
helper boot test against the extracted copy. Like the Windows check, it doesn't drive the window or test connections between
machines. Child webviews on WebKitGTK are unmeasured ([webviews](webviews.md)).
